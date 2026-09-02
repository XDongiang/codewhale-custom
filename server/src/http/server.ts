import http from 'node:http'
import type { ServerConfig } from '../config.js'
import { handleRequest, type RouteDeps } from './routes.js'

export function startServer(config: ServerConfig, deps: RouteDeps): http.Server {
  const server = http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    handleRequest(req, res, config, deps).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: '服务器内部错误' }))
      } else {
        res.end()
      }
    })
  })

  server.keepAliveTimeout = 65000
  return server
}
