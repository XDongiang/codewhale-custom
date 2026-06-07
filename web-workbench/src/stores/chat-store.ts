import { create } from 'zustand'
import type { ThreadRecord, TurnRecord, TurnItemRecord } from '../types'

interface ChatState {
  // Data
  thread: ThreadRecord | null
  turns: TurnRecord[]
  items: TurnItemRecord[]

  // Streaming state
  isStreaming: boolean
  /** item_id that is currently receiving deltas */
  streamingItemId: string | null
  /** accumulated delta text for the streaming item (before item.completed) */
  streamingContent: string

  // Actions
  setThreadDetail: (thread: ThreadRecord, turns: TurnRecord[], items: TurnItemRecord[]) => void
  setThread: (thread: ThreadRecord) => void

  /** Called when a new turn starts (from StartTurnResponse or turn.started event) */
  addTurn: (turn: TurnRecord) => void

  /** Add or update an item in the list */
  upsertItem: (item: TurnItemRecord) => void

  /** Handle an item.delta event — append streaming content */
  appendStreamDelta: (itemId: string, text: string) => void

  /** Mark an item as completed with final detail */
  completeItem: (itemId: string, detail?: string) => void

  startStreaming: () => void
  stopStreaming: () => void

  clear: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  thread: null,
  turns: [],
  items: [],
  isStreaming: false,
  streamingItemId: null,
  streamingContent: '',

  setThreadDetail: (thread, turns, items) =>
    set({ thread, turns, items }),

  setThread: (thread) => set({ thread }),

  addTurn: (turn) =>
    set((s) => {
      // Avoid duplicates
      if (s.turns.some((t) => t.id === turn.id)) return s
      return { turns: [...s.turns, turn] }
    }),

  upsertItem: (item) =>
    set((s) => {
      const idx = s.items.findIndex((i) => i.id === item.id)
      if (idx >= 0) {
        const next = [...s.items]
        next[idx] = item
        return { items: next }
      }
      return { items: [...s.items, item] }
    }),

  appendStreamDelta: (itemId, text) =>
    set((s) => {
      // If this is a new streaming item, set it
      if (s.streamingItemId !== itemId) {
        return { streamingItemId: itemId, streamingContent: text }
      }
      return { streamingContent: s.streamingContent + text }
    }),

  completeItem: (itemId, detail) =>
    set((s) => {
      const existing = s.items.find((i) => i.id === itemId)
      if (!existing) {
        return { streamingItemId: null, streamingContent: '' }
      }
      const updated: TurnItemRecord = {
        schema_version: existing.schema_version,
        id: existing.id,
        turn_id: existing.turn_id,
        kind: existing.kind,
        status: 'completed',
        summary: existing.summary,
        detail: detail ?? (s.streamingContent || existing.detail || ''),
        metadata: existing.metadata,
        artifact_refs: existing.artifact_refs,
        started_at: existing.started_at,
        ended_at: existing.ended_at,
      }
      const next = s.items.map((i) => (i.id === itemId ? updated : i))
      return {
        items: next,
        streamingItemId: null,
        streamingContent: '',
      }
    }),

  startStreaming: () => set({ isStreaming: true }),
  stopStreaming: () =>
    set({
      isStreaming: false,
      streamingItemId: null,
      streamingContent: '',
    }),

  clear: () =>
    set({
      thread: null,
      turns: [],
      items: [],
      isStreaming: false,
      streamingItemId: null,
      streamingContent: '',
    }),
}))
