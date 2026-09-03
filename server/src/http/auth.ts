import type { IncomingMessage } from 'node:http'
import type { SessionService } from '../services/sessions.js'
import type { UserRecord, UserService } from '../services/users.js'

/** 提取 Authorization: Bearer <token> 中的 token;缺失返回 null。 */
export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers['authorization']
  if (typeof header !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}

/**
 * 解析当前请求用户:token → 会话 → 用户。无有效会话返回 null。
 * 所有受保护路由共用此入口。
 */
export async function resolveUser(
  req: IncomingMessage,
  sessions: SessionService,
  users: UserService
): Promise<UserRecord | null> {
  const token = bearerToken(req)
  if (!token) return null
  const userId = sessions.resolve(token)
  if (!userId) return null
  const user = users.getById(userId)
  if (!user || user.disabled) return null
  return user
}

export function isAdmin(user: UserRecord): boolean {
  return user.role === 'admin'
}
