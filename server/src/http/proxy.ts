import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { sendError } from './json.js'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
])

/**
 * /runtime-api/* 反向代理到 CodeWhale Runtime。
 *
 * - 请求体透传(streaming),响应流式透传(SSE 安全:不设 Content-Length,
 *   Node 自动使用 chunked transfer encoding)
 * - 转发 Authorization 等请求头,剥离 hop-by-hop 响应头
 * - Runtime 不可达或中途断开返回 502
 */
export function proxyRequest(
  runtimeUrl: string,
  targetPath: string,
  req: IncomingMessage,
  res: ServerResponse,
  runtimeToken: string
): Promise<void> {
  return new Promise((resolve) => {
    const url = new URL(runtimeUrl)
    const target = `${url.protocol}//${url.host}${targetPath}`

    const headers = filterRequestHeaders(req.headers)
    // 浏览器不再持有共享 token:代理一律注入服务器配置的 Runtime 凭证
    headers['authorization'] = `Bearer ${runtimeToken}`

    const proxyReq = http.request(target, {
      method: req.method,
      headers,
    })

    proxyReq.on('response', (proxyRes) => {
      const headers: Record<string, string | string[]> = {}
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (value === undefined || HOP_BY_HOP.has(key.toLowerCase())) continue
        headers[key] = value
      }
      res.writeHead(proxyRes.statusCode ?? 502, headers)
      proxyRes.pipe(res)
      proxyRes.on('end', () => {
        res.end()
        resolve()
      })
      proxyRes.on('error', () => {
        if (!res.headersSent) sendError(res, 502, 'Runtime 响应中断')
        res.end()
        resolve()
      })
    })

    proxyReq.on('error', () => {
      if (!res.headersSent) sendError(res, 502, 'Runtime 不可达')
      resolve()
    })

    proxyReq.setTimeout(300000, () => proxyReq.destroy(new Error('proxy timeout')))
    req.pipe(proxyReq)
    req.on('error', () => proxyReq.destroy())
  })
}

function filterRequestHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP.has(key.toLowerCase())) continue
    out[key] = value
  }
  return out
}
