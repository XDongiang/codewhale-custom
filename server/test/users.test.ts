import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JsonStore } from '../src/services/storage.js'
import { UserService } from '../src/services/users.js'
import { SessionService } from '../src/services/sessions.js'

function makeStore(): JsonStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccnu-auth-'))
  return new JsonStore(dir)
}

describe('UserService', () => {
  it('bootstrapAdmin 首次创建 admin,再次调用不重复', async () => {
    const users = new UserService(makeStore())
    const first = await users.bootstrapAdmin('my-admin-pass-1')
    expect(first.created).toBe(true)
    expect(first.username).toBe('admin')
    expect(first.password).toBe('my-admin-pass-1')

    const second = await users.bootstrapAdmin('x')
    expect(second.created).toBe(false)
  })

  it('bootstrapAdmin 未提供密码时生成随机密码(≥8 位)', async () => {
    const users = new UserService(makeStore())
    const boot = await users.bootstrapAdmin(null)
    expect(boot.created).toBe(true)
    expect(boot.password.length).toBeGreaterThanOrEqual(8)
  })

  it('创建/校验密码,登录验证', async () => {
    const users = new UserService(makeStore())
    await users.bootstrapAdmin('admin-pass-123')
    const admin = users.getByUsername('admin')!
    expect(await users.verifyPassword(admin, 'admin-pass-123')).toBe(true)
    expect(await users.verifyPassword(admin, 'wrong')).toBe(false)
  })

  it('创建用户校验:重名/短密码/院级必须绑学院', async () => {
    const users = new UserService(makeStore())
    await users.bootstrapAdmin('admin-pass-123')
    await expect(users.create({ username: 'admin', password: 'pass-12345', role: 'school' }))
      .rejects.toThrow(/用户名已存在/)
    await expect(users.create({ username: 'x', password: 'short', role: 'school' }))
      .rejects.toThrow(/至少 8 位/)
    await expect(users.create({ username: 'y', password: 'pass-12345', role: 'college' }))
      .rejects.toThrow(/必须绑定学院/)
  })

  it('院级用户创建并绑定学院;列表不含密码哈希', async () => {
    const users = new UserService(makeStore())
    await users.bootstrapAdmin('admin-pass-123')
    const created = await users.create({ username: 'wenyuan', password: 'pass-12345', role: 'college', college: '文学院' })
    expect(created.college).toBe('文学院')
    expect(created.role).toBe('college')

    const list = users.list()
    expect(list).toHaveLength(2)
    for (const u of list) {
      expect(u).not.toHaveProperty('salt')
      expect(u).not.toHaveProperty('hash')
    }
  })

  it('最后一个管理员不可删除', async () => {
    const users = new UserService(makeStore())
    const boot = await users.bootstrapAdmin('admin-pass-123')
    const admin = users.getByUsername('admin')!
    expect(() => users.remove(admin.id)).toThrow(/最后一个管理员/)
    void boot
  })

  it('update 改角色/密码/禁用', async () => {
    const users = new UserService(makeStore())
    await users.bootstrapAdmin('admin-pass-123')
    const created = await users.create({ username: 'school1', password: 'pass-12345', role: 'school' })
    const updated = await users.update(created.id, { role: 'college', college: '教育学院' })
    expect(updated!.role).toBe('college')
    expect(updated!.college).toBe('教育学院')

    const pwd = await users.update(created.id, { password: 'new-pass-123' })
    const stored = users.getById(created.id)!
    expect(pwd).not.toBeNull()
    expect(await users.verifyPassword(stored, 'new-pass-123')).toBe(true)
  })
})

describe('SessionService', () => {
  it('create → resolve → revoke', () => {
    const sessions = new SessionService(makeStore(), 60_000)
    const token = sessions.create('user-1')
    expect(sessions.resolve(token)).toBe('user-1')
    sessions.revoke(token)
    expect(sessions.resolve(token)).toBeNull()
  })

  it('过期会话返回 null 并删除', () => {
    const store = makeStore()
    const sessions = new SessionService(store, 50) // 50ms TTL
    const token = sessions.create('user-1')
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(sessions.resolve(token)).toBeNull()
        // 已惰性删除
        const doc = store.readDoc<{ entries: Record<string, unknown> }>('sessions', { entries: {} })
        expect(Object.keys(doc.entries)).toHaveLength(0)
        resolve()
      }, 80)
    })
  })
})
