import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execFile, execSync, spawn } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const XHS = process.env.XHS_BIN || 'xhs'
const AGENTLY = process.env.AGENTLY_CLI_BIN || 'agently-cli'
const execFileAsync = promisify(execFile)

function runXhs(args: string, timeout = 15000): { ok: boolean; output: string } {
  try {
    const out = execSync(`${XHS} ${args} 2>&1`, { timeout, encoding: 'utf-8' })
    return { ok: true, output: out.trim() }
  } catch (e: any) {
    return { ok: false, output: e.stderr || e.stdout || e.message || '' }
  }
}

function readJsonBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
      if (body.length > 1024 * 1024) {
        reject(new Error('请求体过大'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('请求 JSON 无效'))
      }
    })
    req.on('error', reject)
  })
}

function extractJson(text: string): any {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1))
    }
    return null
  }
}

function errorMessageFromCli(stdout = '', stderr = '', fallback = 'Agent Mail CLI 调用失败'): string {
  for (const text of [stdout, stderr]) {
    const parsed = extractJson(text)
    const message = parsed?.error?.message || parsed?.message
    if (message) return message
  }
  return (stderr || stdout || fallback).trim()
}

async function sendReportMail(payload: {
  to: string
  subject: string
  body: string
  confirmationToken?: string
}) {
  const to = String(payload.to || '').trim()
  const subject = String(payload.subject || '').trim()
  const body = String(payload.body || '').trim()
  const confirmationToken = String(payload.confirmationToken || '').trim()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error('收件邮箱格式不正确')
  }
  if (!subject) throw new Error('邮件主题不能为空')
  if (!body) throw new Error('邮件正文不能为空')

  const dir = await mkdtemp(path.join(tmpdir(), 'codewhale-mail-'))
  try {
    const bodyFile = path.join(dir, 'report.txt')
    await writeFile(bodyFile, body, 'utf8')

    const args = [
      'message', '+send',
      '--to', to,
      '--subject', subject,
      '--body-file', './report.txt',
      '--body-format', 'plain',
    ]
    if (confirmationToken) {
      args.push('--confirmation-token', confirmationToken)
    }

    const { stdout } = await execFileAsync(AGENTLY, args, {
      cwd: dir,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    })
    return extractJson(stdout) ?? { ok: true, output: stdout.trim() }
  } catch (err: any) {
    throw new Error(errorMessageFromCli(err.stdout, err.stderr, err.message))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function xhsApiPlugin(): Plugin {
  const installLocalApi = (server: { middlewares: any }) => {
    server.middlewares.use('/api/mail/send-report', async (req: any, res: any) => {
      res.setHeader('Content-Type', 'application/json')
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
        return
      }

      try {
        const payload = await readJsonBody(req)
        const result = await sendReportMail(payload)
        res.end(JSON.stringify({ ok: true, result }))
      } catch (err) {
        res.statusCode = 400
        res.end(JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : '发送邮件失败',
        }))
      }
    })

    server.middlewares.use('/api/xhs/status', (_req: any, res: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(runXhs('status --json')))
    })

    server.middlewares.use('/api/xhs/login', async (_req: any, res: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(runXhs('login', 30000)))
    })

    // Track active QR login process so we can clean it up on logout
    let activeQrProc: ReturnType<typeof spawn> | null = null

    server.middlewares.use('/api/xhs/login-qrcode', async (_req: any, res: any) => {
      res.setHeader('Content-Type', 'application/json')

      // Kill any previous QR login session to free up the display
      if (activeQrProc) {
        activeQrProc.kill('SIGTERM')
        activeQrProc = null
      }

      // xvfb-run provides virtual X Server in WSL/headless environments
      // -a: auto-select free display number (avoids :99 conflict with stale sessions)
      // -nolisten unix bypasses /tmp/.X11-unix sticky-bit permission issue in WSL2
      // PYTHONUNBUFFERED=1 forces line-buffered stdout (otherwise pipe = 8KB full buffer)
      const proc = spawn('xvfb-run', ['-a', '-s', '-nolisten unix +extension RANDR', XHS, 'login', '--qrcode'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      })
      activeQrProc = proc

      let output = ''
      let responded = false

      const sendResponse = () => {
        if (responded) return
        responded = true
        clearTimeout(qrDetectTimer)
        clearTimeout(qrTimeout)
        if (!res.headersSent) {
          res.end(JSON.stringify({
            ok: output.includes('█') || output.includes('QR') || output.length > 50,
            output: output.trim() || '未收到二维码输出，请确认 xhs login 可正常运行',
          }))
        }
      }

      // Send QR code as soon as detected, or fall back after 30s
      const qrDetectTimer = setTimeout(() => {
        if (!responded) sendResponse()
      }, 30000)

      const qrTimeout = setTimeout(() => {
        sendResponse()
        proc.kill()
      }, 300000) // 5 min hard timeout

      proc.stdout.on('data', (data: any) => {
        output += data.toString()
        // Detect QR code — either ASCII art blocks or the raw URL
        if (!responded && (output.includes('█') || output.includes('http') && output.includes('qr'))) {
          // Give a brief moment for the full QR to render
          setTimeout(sendResponse, 2000)
        }
      })
      proc.stderr.on('data', (data: any) => { output += data.toString() })

      proc.on('close', () => {
        sendResponse()
        if (activeQrProc === proc) activeQrProc = null
      })
    })

    server.middlewares.use('/api/xhs/logout', (_req: any, res: any) => {
      res.setHeader('Content-Type', 'application/json')
      // Kill any active QR login process
      if (activeQrProc) {
        activeQrProc.kill()
        activeQrProc = null
      }
      res.end(JSON.stringify(runXhs('logout')))
    })
  }

  return {
    name: 'xhs-api',
    configureServer(server) {
      installLocalApi(server)
    },
    configurePreviewServer(server) {
      installLocalApi(server)
    },
  }
}

const runtimeProxy = {
  '/runtime-api': {
    target: 'http://127.0.0.1:7878',
    changeOrigin: true,
    rewrite: (requestPath: string) => requestPath.replace(/^\/runtime-api/, ''),
  },
}

export default defineConfig({
  plugins: [react(), xhsApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: runtimeProxy,
  },
  preview: {
    proxy: runtimeProxy,
  },
})
