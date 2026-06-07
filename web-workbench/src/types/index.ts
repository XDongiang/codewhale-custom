// ── Thread (matches codewhale serve ThreadRecord) ──
export interface ThreadRecord {
  schema_version: number
  id: string
  title?: string // user-settable via PATCH, added v0.8.10
  created_at: string
  updated_at: string
  model: string
  workspace: string
  mode: string
  allow_shell: boolean
  trust_mode: boolean
  auto_approve: boolean
  archived: boolean
  coherence_state: string
  latest_turn_id?: string
  latest_response_bookmark?: string
  system_prompt?: string
  task_id?: string
}

// ── Turn ──
export type TurnStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'canceled'

export interface TurnRecord {
  schema_version: number
  id: string
  thread_id: string
  status: TurnStatus
  input_summary: string
  created_at: string
  started_at?: string
  ended_at?: string
  duration_ms?: number
  usage?: Record<string, unknown>
  error?: string
  item_ids: string[]
  steer_count: number
}

// ── Turn Item ──
export type TurnItemKind =
  | 'user_message'
  | 'agent_message'
  | 'agent_reasoning'
  | 'tool_call'
  | 'file_change'
  | 'command_execution'
  | 'context_compaction'
  | 'status'
  | 'error'

export type TurnItemStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'canceled'

export interface TurnItemRecord {
  schema_version: number
  id: string
  turn_id: string
  kind: TurnItemKind
  status: TurnItemStatus
  summary: string
  detail?: string
  metadata?: Record<string, unknown>
  artifact_refs?: string[]
  started_at?: string
  ended_at?: string
}

// ── Thread Detail (GET /v1/threads/{id}) ──
export interface ThreadDetail {
  thread: ThreadRecord
  turns: TurnRecord[]
  items: TurnItemRecord[]
  latest_seq: number
}

// ── API Request/Response ──
export interface CreateThreadRequest {
  model?: string
  workspace?: string
  mode?: string
  allow_shell?: boolean
  trust_mode?: boolean
  auto_approve?: boolean
  title?: string
}

export interface StartTurnRequest {
  prompt: string
  model?: string
  mode?: string
  allow_shell?: boolean
  trust_mode?: boolean
  auto_approve?: boolean
  input_summary?: string
}

export interface StartTurnResponse {
  thread: ThreadRecord
  turn: TurnRecord
}

// ── SSE Event (GET /v1/threads/{id}/events) ──
export interface RuntimeEvent {
  schema_version: number
  seq: number
  event: string
  kind: string
  thread_id: string
  turn_id?: string
  item_id?: string
  timestamp: string
  created_at?: string
  payload: RuntimeEventPayload
}

export interface RuntimeEventPayload {
  kind?: string // "agent_message" | "agent_reasoning" | "tool_call"
  delta?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  // item started/completed fields
  item?: TurnItemRecord
  turn?: TurnRecord
  thread?: ThreadRecord
  error?: string
}

// ── API Error ──
export interface ApiError {
  code: number
  message: string
}

export class ApiRequestError extends Error {
  constructor(
    public statusCode: number,
    public apiError?: ApiError
  ) {
    super(apiError?.message ?? `Request failed (${statusCode})`)
    this.name = 'ApiRequestError'
  }
}

// ── Settings ──
export interface AppSettings {
  apiUrl: string
  authToken: string
}
