import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getClient } from '../lib/api/client'
import { useSettingsStore } from '../stores/settings-store'
import { useChatStore } from '../stores/chat-store'
import { useSSE } from '../lib/hooks/useSSE'
import { executeCommand, getCommands, parseCommand } from '../lib/commands'
import { ModelSelector } from '../components/ModelSelector'
import type { ThreadDetail, TurnItemRecord, StartTurnRequest, ThreadRecord } from '../types'

const DEFAULT_MODEL = 'deepseek-v4-pro'

export function ChatView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const settings = useSettingsStore()
  const chat = useChatStore()
  const { connect, disconnect } = useSSE()

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(!!id)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [creatingThread, setCreatingThread] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const [updatingThread, setUpdatingThread] = useState(false)
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL)
  const [systemMessages, setSystemMessages] = useState<Array<{ id: string; text: string }>>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const latestSeqRef = useRef<number>(0)
  const threadIdRef = useRef<string | null>(id ?? null)

  const client = getClient(settings)

  // Keep ref in sync
  useEffect(() => {
    threadIdRef.current = id ?? null
  }, [id])

  // ── Load existing thread (when /chat/:id) ──
  useEffect(() => {
    if (!id) {
      chat.clear()
      setLoading(false)
      return
    }

    async function load() {
      try {
        setLoading(true)
        setError(null)
        const detail: ThreadDetail = await client.getThread(id!)
        chat.setThreadDetail(detail.thread, detail.turns, detail.items)
        latestSeqRef.current = detail.latest_seq
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load thread')
      } finally {
        setLoading(false)
      }
    }

    chat.clear()
    void load()

    return () => {
      disconnect()
    }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll ──
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [chat.items, chat.streamingContent])

  // ── Start SSE listener ──
  const startEventStream = useCallback(
    (threadId: string) => {
      const url = client.getEventsUrl(threadId, latestSeqRef.current || undefined)
      connect(url, {
        onError: (err) => {
          console.error('SSE error:', err.message)
          chat.stopStreaming()
        },
        onClose: () => {
          chat.stopStreaming()
        },
      })
    },
    [client, connect, chat]
  )

  // ── Create thread + send first message (when no :id) ──
  const createAndSend = useCallback(
    async (text: string) => {
      setCreatingThread(true)
      try {
        // Create thread
        const thread: ThreadRecord = await client.createThread({ model: selectedModel })
        const newId = thread.id

        // Send first turn
        const req: StartTurnRequest = { prompt: text, model: selectedModel }
        const res = await client.startTurn(newId, req)
        chat.startStreaming()
        chat.addTurn(res.turn)
        latestSeqRef.current = 0

        // Navigate to the thread URL (triggers load + SSE)
        navigate(`/chat/${newId}`, { replace: true })
        startEventStream(newId)
      } catch (err) {
        chat.stopStreaming()
        setError(err instanceof Error ? err.message : 'Failed to create conversation')
      } finally {
        setCreatingThread(false)
      }
    },
    [client, chat, navigate, startEventStream]
  )

  // ── Send message to existing thread ──
  const sendToThread = useCallback(
    async (threadId: string, text: string) => {
      setSending(true)
      try {
        const req: StartTurnRequest = { prompt: text, model: selectedModel }
        const res = await client.startTurn(threadId, req)
        chat.addTurn(res.turn)
        startEventStream(threadId)
      } catch (err) {
        chat.stopStreaming()
        setError(err instanceof Error ? err.message : 'Failed to send message')
      } finally {
        setSending(false)
      }
    },
    [client, chat, startEventStream]
  )

  // ── New Chat ──
  const handleNewChat = useCallback(() => {
    disconnect()
    chat.clear()
    setSystemMessages([])
    navigate('/', { replace: true })
  }, [disconnect, chat, navigate])

  // ── Handle Send ──
  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || chat.isStreaming || sending || creatingThread) return

    // Check for slash commands
    if (text.startsWith('/')) {
      const result = await executeCommand(text, {
        newChat: handleNewChat,
        openThread: (tid) => navigate(`/chat/${tid}`),
        openHistory: () => navigate('/history'),
        openSettings: () => navigate('/settings'),
        threadId: threadIdRef.current,
      })

      if (result && result.handled) {
        setInput('')
        const msgText = result.message
        if (msgText) {
          setSystemMessages((prev) => [
            ...prev,
            { id: `sys-${Date.now()}`, text: msgText },
          ])
        }
        return
      }
    }

    setInput('')
    chat.startStreaming()

    const threadId = threadIdRef.current
    if (threadId) {
      void sendToThread(threadId, text)
    } else {
      void createAndSend(text)
    }
  }, [input, chat, sending, creatingThread, sendToThread, createAndSend, handleNewChat, navigate])

  // ── Thread title ──
  const threadTitle =
    chat.thread?.title ??
    chat.turns.find((t) => t.input_summary)?.input_summary ??
    (id ? `Chat ${id.slice(0, 8)}` : 'New Chat')

  const handleStartEditTitle = () => {
    setEditedTitle(threadTitle)
    setEditingTitle(true)
  }

  const handleSaveTitle = async () => {
    if (!id || !editedTitle.trim()) {
      setEditingTitle(false)
      return
    }
    setUpdatingThread(true)
    try {
      const updated = await client.updateThread(id, { title: editedTitle.trim() })
      chat.setThread(updated)
    } catch {
      // silently fail, keep original title
    } finally {
      setUpdatingThread(false)
      setEditingTitle(false)
    }
  }

  // ── Command hints ──
  const commandHints = useMemo(() => {
    if (!input.startsWith('/')) return []
    const parsed = parseCommand(input)
    if (!parsed) return getCommands()
    return getCommands().filter((c) => c.name.startsWith(parsed.name))
  }, [input])

  // ── Derive display items ──
  const displayItems = [...chat.items]
  if (
    chat.streamingItemId &&
    chat.streamingContent &&
    !displayItems.some((i) => i.id === chat.streamingItemId)
  ) {
    displayItems.push({
      schema_version: 2,
      id: chat.streamingItemId,
      turn_id: '',
      kind: 'agent_message',
      status: 'in_progress',
      summary: '',
      detail: chat.streamingContent,
      started_at: new Date().toISOString(),
    })
  }

  // Group items by turn
  const turnsWithItems = chat.turns.map((turn) => ({
    turn,
    items: displayItems.filter((item) => item.turn_id === turn.id),
  }))
  const orphanItems = displayItems.filter(
    (item) => !chat.turns.some((t) => t.id === item.turn_id) || item.turn_id === ''
  )

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        Loading...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-gray-400">
        <p className="text-red-400">{error}</p>
        <button
          onClick={() => { chat.clear(); navigate('/') }}
          className="rounded-lg bg-gray-800 px-4 py-2 text-sm hover:bg-gray-700 transition-colors"
        >
          ← New Chat
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-6 py-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {editingTitle ? (
            <input
              type="text"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveTitle()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
              onBlur={() => void handleSaveTitle()}
              disabled={updatingThread}
              className="flex-1 rounded border border-blue-500 bg-gray-900 px-2 py-1 text-sm text-gray-200 focus:outline-none"
              autoFocus
            />
          ) : (
            <h2
              className="text-sm font-medium text-gray-200 truncate cursor-pointer hover:text-blue-400 transition-colors"
              onClick={handleStartEditTitle}
              title="Click to rename"
            >
              {threadTitle}
            </h2>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500">
            {updatingThread ? 'Saving...' : creatingThread ? 'Creating...' : chat.isStreaming ? 'Streaming...' : sending ? 'Sending...' : 'Ready'}
          </span>
          {!id && (
            <ModelSelector
              value={selectedModel}
              onChange={setSelectedModel}
              disabled={chat.isStreaming}
            />
          )}
          {id && (
            <button
              onClick={handleNewChat}
              className="rounded-lg border border-gray-700 px-3 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
            >
              + New
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {displayItems.length === 0 && systemMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-600">
            <span className="text-5xl mb-4">🐳</span>
            <p className="text-sm">Start a conversation</p>
            <p className="text-xs text-gray-700 mt-2">Type /help to see commands</p>
          </div>
        )}

        {/* System messages (slash command output) */}
        {systemMessages.map((msg) => (
          <div key={msg.id} className="mb-4 flex justify-center">
            <div className="max-w-[80%] rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-gray-400">
              <div className="prose-stream">
                <Markdown content={msg.text} />
              </div>
            </div>
          </div>
        ))}

        {turnsWithItems.map(({ turn, items }) => (
          <div key={turn.id} className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <div className="h-px flex-1 bg-gray-800" />
              <span className="text-xs text-gray-600">
                {turn.input_summary || new Date(turn.created_at).toLocaleTimeString()}
              </span>
              <div className="h-px flex-1 bg-gray-800" />
            </div>
            {items.map((item) => (
              <ChatItem
                key={item.id}
                item={item}
                isStreaming={item.id === chat.streamingItemId}
                streamingContent={
                  item.id === chat.streamingItemId ? chat.streamingContent : undefined
                }
              />
            ))}
          </div>
        ))}

        {orphanItems.length > 0 && (
          <div className="mb-6">
            {orphanItems.map((item) => (
              <ChatItem
                key={item.id}
                item={item}
                isStreaming={item.id === chat.streamingItemId}
                streamingContent={
                  item.id === chat.streamingItemId ? chat.streamingContent : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 shrink-0">
        {/* Command hints */}
        {commandHints.length > 0 && (
          <div className="px-6 pt-2">
            <div className="flex flex-wrap gap-1">
              {commandHints.map((cmd) => (
                <button
                  key={cmd.name}
                  onClick={() => {
                    setInput(`/${cmd.name} `)
                    inputRef.current?.focus()
                  }}
                  className="rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-400 hover:border-blue-600 hover:text-blue-400 transition-colors"
                  title={cmd.description}
                >
                  /{cmd.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 px-6 py-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !chat.isStreaming) {
                e.preventDefault()
                void handleSend()
              }
            }}
            placeholder={
              creatingThread
                ? 'Creating conversation...'
                : chat.isStreaming
                  ? 'Waiting for response...'
                  : 'Type a message... (/ for commands, Enter to send)'
            }
            disabled={chat.isStreaming || creatingThread}
            className="flex-1 rounded-xl border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={() => void handleSend()}
            disabled={chat.isStreaming || creatingThread || !input.trim()}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Send
          </button>
          {chat.isStreaming && (
            <button
              onClick={disconnect}
              className="rounded-xl bg-red-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-600 transition-colors"
            >
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Individual Chat Item ──
function ChatItem({
  item,
  isStreaming,
  streamingContent,
}: {
  item: TurnItemRecord
  isStreaming: boolean
  streamingContent?: string
}) {
  const content = streamingContent ?? item.detail ?? item.summary

  switch (item.kind) {
    case 'user_message':
      return (
        <div className="mb-4 flex justify-end">
          <div className="max-w-[80%] rounded-2xl bg-blue-600 px-4 py-3 text-sm text-white">
            <p className="whitespace-pre-wrap">{item.summary}</p>
          </div>
        </div>
      )

    case 'agent_message':
      return (
        <div className="mb-4 flex justify-start">
          <div
            className={`max-w-[80%] rounded-2xl bg-gray-800 px-4 py-3 text-sm text-gray-200 ${
              isStreaming ? 'cursor-blink' : ''
            }`}
          >
            <div className="prose-stream">
              <Markdown content={content} />
            </div>
          </div>
        </div>
      )

    case 'agent_reasoning':
      return (
        <div className="mb-4 flex justify-start">
          <div className="max-w-[80%] rounded-2xl border border-gray-700 bg-gray-900/50 px-4 py-3 text-sm text-gray-400 italic">
            <details>
              <summary className="cursor-pointer text-xs text-gray-500">🤔 Reasoning</summary>
              <div className="mt-2 whitespace-pre-wrap">{content}</div>
            </details>
          </div>
        </div>
      )

    case 'tool_call':
      return <ToolCallItem item={item} />

    case 'error':
      return (
        <div className="mb-4 flex justify-start">
          <div className="max-w-[80%] rounded-xl border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
            ❌ {content || 'An error occurred'}
          </div>
        </div>
      )

    case 'file_change':
    case 'command_execution':
    case 'context_compaction':
    case 'status':
      return (
        <div className="mb-2 flex justify-center">
          <span className="text-xs text-gray-600">
            {item.summary || item.kind}
            {item.detail && `: ${item.detail.slice(0, 100)}`}
          </span>
        </div>
      )

    default:
      return (
        <div className="mb-4 flex justify-start">
          <div className="max-w-[80%] rounded-2xl bg-gray-800 px-4 py-3 text-sm text-gray-400">
            <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(item, null, 2)}</pre>
          </div>
        </div>
      )
  }
}

// ── Tool Call Item (with approval) ──
function ToolCallItem({ item }: { item: TurnItemRecord }) {
  const [approvalState, setApprovalState] = useState<'pending' | 'approving' | 'approved' | 'rejected'>('pending')
  const [approvalError, setApprovalError] = useState<string | null>(null)

  // Override with actual item status if it's already completed
  const effectiveStatus = item.status === 'completed' ? 'approved' : item.status === 'failed' ? 'rejected' : approvalState

  const handleApprove = async () => {
    setApprovalState('approving')
    setApprovalError(null)
    try {
      // The approval uses the tool_call item id
      await getClient().approve(item.id)
      setApprovalState('approved')
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : 'Failed')
      setApprovalState('pending')
    }
  }

  const handleReject = async () => {
    setApprovalState('approving')
    setApprovalError(null)
    try {
      await getClient().reject(item.id)
      setApprovalState('rejected')
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : 'Failed')
      setApprovalState('pending')
    }
  }

  return (
    <div className="mb-4 flex justify-start">
      <div className="max-w-[80%] rounded-xl border border-yellow-800 bg-yellow-900/20 px-4 py-3 text-sm">
        <p className="text-xs font-medium text-yellow-400">🛠 Tool Call</p>
        <p className="mt-1 text-gray-300">{item.summary}</p>
        {item.detail && (
          <pre className="mt-1 max-h-24 overflow-auto text-xs text-gray-500">
            {item.detail}
          </pre>
        )}

        {/* Status */}
        <p className="mt-1 text-xs text-gray-500">
          {item.status === 'completed'
            ? '✓ Completed'
            : item.status === 'failed'
              ? '✗ Failed'
              : effectiveStatus === 'approved'
                ? '✓ Approved'
                : effectiveStatus === 'rejected'
                  ? '✗ Rejected'
                  : 'Waiting for approval...'}
        </p>

        {/* Approval buttons */}
        {item.status === 'in_progress' && effectiveStatus === 'pending' && (
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleApprove}
              disabled={approvalState === 'approving'}
              className="rounded-lg bg-green-700 px-3 py-1 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50 transition-colors"
            >
              {approvalState === 'approving' ? '...' : '✓ Approve'}
            </button>
            <button
              onClick={handleReject}
              disabled={approvalState === 'approving'}
              className="rounded-lg bg-red-700 px-3 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
            >
              ✗ Reject
            </button>
          </div>
        )}

        {approvalError && (
          <p className="mt-1 text-xs text-red-400">{approvalError}</p>
        )}
      </div>
    </div>
  )
}

// ── Markdown Renderer ──
function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre({ children }) {
          return <pre className="my-2 overflow-x-auto rounded-lg bg-gray-900 p-4 text-sm">{children}</pre>
        },
        code({ className, children, ...props }) {
          // Inline code (not in a pre block)
          const isInline = !className
          if (isInline) {
            return (
              <code className="rounded bg-gray-800 px-1 py-0.5 text-sm font-mono text-emerald-400" {...props}>
                {children}
              </code>
            )
          }
          // Fenced code block — add copy button
          return (
            <div className="group relative">
              <CopyButton text={String(children)} />
              <code className={`${className} text-gray-200`} {...props}>
                {children}
              </code>
            </div>
          )
        },
        p({ children }) {
          return <p className="mb-2 leading-relaxed last:mb-0">{children}</p>
        },
        ul({ children }) {
          return <ul className="mb-2 list-disc pl-5">{children}</ul>
        },
        ol({ children }) {
          return <ol className="mb-2 list-decimal pl-5">{children}</ol>
        },
        li({ children }) {
          return <li className="mb-1">{children}</li>
        },
        table({ children }) {
          return <div className="my-2 overflow-x-auto"><table className="min-w-full border-collapse border border-gray-700 text-sm">{children}</table></div>
        },
        th({ children }) {
          return <th className="border border-gray-700 bg-gray-900 px-3 py-1.5 text-left font-medium">{children}</th>
        },
        td({ children }) {
          return <td className="border border-gray-700 px-3 py-1.5">{children}</td>
        },
        blockquote({ children }) {
          return <blockquote className="my-2 border-l-2 border-gray-600 pl-3 italic text-gray-400">{children}</blockquote>
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }}
      className="absolute right-2 top-2 rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-600 hover:text-white"
    >
      {copied ? '✓ Copied' : '📋'}
    </button>
  )
}
