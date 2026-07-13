import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync, spawn } from 'child_process'

const XHS = process.env.XHS_BIN || 'xhs'

function runXhs(args: string, timeout = 15000): { ok: boolean; output: string } {
  try {
    const out = execSync(`${XHS} ${args} 2>&1`, { timeout, encoding: 'utf-8' })
    return { ok: true, output: out.trim() }
  } catch (e: any) {
    return { ok: false, output: e.stderr || e.stdout || e.message || '' }
  }
}

function xhsApiPlugin(): Plugin {
  return {
    name: 'xhs-api',
    configureServer(server) {
      server.middlewares.use('/api/xhs/status', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(runXhs('status --json')))
      })

      server.middlewares.use('/api/xhs/login', async (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(runXhs('login', 30000)))
      })

      // Track active QR login process so we can clean it up on logout
      let activeQrProc: ReturnType<typeof spawn> | null = null

      server.middlewares.use('/api/xhs/login-qrcode', async (_req, res) => {
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

        // Send QR code as soon as detected, or fall back after 10s
        const qrDetectTimer = setTimeout(() => {
          if (!responded) sendResponse()
        }, 30000) // Allow slower ARM hosts to finish browser startup and QR rendering

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

      server.middlewares.use('/api/xhs/logout', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        // Kill any active QR login process
        if (activeQrProc) {
          activeQrProc.kill()
          activeQrProc = null
        }
        res.end(JSON.stringify(runXhs('logout')))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), xhsApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
})
