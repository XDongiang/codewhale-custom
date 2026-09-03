import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Storage } from './storage.js'

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>

export type UserRole = 'admin' | 'school' | 'college'

export const USER_ROLES: readonly UserRole[] = ['admin', 'school', 'college']
export const MIN_PASSWORD_LENGTH = 8

/** 对外暴露的用户信息(不含密码哈希) */
export interface UserRecord {
  id: string
  username: string
  role: UserRole
  college?: string
  disabled: boolean
  createdAt: string
  updatedAt: string
}

interface StoredUser extends UserRecord {
  salt: string
  hash: string
}

interface UsersDoc {
  version: number
  updatedAt: string
  entries: StoredUser[]
}

const USERS_DOC = 'users'
const SCHEMA_VERSION = 1
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1

function genId(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function now(): string {
  return new Date().toISOString()
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

export class UserService {
  constructor(private readonly storage: Storage) {}

  private read(): UsersDoc {
    return this.storage.readDoc<UsersDoc>(USERS_DOC, {
      version: SCHEMA_VERSION,
      updatedAt: now(),
      entries: [],
    })
  }

  private save(entries: StoredUser[]): UsersDoc {
    const doc: UsersDoc = { version: SCHEMA_VERSION, updatedAt: now(), entries }
    this.storage.writeDoc(USERS_DOC, doc)
    return doc
  }

  async hashPassword(password: string): Promise<{ salt: string; hash: string }> {
    const salt = randomBytes(16).toString('hex')
    const hash = (await scrypt(password, salt, 64, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })).toString('hex')
    return { salt, hash }
  }

  async verifyPassword(stored: StoredUser, password: string): Promise<boolean> {
    const candidate = await scrypt(password, stored.salt, 64, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    const expected = Buffer.from(stored.hash, 'hex')
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  }

  /**
   * 首次启动引导:用户表为空时创建 admin。
   * 返回生成的明文密码(仅创建时返回一次,由调用方打印;adminPassword 未提供则随机 12 位)。
   */
  async bootstrapAdmin(adminPassword?: string | null): Promise<{ username: string; password: string; created: boolean }> {
    const doc = this.read()
    if (doc.entries.length > 0) return { username: 'admin', password: '', created: false }

    const username = 'admin'
    const password = adminPassword && adminPassword.length >= MIN_PASSWORD_LENGTH
      ? adminPassword
      : randomBytes(9).toString('base64url').slice(0, 12)
    const { salt, hash } = await this.hashPassword(password)
    this.save([
      {
        id: genId(),
        username,
        role: 'admin',
        disabled: false,
        salt,
        hash,
        createdAt: now(),
        updatedAt: now(),
      },
    ])
    return { username, password, created: true }
  }

  /** 用户列表(不含密码哈希) */
  list(): UserRecord[] {
    return this.read().entries.map(({ salt: _salt, hash: _hash, ...rest }) => rest)
  }

  getById(id: string): StoredUser | null {
    return this.read().entries.find((u) => u.id === id) ?? null
  }

  getByUsername(username: string): StoredUser | null {
    return this.read().entries.find((u) => u.username === username) ?? null
  }

  async create(input: {
    username: string
    password: string
    role: string
    college?: string
  }): Promise<UserRecord> {
    const username = asString(input.username)
    if (!username) throw new Error('用户名不能为空')
    if (this.getByUsername(username)) throw new Error('用户名已存在')
    if (typeof input.password !== 'string' || input.password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`密码至少 ${MIN_PASSWORD_LENGTH} 位`)
    }
    const role = USER_ROLES.includes(input.role as UserRole) ? (input.role as UserRole) : null
    if (!role) throw new Error('角色不合法')
    const college = asString(input.college)
    if (role === 'college' && !college) throw new Error('院级用户必须绑定学院')

    const { salt, hash } = await this.hashPassword(input.password)
    const entry: StoredUser = {
      id: genId(),
      username,
      role,
      college: role === 'college' ? college : undefined,
      disabled: false,
      salt,
      hash,
      createdAt: now(),
      updatedAt: now(),
    }
    const doc = this.read()
    this.save([...doc.entries, entry])
    return this.toPublic(entry)
  }

  async update(
    id: string,
    patch: { role?: string; college?: string; password?: string; disabled?: boolean }
  ): Promise<UserRecord | null> {
    const doc = this.read()
    const idx = doc.entries.findIndex((u) => u.id === id)
    if (idx < 0) return null

    const current = doc.entries[idx]
    let nextRole: UserRole = current.role
    if (patch.role !== undefined) {
      if (!USER_ROLES.includes(patch.role as UserRole)) throw new Error('角色不合法')
      nextRole = patch.role as UserRole
    }
    const nextCollege = asString(patch.college) ?? current.college
    if (nextRole === 'college' && !nextCollege) throw new Error('院级用户必须绑定学院')
    if (nextRole !== 'college' && patch.college !== undefined) {
      // 非院级角色不保留学院归属
    }

    const next: StoredUser = {
      ...current,
      role: nextRole,
      college: nextRole === 'college' ? nextCollege : undefined,
      disabled: patch.disabled ?? current.disabled,
      updatedAt: now(),
    }
    if (typeof patch.password === 'string' && patch.password !== '') {
      if (patch.password.length < MIN_PASSWORD_LENGTH) throw new Error(`密码至少 ${MIN_PASSWORD_LENGTH} 位`)
      const { salt, hash } = await this.hashPassword(patch.password)
      next.salt = salt
      next.hash = hash
    }
    doc.entries[idx] = next
    this.save(doc.entries)
    return this.toPublic(next)
  }

  remove(id: string): string | null {
    const doc = this.read()
    const target = doc.entries.find((u) => u.id === id)
    if (!target) return null
    const admins = doc.entries.filter((u) => u.role === 'admin' && !u.disabled)
    if (target.role === 'admin' && admins.length <= 1) throw new Error('不能删除最后一个管理员')
    this.save(doc.entries.filter((u) => u.id !== id))
    return target.username
  }

  private toPublic({ salt: _salt, hash: _hash, ...rest }: StoredUser): UserRecord {
    return rest
  }
}
