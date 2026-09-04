import { useRef, useCallback, useState } from 'react'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import type { RuntimeEvent, TurnItemRecord } from '../../types'
import { useSettingsStore } from '../../stores/settings-store'
import { useChatStore } from '../../stores/chat-store'

interface SSEHandlers {
  onEvent?: (event: RuntimeEvent) => void
  onError?: (error: Error) => void
  onClose?: () => void
}

const MAX_RETRY_MS = 30_000

/**
 * SSE 连接管理。
 *
 * - connect 接受 URL 工厂:重连时重新取值(携带最新 since_seq),避免重放/丢事件
 * - 同一 URL 的活跃连接直接复用,新消息不再掐断在途流
 * - 断线/服务端关闭自动重连(1s→30s 指数退避),仅用户主动 disconnect 停止
 */
export function useSSE() {
  const abortRef = useRef<AbortController | null>(null)
  const lastUrlRef = useRef<string | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelayRef = useRef(1000)
  const stoppedRef = useRef(true)
  const [isConnected, setIsConnected] = useState(false)
  const token = useSettingsStore((s) => s.authToken)

  const clearRetry = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }

  const connect = useCallback(
    (getUrl: () => string, handlers: SSEHandlers) => {
      const url = getUrl()

      // 同一订阅(同 URL)已有活跃连接 → 复用
      if (!stoppedRef.current && abortRef.current && lastUrlRef.current === url) {
        return
      }

      // 切换订阅 → 停旧连接
      abortRef.current?.abort()
      clearRetry()
      if (lastUrlRef.current !== url) {
        retryDelayRef.current = 1000
      }
      stoppedRef.current = false
      lastUrlRef.current = url

      const open = () => {
        if (stoppedRef.current) return
        const controller = new AbortController()
        abortRef.current = controller
        setIsConnected(true)

        fetchEventSource(getUrl(), {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
          openWhenHidden: true,

          async onopen() {
            // 连接成功:重置退避
            retryDelayRef.current = 1000
          },

          onmessage(msg) {
            try {
              if (!msg.data || msg.data === 'keepalive') return
              const event = JSON.parse(msg.data) as RuntimeEvent
              handlers.onEvent?.(event)
              handleRuntimeEvent(event)
            } catch {
              // Ignore non-JSON events
            }
          },

          onerror(err) {
            handlers.onError?.(err)
            setIsConnected(false)
            if (stoppedRef.current) return
            const delay = retryDelayRef.current
            retryDelayRef.current = Math.min(retryDelayRef.current * 2, MAX_RETRY_MS)
            clearRetry()
            retryTimerRef.current = setTimeout(open, delay)
          },

          onclose() {
            setIsConnected(false)
            handlers.onClose?.()
            // 服务端关闭也保持订阅(带退避);离开页面由调用方主动 disconnect
            if (stoppedRef.current) return
            const delay = retryDelayRef.current
            retryDelayRef.current = Math.min(retryDelayRef.current * 2, MAX_RETRY_MS)
            clearRetry()
            retryTimerRef.current = setTimeout(open, delay)
          },
        }).catch((err) => {
          if (stoppedRef.current) return
          if (err.name !== 'AbortError') {
            handlers.onError?.(err)
          } else {
            handlers.onClose?.()
          }
          setIsConnected(false)
        })
      }

      open()
    },
    [token]
  )

  const disconnect = useCallback(() => {
    stoppedRef.current = true
    clearRetry()
    abortRef.current?.abort()
    abortRef.current = null
    lastUrlRef.current = null
    setIsConnected(false)
  }, [])

  return { connect, disconnect, isConnected }
}

// ── Runtime Event Handler ──
// Maps codewhale serve SSE events to the chat store

function handleRuntimeEvent(event: RuntimeEvent) {
  const chat = useChatStore.getState()

  switch (event.event) {
    case 'turn.started': {
      if (event.payload.turn) {
        chat.addTurn(event.payload.turn)
      } else if (event.turn_id) {
        chat.addTurn({
          schema_version: event.schema_version,
          id: event.turn_id,
          thread_id: event.thread_id,
          status: 'in_progress',
          input_summary: '',
          created_at: event.timestamp,
          item_ids: [],
          steer_count: 0,
        })
      }
      break
    }

    case 'turn.lifecycle': {
      if (event.payload.turn) {
        chat.addTurn(event.payload.turn)
      }
      break
    }

    case 'item.started': {
      if (event.payload.item) {
        chat.upsertItem(event.payload.item)
      } else if (event.item_id) {
        const kind = (event.payload.kind ?? 'agent_message') as TurnItemRecord['kind']
        chat.upsertItem({
          schema_version: event.schema_version,
          id: event.item_id,
          turn_id: event.turn_id ?? '',
          kind,
          status: 'in_progress',
          summary: '',
          detail: '',
          started_at: event.timestamp,
        } as TurnItemRecord)
      }
      break
    }

    case 'item.delta': {
      const kind = event.payload.kind
      if (kind === 'agent_message' && event.payload.delta) {
        if (event.item_id) {
          chat.appendStreamDelta(event.item_id, event.payload.delta)
        }
      } else if (kind === 'agent_reasoning' && event.payload.delta) {
        if (event.item_id) {
          chat.appendStreamDelta(event.item_id, `> 🤔 ${event.payload.delta}\n\n`)
        }
      }
      break
    }

    case 'item.completed': {
      if (event.item_id) {
        const detail = event.payload.delta ?? event.payload.item?.detail
        chat.completeItem(event.item_id, detail)
      }
      if (event.payload.item) {
        chat.upsertItem(event.payload.item)
      }
      break
    }

    case 'item.failed': {
      if (event.item_id) {
        chat.completeItem(event.item_id, `\n\n❌ ${event.payload.error ?? 'Item failed'}`)
      }
      break
    }

    case 'thread.started':
    case 'thread.updated': {
      if (event.payload.thread) {
        chat.setThread(event.payload.thread)
      }
      break
    }

    case 'message_stop':
    case 'turn.completed': {
      chat.stopStreaming()
      break
    }

    default:
      // Unknown events are silently ignored
      break
  }
}
