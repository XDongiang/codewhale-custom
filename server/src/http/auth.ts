import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** 提取 Authorization: Bearer <token> 中的 token;缺失返回 null。 */
export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers['authorization']
  if (typeof header !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}

/** 常量时间比较(先哈希再比对,避免长度侧信道)。 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/**
 * 校验请求 token。expected 为空字符串时视为开放(允许未配置鉴权的场景)。
 */
export function authorized(req: IncomingMessage, expected: string): boolean {
  if (expected === '') return true
  const token = bearerToken(req)
  return token !== null && safeEqual(token, expected)
}
