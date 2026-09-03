import type { PersonEntry, PersonnelLevel, ReportLevel } from '../../types'

/**
 * 华师 AI Server API 客户端。
 * 所有请求走相对路径(/api/*),开发模式由 Vite 代理到 server,生产模式同源。
 * token 通过 setServerToken 注入(与 settings-store 单向关联,避免循环依赖)。
 */

let currentToken: string = ''

export function setServerToken(token: string): void {
  currentToken = token
}

/** 401 统一处理(由 App 挂载方注册:清除会话并跳转登录)。 */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn
}

export interface AuthUser {
  id: string
  username: string
  role: 'admin' | 'school' | 'college'
  college?: string
  disabled: boolean
  createdAt: string
  updatedAt: string
}

export interface ServerPersonnelDB {
  version: number
  updatedAt: string
  entries: PersonEntry[]
}

export interface ServerReport {
  id: string
  dept: string
  timeRange: string
  content: string
  createdAt: string
  threadId?: string
  level: ReportLevel
  personName?: string
}

export interface SendMailPayload {
  to: string
  subject: string
  body: string
  confirmationToken?: string
}

export interface SendMailResponse {
  ok: boolean
  result?: {
    action?: string
    attachment_count?: number
    from?: string
    subject?: string
    to?: string[]
    confirmation_required?: boolean
    confirmation_token?: string
    expires_in?: number
    data?: unknown
  }
  error?: string
}

class ServerApi {
  private async request<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`
    }
    const res = await fetch(path, { ...opts, headers: { ...headers, ...opts.headers } })
    if (!res.ok) {
      let message = `请求失败 (${res.status})`
      try {
        const body = (await res.json()) as { error?: string } | null
        if (body?.error) message = body.error
      } catch {
        // keep default message
      }
      if (res.status === 401 && !path.startsWith('/api/auth/login')) {
        onUnauthorized?.()
      }
      throw new Error(message)
    }
    return res.json() as Promise<T>
  }

  // ── Auth ──
  login(username: string, password: string): Promise<{ ok: boolean; token: string; user: AuthUser }> {
    return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  }

  logout(): Promise<{ ok: boolean }> {
    return this.request('/api/auth/logout', { method: 'POST' })
  }

  me(): Promise<{ ok: boolean; user: AuthUser }> {
    return this.request('/api/auth/me')
  }

  listUsers(): Promise<AuthUser[]> {
    return this.request('/api/users')
  }

  createUser(input: { username: string; password: string; role: string; college?: string }): Promise<AuthUser> {
    return this.request('/api/users', { method: 'POST', body: JSON.stringify(input) })
  }

  updateUser(id: string, patch: { role?: string; college?: string; password?: string; disabled?: boolean }): Promise<AuthUser> {
    return this.request(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
  }

  deleteUser(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  // ── Health ──
  health(): Promise<{ ok: boolean; runtime: { reachable: boolean } }> {
    return this.request('/api/health')
  }

  // ── Personnel ──
  listPersonnel(): Promise<ServerPersonnelDB> {
    return this.request('/api/personnel')
  }

  createPersonnel(entry: Omit<PersonEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<PersonEntry> {
    return this.request('/api/personnel', { method: 'POST', body: JSON.stringify(entry) })
  }

  updatePersonnel(id: string, patch: Partial<PersonEntry>): Promise<PersonEntry> {
    return this.request(`/api/personnel/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  }

  deletePersonnel(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/personnel/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  clearPersonnel(): Promise<{ ok: boolean }> {
    return this.request('/api/personnel', { method: 'DELETE' })
  }

  bulkPersonnel(entries: PersonEntry[]): Promise<{ ok: boolean; added: number; entries: PersonEntry[] }> {
    return this.request('/api/personnel/bulk', {
      method: 'POST',
      body: JSON.stringify({ entries }),
    })
  }

  /** 整表替换(用于备份还原/一次性迁移的权威写入) */
  replacePersonnel(entries: PersonEntry[]): Promise<ServerPersonnelDB> {
    return this.request('/api/personnel', {
      method: 'PUT',
      body: JSON.stringify({ entries }),
    })
  }

  // ── Reports ──
  listReports(): Promise<ServerReport[]> {
    return this.request('/api/reports')
  }

  createReport(report: Omit<ServerReport, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Promise<ServerReport> {
    return this.request('/api/reports', { method: 'POST', body: JSON.stringify(report) })
  }

  deleteReport(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  replaceReports(reports: ServerReport[]): Promise<ServerReport[]> {
    return this.request('/api/reports', { method: 'PUT', body: JSON.stringify({ reports }) })
  }

  // ── Mail ──
  sendReportMail(payload: SendMailPayload): Promise<SendMailResponse> {
    return this.request('/api/mail/send-report', { method: 'POST', body: JSON.stringify(payload) })
  }
}

export const serverApi = new ServerApi()

export type { PersonnelLevel }
