import { useRef, useCallback, useState } from 'react'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import type { RuntimeEvent, TurnItemRecord } from '../../types'
import { useSettingsStore } from '../../stores/settings-store'
import { useChatStore } from '../../stores/chat-store'

interface SSEHandlers {
  onError?: (error: Error) => void
  onClose?: () => void
}

export function useSSE() {
  const abortRef = useRef<AbortController | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const token = useSettingsStore((s) => s.authToken)

  const connect = useCallback(
    (url: string, handlers: SSEHandlers) => {
      abortRef.current?.abort()

      const controller = new AbortController()
      abortRef.current = controller

      setIsConnected(true)

      fetchEventSource(url, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
        openWhenHidden: true,

        onmessage(msg) {
          try {
            if (!msg.data || msg.data === 'keepalive') return

            const event = JSON.parse(msg.data) as RuntimeEvent
            handleRuntimeEvent(event)
          } catch {
            // Ignore non-JSON events (keepalives, etc.)
          }
        },

        onerror(err) {
          handlers.onError?.(err)
          setIsConnected(false)
          throw err // Stop retrying
        },

        onclose() {
          setIsConnected(false)
          handlers.onClose?.()
        },
      }).catch((err) => {
        if (err.name !== 'AbortError') {
          handlers.onError?.(err)
        }
        setIsConnected(false)
      })
    },
    [token]
  )

  const disconnect = useCallback(() => {
    abortRef.current?.abort()
    setIsConnected(false)
  }, [])

  return { connect, disconnect, isConnected }
}

// ── Runtime Event Handler ──
// Maps codewhale serve SSE events to the chat store

function handleRuntimeEvent(event: RuntimeEvent) {
  const chat = useChatStore.getState()

  switch (event.event) {
    // ── Turn lifecycle ──
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
      // Update turn status if we have the turn
      if (event.payload.turn) {
        chat.addTurn(event.payload.turn)
      }
      break
    }

    // ── Item lifecycle ──
    case 'item.started': {
      if (event.payload.item) {
        chat.upsertItem(event.payload.item)
      } else if (event.item_id) {
        // Create a minimal item placeholder
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
        // Show reasoning as a prefix
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

    // ── Thread events ──
    case 'thread.started':
    case 'thread.updated': {
      if (event.payload.thread) {
        chat.setThread(event.payload.thread)
      }
      break
    }

    // ── Turn ended events ──
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
