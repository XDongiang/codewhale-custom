import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createApp, type App } from '../src/app.js'
import type { ServerConfig } from '../src/config.js'

let app: App
let base: string

beforeAll(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccnu-route-'))
  const config: ServerConfig = {
    port: 0,
    authToken: 'runtime-token',
    runtimeUrl: 'http://127.0.0.1:59999', // 必然不可达,验证代理错误路径
    xhsBin: 'xhs-not-exists',
    agentlyBin: 'agently-not-exists',
    dataDir,
    staticDir: null,
    xvfbArgs: ['-a', '-s', '-nolisten unix +extension RANDR'],
    adminPassword: 'admin-pass-123',
    sessionTtlMs: 60_000,
  }
  app = createApp(config)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const addr = app.server.address() as AddressInfo
  base = `http://127.0.0.1:${addr.port}`
  // 显式创建初始管理员(等价于 bootstrap 引导)
  await app.deps.users.bootstrapAdmin('admin-pass-123')
})

afterAll(async () => {
  await app.close()
})

async function api(pathname: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`
  const res = await fetch(`${base}${pathname}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, json }
}

async function login(username: string, password: string): Promise<string> {
  const { status, json } = await api('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  })
  expect(status).toBe(200)
  return (json as { token: string }).token
}

describe('认证', () => {
  it('health 开放访问', async () => {
    const { status } = await api('/api/health')
    expect(status).toBe(200)
  })

  it('未登录访问受保护接口返回 401', async () => {
    for (const p of ['/api/personnel', '/api/reports', '/api/users', '/runtime-api/v1/threads']) {
      const { status } = await api(p)
      expect(status).toBe(401)
    }
  })

  it('登录成功返回 token 与用户信息,错误密码 401', async () => {
    const { status, json } = await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin-pass-123' },
    })
    expect(status).toBe(200)
    const body = json as { token: string; user: { username: string; role: string } }
    expect(body.token).toBeTruthy()
    expect(body.user.username).toBe('admin')
    expect(body.user.role).toBe('admin')

    const bad = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'nope' } })
    expect(bad.status).toBe(401)
  })

  it('me 返回当前用户;登出后 token 失效', async () => {
    const token = await login('admin', 'admin-pass-123')
    const me = await api('/api/auth/me', { token })
    expect(me.status).toBe(200)
    expect((me.json as { user: { username: string } }).user.username).toBe('admin')

    await api('/api/auth/logout', { method: 'POST', token })
    const after = await api('/api/auth/me', { token })
    expect(after.status).toBe(401)
  })
})

describe('RBAC:人员名单', () => {
  let adminToken: string
  let collegeToken: string

  beforeAll(async () => {
    adminToken = await login('admin', 'admin-pass-123')
    await api('/api/personnel', {
      method: 'PUT',
      token: adminToken,
      body: {
        entries: [
          { id: 'stu-1', name: '张三', level: 'college' as const, category: '院领导', college: '文学院' },
          { id: 'stu-2', name: '李四', level: 'individual' as const, category: '个人', college: '物理学院' },
          { id: 'stu-3', name: '校长', level: 'school' as const, category: '校领导' },
          { id: 'stu-4', name: '王五', level: 'college' as const, category: '院领导', college: '文学院' },
        ],
      },
    })
    // 建院级账号并登录
    await api('/api/users', {
      method: 'POST',
      token: adminToken,
      body: { username: 'wenyuan', password: 'pass-12345', role: 'college', college: '文学院' },
    })
    collegeToken = await login('wenyuan', 'pass-12345')
  })

  it('admin 看到全部', async () => {
    const { json } = await api('/api/personnel', { token: adminToken })
    expect((json as { entries: unknown[] }).entries).toHaveLength(4)
  })

  it('院级只看到本学院条目', async () => {
    const { json } = await api('/api/personnel', { token: collegeToken })
    const entries = (json as { entries: Array<{ name: string }> }).entries
    expect(entries.map((e) => e.name)).toEqual(['张三', '王五'])
  })

  it('院级不能写名单', async () => {
    for (const opts of [
      { method: 'POST', body: { name: 'x', level: 'college' } },
      { method: 'PUT', body: { entries: [] } },
      { method: 'DELETE' },
    ]) {
      const { status } = await api('/api/personnel', { token: collegeToken, ...opts })
      expect(status).toBe(403)
    }
  })
})

