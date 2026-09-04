/**
 * 服务端 → CodeWhale Runtime 的轻量客户端。
 * 用于知识库问答等"服务端主动发起 agent 任务"的场景(与前端 MonitorPage 的轮询模式等价)。
 */

export interface RuntimeTurnItem {
  id: string
  kind: string
  status: string
  summary?: string
  detail?: string
}

export interface RuntimeAgentResult {
  answer: string
  threadId: string
}

export function createRuntimeClient(runtimeUrl: string, token: string) {
  const base = new URL(runtimeUrl)

  async function request<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      throw new Error(`Runtime ${res.status}`)
    }
    return res.json() as Promise<T>
  }

  async function createThread(model: string): Promise<string> {
    const res = await request<{ thread: { id: string } }>('/v1/threads', {
      method: 'POST',
      body: { model, auto_approve: true },
    })
    return res.thread.id
  }

  async function startTurn(threadId: string, prompt: string): Promise<void> {
    await request(`/v1/threads/${encodeURIComponent(threadId)}/turns`, {
      method: 'POST',
      body: { prompt, auto_approve: true },
    })
  }

  async function getThread(threadId: string): Promise<{
    turns: Array<{ id: string; status: string }>
    items: RuntimeTurnItem[]
  }> {
    return request(`/v1/threads/${encodeURIComponent(threadId)}`)
  }

  /**
   * 启动一次 agent 任务并轮询到完成,返回拼接的 agent 消息文本。
   * 超时(约 3 分钟)或失败抛错。
   */
  async function ask(prompt: string, model = 'deepseek-v4-pro'): Promise<RuntimeAgentResult> {
    const threadId = await createThread(model)
    await startTurn(threadId, prompt)

    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const detail = await getThread(threadId)
      const lastTurn = detail.turns[detail.turns.length - 1]
      if (!lastTurn) continue

      if (lastTurn.status === 'completed') {
        const answer = detail.items
          .filter((it) => it.kind === 'agent_message')
          .map((it) => it.detail || it.summary || '')
          .filter(Boolean)
          .join('\n\n')
        if (!answer) throw new Error('Runtime 未返回内容')
        return { answer, threadId }
      }
      if (lastTurn.status === 'failed' || lastTurn.status === 'canceled') {
        throw new Error('问答任务执行失败')
      }
    }
    throw new Error('问答任务超时')
  }

  return { ask, createThread, startTurn, getThread }
}

export type RuntimeClient = ReturnType<typeof createRuntimeClient>
