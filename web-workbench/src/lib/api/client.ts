import { ApiRequestError } from '../../types'
import type {
  AppSettings,
  ApiError,
  ThreadRecord,
  ThreadDetail,
  CreateThreadRequest,
  StartTurnRequest,
  StartTurnResponse,
} from '../../types'

// ── API Client ──

export class CodeWhaleClient {
  private baseUrl: string
  private token: string

  constructor(settings: AppSettings) {
    this.baseUrl = settings.apiUrl.replace(/\/$/, '')
    this.token = settings.authToken
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`
    }
    return h
  }

  private async request<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...opts,
      headers: { ...this.headers(), ...opts.headers },
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null
      throw new ApiRequestError(res.status, body ?? undefined)
    }
    return res.json() as Promise<T>
  }

  // ── Health ──
  async health(): Promise<{ status: string }> {
    return this.request('/health')
  }

  // ── Threads ──
  async listThreads(): Promise<ThreadRecord[]> {
    return this.request('/v1/threads')
  }

  async createThread(req: CreateThreadRequest = {}): Promise<ThreadRecord> {
    return this.request('/v1/threads', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async getThread(id: string): Promise<ThreadDetail> {
    return this.request(`/v1/threads/${id}`)
  }

  async updateThread(id: string, patch: Record<string, unknown>): Promise<ThreadRecord> {
    return this.request(`/v1/threads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  }

  /** Archive a thread (hides from active list; no permanent delete in API) */
  async archiveThread(id: string): Promise<ThreadRecord> {
    return this.updateThread(id, { archived: true })
  }

  async forkThread(id: string): Promise<ThreadRecord> {
    return this.request(`/v1/threads/${id}/fork`, { method: 'POST' })
  }

  // ── Turns ──
  async startTurn(threadId: string, req: StartTurnRequest): Promise<StartTurnResponse> {
    return this.request(`/v1/threads/${threadId}/turns`, {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  // ── SSE Events URL (GET) ──
  getEventsUrl(threadId: string, sinceSeq?: number): string {
    let url = `${this.baseUrl}/v1/threads/${encodeURIComponent(threadId)}/events`
    const params = new URLSearchParams()
    if (sinceSeq !== undefined && sinceSeq > 0) {
      params.set('since_seq', String(sinceSeq))
    }
    const qs = params.toString()
    return qs ? `${url}?${qs}` : url
  }

  // ── Approval ──
  async approve(id: string): Promise<void> {
    await this.request(`/v1/approvals/${id}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'approve' }),
    })
  }

  async reject(id: string): Promise<void> {
    await this.request(`/v1/approvals/${id}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'reject' }),
    })
  }
}

// ── Singleton Factory ──
let clientInstance: CodeWhaleClient | null = null

export function getClient(settings?: AppSettings): CodeWhaleClient {
  if (settings) {
    clientInstance = new CodeWhaleClient(settings)
  }
  if (!clientInstance) {
    throw new Error('API client not initialized. Call getClient(settings) first.')
  }
  return clientInstance
}
