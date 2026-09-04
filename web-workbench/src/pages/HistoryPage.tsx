import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { CodeWhaleClient, getClient } from '../lib/api/client'
import { useSettingsStore } from '../stores/settings-store'
import type { ThreadRecord } from '../types'

export function HistoryPage() {
  const navigate = useNavigate()
  const settings = useSettingsStore()
  const [threads, setThreads] = useState<ThreadRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const clientRef = useRef<CodeWhaleClient>(getClient(settings))

  useEffect(() => {
    clientRef.current = getClient(settings)
  }, [settings.apiUrl, settings.authToken])

  const loadThreads = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await clientRef.current.listThreads()
      data.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      setThreads(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载历史记录失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  const handleArchive = async (id: string) => {
    if (!confirm('确定归档此对话？归档后将不在历史列表中显示。')) return
    try {
      await clientRef.current.archiveThread(id)
      setThreads((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : '归档失败')
    }
  }

  const handleStartRename = (t: ThreadRecord) => {
    setEditTitle(t.title || '')
    setEditingId(t.id)
  }

  const handleSaveRename = async (id: string) => {
    try {
      const updated = await clientRef.current.updateThread(id, { title: editTitle.trim() || null })
      setThreads((prev) => prev.map((t) => (t.id === id ? updated : t)))
    } catch {
      // silently ignore
    }
    setEditingId(null)
  }

  function threadLabel(t: ThreadRecord): string {
    if (t.title) return t.title
    const date = new Date(t.created_at).toLocaleDateString('zh-CN')
    return `${t.model} · ${date}`
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">对话历史</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            共 {threads.length} 个对话
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadThreads()}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
          >
            🔄 刷新
          </button>
          <button
            onClick={() => navigate('/')}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          >
            + 新建对话
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-400">
            {error}
            <button onClick={() => void loadThreads()} className="ml-3 underline hover:text-red-600">
              重试
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-500">加载中...</div>
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <span className="text-4xl mb-3">📋</span>
            <p className="text-sm">暂无对话历史</p>
            <button
              onClick={() => navigate('/')}
              className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            >
              开始新对话
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {threads.map((t) => (
              <div
                key={t.id}
                onClick={() => navigate(`/chat/${t.id}`)}
                className="group flex cursor-pointer items-center justify-between px-6 py-3.5 hover:bg-slate-100 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  {editingId === t.id ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSaveRename(t.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      onBlur={() => void handleSaveRename(t.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full rounded border border-blue-500 bg-white px-2 py-0.5 text-sm text-slate-800 focus:outline-none"
                      autoFocus
                    />
                  ) : (
                    <p className="truncate text-sm font-medium text-slate-800 group-hover:text-slate-900">
                      {threadLabel(t)}
                    </p>
                  )}
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t.mode === 'agent' ? 'Agent 模式' : t.mode} · {new Date(t.updated_at).toLocaleString('zh-CN')}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStartRename(t)
                    }}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-600 transition-colors"
                    title="重命名"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleArchive(t.id)
                    }}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-red-400 transition-colors"
                    title="归档"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
