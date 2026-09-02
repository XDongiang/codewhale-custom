import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

function hasFileExtension(p: string): boolean {
  return path.extname(p) !== ''
}

/**
 * 生产模式静态服务。命中文件返回内容;未命中的无扩展名 GET 回退 index.html(SPA)。
 * 返回 true 表示已处理响应,false 表示未命中(转 404)。
 */
export function serveStatic(
  root: string,
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false

  const decoded = decodeURIComponent(pathname)
  const relative = decoded.replace(/^\/+/, '')
  const filePath = path.resolve(root, relative)

  // 防目录穿越:解析结果必须仍在 root 内
  if (!filePath.startsWith(path.resolve(root) + path.sep) && filePath !== path.resolve(root)) {
    res.writeHead(403)
    res.end('Forbidden')
    return true
  }

  let stat: fs.Stats | null = null
  try {
    stat = fs.statSync(filePath)
  } catch {
    stat = null
  }

  if (stat !== null && stat.isFile()) {
    const ext = path.extname(filePath).toLowerCase()
    const headers: Record<string, string> = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
    }
    if (ext === '.html') {
      headers['Cache-Control'] = 'no-cache'
    }
    res.writeHead(200, headers)
    if (req.method === 'HEAD') {
      res.end()
    } else {
      fs.createReadStream(filePath).pipe(res)
    }
    return true
  }

  // SPA fallback
  if (!hasFileExtension(decoded)) {
    const index = path.join(root, 'index.html')
    try {
      if (fs.statSync(index).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' })
        if (req.method === 'HEAD') {
          res.end()
        } else {
          fs.createReadStream(index).pipe(res)
        }
        return true
      }
    } catch {
      return false
    }
  }
  return false
}