describe('RBAC:报告', () => {
  let adminToken: string
  let collegeToken: string

  beforeAll(async () => {
    adminToken = await login('admin', 'admin-pass-123')
    collegeToken = await login('wenyuan', 'pass-12345')
    await api('/api/reports', {
      method: 'PUT',
      token: adminToken,
      body: {
        reports: [
          { id: 'r-1', dept: '文学院', level: 'college' as const, content: '文学院报告' },
          { id: 'r-2', dept: '物理学院', level: 'college' as const, content: '物理学院报告' },
          { id: 'r-3', dept: '校长', level: 'individual' as const, content: '个人报告' },
        ],
      },
    })
  })

  it('admin 看到全部,院级只看到本院学院级报告', async () => {
    const all = (await api('/api/reports', { token: adminToken })).json as Array<{ id: string }>
    expect(all.map((r) => r.id)).toEqual(['r-1', 'r-2', 'r-3'])

    const scoped = (await api('/api/reports', { token: collegeToken })).json as Array<{ id: string }>
    expect(scoped.map((r) => r.id)).toEqual(['r-1'])
  })

  it('院级只能创建本学院报告,跨学院被拒', async () => {
    const ok = await api('/api/reports', { method: 'POST', token: collegeToken, body: { dept: '文学院', level: 'college', content: '本院新报告' } })
    expect(ok.status).toBe(201)

    const bad = await api('/api/reports', { method: 'POST', token: collegeToken, body: { dept: '物理学院', level: 'college', content: '越权' } })
    expect(bad.status).toBe(400)

    const personal = await api('/api/reports', { method: 'POST', token: collegeToken, body: { dept: '张三', level: 'individual', content: '个人' } })
    expect(personal.status).toBe(400)
  })

  it('院级不能删除他人报告,不能整表替换', async () => {
    const del = await api('/api/reports/r-2', { method: 'DELETE', token: collegeToken })
    expect(del.status).toBe(400)

    const put = await api('/api/reports', { method: 'PUT', token: collegeToken, body: { reports: [] } })
    expect(put.status).toBe(403)
  })
})

describe('RBAC:用户管理', () => {
  let adminToken: string
  let collegeToken: string

  beforeAll(async () => {
    adminToken = await login('admin', 'admin-pass-123')
    collegeToken = await login('wenyuan', 'pass-12345')
    await api('/api/users', {
      method: 'POST',
      token: adminToken,
      body: { username: 'school1', password: 'pass-12345', role: 'school' },
    })
  })

  it('非 admin 不能访问用户管理', async () => {
    const { status } = await api('/api/users', { token: collegeToken })
    expect(status).toBe(403)
  })

  it('admin 列出/创建/改密/禁用用户', async () => {
    const list = (await api('/api/users', { token: adminToken })).json as Array<{ username: string }>
    expect(list.map((u) => u.username)).toContain('school1')

    const created = (await api('/api/users', {
      method: 'POST',
      token: adminToken,
      body: { username: 'school2', password: 'pass-12345', role: 'school' },
    })).json as { id: string }

    const patched = await api(`/api/users/${created.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: { disabled: true },
    })
    expect(patched.status).toBe(200)
    expect((patched.json as { disabled: boolean }).disabled).toBe(true)
  })

  it('不能操作自身', async () => {
    const admin = (await api('/api/auth/me', { token: adminToken })).json as { user: { id: string } }
    const { status } = await api(`/api/users/${admin.user.id}`, { method: 'DELETE', token: adminToken })
    expect(status).toBe(400)
  })
})

describe('代理与路由兜底', () => {
  it('runtime 代理要求登录且不可达时返回 502', async () => {
    const token = await login('admin', 'admin-pass-123')
    const res = await api('/runtime-api/v1/threads', { token })
    expect(res.status).toBe(502)
    expect((res.json as { error: string }).error).toMatch(/Runtime/)
  })

  it('未知 API 返回 404', async () => {
    const token = await login('admin', 'admin-pass-123')
    const { status } = await api('/api/nope', { token })
    expect(status).toBe(404)
  })
})
