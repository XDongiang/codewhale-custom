import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface SendMailPayload {
  to: string
  subject: string
  body: string
  confirmationToken?: string
}

export interface SendMailResult {
  action?: string
  attachment_count?: number
  from?: string
  subject?: string
  to?: string[]
}

/** 从 CLI 输出里提取 JSON(整段或截取首尾大括号),失败返回 null。 */
export function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
      } catch {
        return null
      }
    }
    return null
  }
}

/** 从 CLI stdout/stderr 中提取用户可读的错误信息。 */
export function errorMessageFromCli(stdout = '', stderr = '', fallback = 'Agent Mail CLI 调用失败'): string {
  for (const text of [stdout, stderr]) {
    const parsed = extractJson(text)
    const message =
      (parsed?.['error'] as Record<string, unknown> | undefined)?.['message'] ??
      parsed?.['message']
    if (typeof message === 'string' && message !== '') return message
  }
  return (stderr || stdout || fallback).trim()
}

export function validateMailPayload(payload: SendMailPayload): string | null {
  const to = payload.to.trim()
  const subject = payload.subject.trim()
  const body = payload.body.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return '收件邮箱格式不正确'
  if (!subject) return '邮件主题不能为空'
  if (!body) return '邮件正文不能为空'
  return null
}

/**
 * 通过 agently-cli 发送报告邮件。与旧 vite.config.ts 中间件行为一致,
 * 支持确认 token(先准备、用户确认后再带 token 真正发送)。
 */
export async function sendReportMail(
  payload: SendMailPayload,
  agentlyBin: string
): Promise<{ ok: true; result: SendMailResult }> {
  const invalid = validateMailPayload(payload)
  if (invalid) throw new Error(invalid)

  const dir = await mkdtemp(path.join(tmpdir(), 'codewhale-mail-'))
  try {
    const bodyFile = path.join(dir, 'report.txt')
    await writeFile(bodyFile, payload.body, 'utf8')

    const args = [
      'message', '+send',
      '--to', payload.to,
      '--subject', payload.subject,
      '--body-file', './report.txt',
      '--body-format', 'plain',
    ]
    if (payload.confirmationToken) {
      args.push('--confirmation-token', payload.confirmationToken)
    }

    const { stdout } = await execFileAsync(agentlyBin, args, {
      cwd: dir,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    })
    const parsed = extractJson(stdout)
    const result: SendMailResult = (parsed ?? {}) as SendMailResult
    return { ok: true, result }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    throw new Error(errorMessageFromCli(e.stdout, e.stderr, e.message))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
