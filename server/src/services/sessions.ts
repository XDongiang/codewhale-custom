import { randomBytes } from 'node:crypto'
import type { Storage } from './storage.js'

interface SessionRecord {
  userId: string
  createdAt: string
  expiresAt: number
}

interface SessionsDoc {
  version: number
  entries: Record<string, SessionRecord>
}

const SESSIONS_DOC = 'sessions'
const SCHEMA_VERSION = 1

/**
 * 服务端会话:opaque token → 用户,持久化到 sessions.json,TTL 内有效。
 * 过期会话在访问时惰性删除。
 */
export class SessionService {
  constructor(
    private readonly storage: Storage,
    private readonly ttlMs: number
  ) {}

  private read(): SessionsDoc {
    return this.storage.readDoc<SessionsDoc>(SESSIONS_DOC, {
      version: SCHEMA_VERSION,
      entries: {},
    })
  }

  private save(entries: Record<string, SessionRecord>): void {
    this.storage.writeDoc(SESSIONS_DOC, { version: SCHEMA_VERSION, entries })
  }

  create(userId: string): string {
    const token = randomBytes(32).toString('hex')
    const doc = this.read()
    doc.entries[token] = {
      userId,
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + this.ttlMs,
    }
    this.save(doc.entries)
    return token
  }

  /** 校验 token,返回 userId;无效或过期返回 null(过期即删除)。 */
  resolve(token: string): string | null {
    const doc = this.read()
    const record = doc.entries[token]
    if (!record) return null
    if (record.expiresAt <= Date.now()) {
      delete doc.entries[token]
      this.save(doc.entries)
      return null
    }
    return record.userId
  }

  revoke(token: string): void {
    const doc = this.read()
    if (doc.entries[token]) {
      delete doc.entries[token]
      this.save(doc.entries)
    }
  }

  /** 清理全部过期会话(启动时调用)。 */
  pruneExpired(): void {
    const doc = this.read()
    const nowMs = Date.now()
    let changed = false
    for (const [token, record] of Object.entries(doc.entries)) {
      if (record.expiresAt <= nowMs) {
        delete doc.entries[token]
        changed = true
      }
    }
    if (changed) this.save(doc.entries)
  }
}
