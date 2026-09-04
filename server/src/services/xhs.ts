import { execSync, spawn, type ChildProcess } from 'node:child_process'

export interface XhsResult {
  ok: boolean
  output: string
  /** 从输出中提取的二维码链接(可转图片;取不到时为空,前端退化为 ASCII 显示) */
  qrUrl?: string
}

/** 同步执行 xhs CLI,捕获 stdout+stderr。 */
export function runXhs(bin: string, args: string, timeout = 15000): XhsResult {
  try {
    const out = execSync(`${bin} ${args} 2>&1`, { timeout, encoding: 'utf-8' })
    return { ok: true, output: out.trim(), qrUrl: extractQrUrl(out) }
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string }
    return { ok: false, output: (err.stderr || err.stdout || err.message || '').trim() }
  }
}

let activeQrProc: ChildProcess | null = null

/**
 * 启动小红书扫码登录。在无头环境(WSL / 服务器)用 xvfb-run 提供虚拟 X Server,
 * 捕获终端二维码输出并返回,最长等待 5 分钟。
 */
export function startQrLogin(
  bin: string,
  xvfbArgs: string[],
  timeoutMs = 300000
): Promise<XhsResult> {
  if (activeQrProc) {
    activeQrProc.kill('SIGTERM')
    activeQrProc = null
  }

  const proc = spawn(
    'xvfb-run',
    [...xvfbArgs, bin, 'login', '--qrcode'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    }
  )
  activeQrProc = proc

  return new Promise<XhsResult>((resolve) => {
    let output = ''
    let responded = false

    const makeResult = (ok: boolean, output: string): XhsResult => ({ ok, output, qrUrl: extractQrUrl(output) })
    const send = (result: XhsResult) => {
      if (responded) return
      responded = true
      clearTimeout(qrDetectTimer)
      clearTimeout(qrTimeout)
      resolve(result)
    }

    /** 二维码出现即返回(检测到 ASCII 方块或二维码 URL),否则 30 秒兜底。 */
    const qrDetectTimer = setTimeout(() => {
      send(makeResult(output.includes('█') || output.includes('QR') || output.length > 50, output.trim() || '未收到二维码输出,请确认 xhs login 可正常运行'))
    }, 30000)

    const qrTimeout = setTimeout(() => {
      send(makeResult(output.includes('█') || output.includes('QR') || output.length > 50, output.trim() || '未收到二维码输出,请确认 xhs login 可正常运行'))
      proc.kill()
    }, timeoutMs)

    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString()
      if (!responded && (output.includes('█') || (output.includes('http') && output.includes('qr')))) {
        // 给二维码完整渲染留一点时间
        setTimeout(() => send(makeResult(true, output.trim())), 2000)
      }
    })
    proc.stderr.on('data', (data: Buffer) => {
      output += data.toString()
    })
    proc.on('close', () => {
      send(makeResult(output.includes('█') || output.includes('QR') || output.length > 50, output.trim()))
      if (activeQrProc === proc) activeQrProc = null
    })
  })
}

export function killQrLogin(): void {
  if (activeQrProc) {
    activeQrProc.kill()
    activeQrProc = null
  }
}

/** 从 CLI 输出中提取二维码/登录链接(优先 http(s),忽略终端控制码)。 */
function extractQrUrl(output: string): string | undefined {
  const cleaned = output.replace(/\u001b\[[0-9;]*m/g, '')
  const match = cleaned.match(/https?:\/\/[^\s"'<>]+/)
  return match ? match[0] : undefined
}
