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

  // Update client when settings change
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
      setError(err instanceof Error ? err.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }, []) // stable — no dependency on client object

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  const handleArchive = async (id: string) => {
    if (!confirm('Archive this conversation? It will be hidden from history.')) return
    try {
      await clientRef.current.archiveThread(id)
      setThreads((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive')
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
    const date = new Date(t.created_at).toLocaleDateString()
    return `${t.model} · ${date}`
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">History</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {threads.length} conversation{threads.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadThreads()}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
          >
            🔄 Refresh
          </button>
          <button
            onClick={() => navigate('/')}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            + New Chat
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="mx-6 mt-4 rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
            {error}
            <button onClick={() => void loadThreads()} className="ml-3 underline hover:text-red-200">
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500">Loading...</div>
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <span className="text-4xl mb-3">📋</span>
            <p className="text-sm">No conversation history yet</p>
            <button
              onClick={() => navigate('/')}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Start a new chat
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {threads.map((t) => (
              <div
                key={t.id}
                onClick={() => navigate(`/chat/${t.id}`)}
                className="flex cursor-pointer items-center justify-between px-6 py-3 hover:bg-gray-900 transition-colors"
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
                      className="w-full rounded border border-blue-500 bg-gray-900 px-2 py-0.5 text-sm text-gray-200 focus:outline-none"
                      autoFocus
                    />
                  ) : (
                    <p className="truncate text-sm font-medium text-gray-200">
                      {threadLabel(t)}
                    </p>
                  )}
                  <p className="text-xs text-gray-500">
                    {t.mode} · {new Date(t.updated_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStartRename(t)
                    }}
                    className="rounded p-1 text-gray-600 hover:bg-gray-800 hover:text-blue-400 transition-colors"
                    title="Rename"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleArchive(t.id)
                    }}
                    className="rounded p-1 text-gray-600 hover:bg-gray-800 hover:text-red-400 transition-colors"
                    title="Archive"
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
