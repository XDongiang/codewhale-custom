import type { IncomingMessage, ServerResponse } from 'node:http'

const MAX_BODY_BYTES = 1024 * 1024

/** 读取请求体并解析为 JSON;空请求体返回 {}。 */
export function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {})
      } catch {
        reject(new Error('请求 JSON 无效'))
      }
    })
    req.on('error', reject)
  })
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const payload = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { ok: false, error: message })
}
