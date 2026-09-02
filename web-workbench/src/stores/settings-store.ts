import { create } from 'zustand'
import { serverApi, setServerToken } from '../lib/api/server'
import type { AppSettings, PersonEntry, PersonnelLevel } from '../types'

/**
 * 人员名单与连接配置 store。
 *
 * - 连接配置(apiUrl/authToken)保留在 localStorage(客户端设置)
 * - 人员名单以服务端为准:启动时 hydrate,CRUD 乐观更新 + 服务端回写,
 *   失败回滚并设置 personnelError。旧 localStorage 名单仅通过
 *   lib/migration.ts 的一次性迁移进入服务端,不再作为运行时存储。
 */

const STORAGE_KEY = 'codewhale-settings'

// ── Legacy NameEntry (kept for backward compat with monitor-prompt.ts) ──
export interface NameEntry {
  name: string
  department?: string
  role?: string
}

// ── Load helpers ──
function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as T
  } catch { /* corrupted */ }
  return fallback
}

function saveJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

// ── ID generator(乐观更新用临时 id,服务端回写后替换)──
function genId(): string {
  return `person-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function toNameList(entries: PersonEntry[]): NameEntry[] {
  return entries.map((p) => ({
    name: p.name,
    department: p.college || p.department,
    role: p.role || p.category,
  }))
}

// ── Settings ──
function defaultRuntimeApiUrl(): string {
  const configured = import.meta.env.VITE_RUNTIME_API_URL
  if (configured && configured !== 'auto') return configured

  return '/runtime-api'
}

function defaultSettings(): AppSettings {
  return {
    apiUrl: defaultRuntimeApiUrl(),
    authToken: import.meta.env.VITE_AUTH_TOKEN ?? '',
  }
}

function isLocalRuntimeHost(host: string): boolean {
  return host === 'localhost'
    || host.endsWith('.local')
    || !host.includes('.')
    || host.startsWith('127.')
    || host.startsWith('10.')
    || host.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
}

function shouldUseDefaultApiUrl(apiUrl: string, defaultApiUrl: string): boolean {
  const trimmed = apiUrl.trim()
  if (!trimmed || trimmed === defaultApiUrl) return false
  if (defaultApiUrl !== '/runtime-api') return false
  if (trimmed === '/runtime-api') return false

  try {
    const saved = new URL(trimmed.startsWith('http') ? trimmed : `http://${trimmed}`)
    return saved.port === '7878'
      && isLocalRuntimeHost(saved.hostname)
  } catch {
    return false
  }
}

function normalizeSettings(settings: AppSettings, fallback = defaultSettings()): AppSettings {
  const next = { ...fallback, ...settings }
  if (typeof next.apiUrl !== 'string') {
    next.apiUrl = ''
  }
  if (typeof next.authToken !== 'string') {
    next.authToken = ''
  }
  if (fallback.apiUrl === '/runtime-api' || !next.apiUrl.trim() || shouldUseDefaultApiUrl(next.apiUrl, fallback.apiUrl)) {
    next.apiUrl = fallback.apiUrl
  }
  if (fallback.authToken) {
    next.authToken = fallback.authToken
  }
  return next
}

function loadSettings(): AppSettings {
  const fallback = defaultSettings()
  const settings = loadJson<AppSettings>(STORAGE_KEY, fallback)
  const next = normalizeSettings(settings, fallback)
  if (next.apiUrl !== settings.apiUrl || next.authToken !== settings.authToken) {
    saveJson(STORAGE_KEY, { apiUrl: next.apiUrl, authToken: next.authToken })
  }
  return next
}

export type PersonnelStatus = 'idle' | 'loading' | 'ready' | 'error'

// ── Store ──
interface SettingsStore extends AppSettings {
  personnel: PersonEntry[]
  personnelStatus: PersonnelStatus
  personnelError: string | null

  updateSettings: (patch: Partial<AppSettings>) => void
  isConfigured: () => boolean

  // Personnel: 服务端为源(AppShell 启动时调用 hydratePersonnel)
  hydratePersonnel: () => Promise<void>
  addPerson: (entry: Omit<PersonEntry, 'id' | 'createdAt' | 'updatedAt'>) => void
  updatePerson: (id: string, patch: Partial<PersonEntry>) => void
  deletePerson: (id: string) => void
  importPersonnel: (entries: PersonEntry[]) => void
  clearPersonnel: () => void
  replacePersonnel: (entries: PersonEntry[]) => Promise<void>

  // Query helpers
  getSchoolPersons: () => PersonEntry[]
  getCollegePersons: (college: string) => PersonEntry[]
  getIndividualPersons: () => PersonEntry[]

  // Legacy compat (used by ChatView → monitor-prompt.ts)
  getFlatNameList: () => NameEntry[]
  nameList: NameEntry[]
  setNameList: (list: NameEntry[]) => void
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '操作失败'
}

export const useSettingsStore = create<SettingsStore>((set, get) => {
  const initialSettings = loadSettings()
  setServerToken(initialSettings.authToken)

  return {
    ...initialSettings,
    personnel: [],
    personnelStatus: 'idle',
    personnelError: null,
    nameList: [],

    updateSettings: (patch) => {
      const merged = normalizeSettings({ ...get(), ...patch })
      set({ apiUrl: merged.apiUrl, authToken: merged.authToken })
      saveJson(STORAGE_KEY, { apiUrl: merged.apiUrl, authToken: merged.authToken })
      setServerToken(merged.authToken)
    },

    isConfigured: () => {
      const { apiUrl } = get()
      return apiUrl.length > 0
    },

    // ── Personnel: 服务端持久化 ──
    hydratePersonnel: async () => {
      if (get().personnelStatus === 'loading') return
      set({ personnelStatus: 'loading', personnelError: null })
      try {
        const db = await serverApi.listPersonnel()
        set({
          personnel: db.entries,
          nameList: toNameList(db.entries),
          personnelStatus: 'ready',
        })
      } catch (err) {
        set({ personnelStatus: 'error', personnelError: errorMessage(err) })
      }
    },

    addPerson: (entry) => {
      const now = new Date().toISOString()
      const temp: PersonEntry = { id: genId(), ...entry, createdAt: now, updatedAt: now }
      const optimistic = [...get().personnel, temp]
      set({ personnel: optimistic, nameList: toNameList(optimistic) })

      serverApi.createPersonnel(entry)
        .then((created) => {
          const list = get().personnel.map((p) => (p.id === temp.id ? created : p))
          set({ personnel: list, nameList: toNameList(list) })
        })
        .catch((err) => {
          const rollback = get().personnel.filter((p) => p.id !== temp.id)
          set({ personnel: rollback, nameList: toNameList(rollback), personnelError: errorMessage(err) })
        })
    },

    updatePerson: (id, patch) => {
      const prev = get().personnel
      const now = new Date().toISOString()
      const optimistic = prev.map((p) =>
        p.id === id ? { ...p, ...patch, updatedAt: now } : p
      )
      set({ personnel: optimistic, nameList: toNameList(optimistic) })

      serverApi.updatePersonnel(id, patch)
        .then((updated) => {
          const list = get().personnel.map((p) => (p.id === id ? updated : p))
          set({ personnel: list, nameList: toNameList(list) })
        })
        .catch((err) => {
          set({ personnel: prev, nameList: toNameList(prev), personnelError: errorMessage(err) })
        })
    },

    deletePerson: (id) => {
      const prev = get().personnel
      const optimistic = prev.filter((p) => p.id !== id)
      set({ personnel: optimistic, nameList: toNameList(optimistic) })

      serverApi.deletePersonnel(id)
        .catch((err) => {
          set({ personnel: prev, nameList: toNameList(prev), personnelError: errorMessage(err) })
        })
    },

    importPersonnel: (entries) => {
      if (entries.length === 0) return
      const prev = get().personnel
      const optimistic = [...prev, ...entries]
      set({ personnel: optimistic, nameList: toNameList(optimistic) })

      serverApi.bulkPersonnel(entries)
        .then((res) => {
          set({ personnel: res.entries, nameList: toNameList(res.entries) })
        })
        .catch((err) => {
          set({ personnel: prev, nameList: toNameList(prev), personnelError: errorMessage(err) })
        })
    },

    clearPersonnel: () => {
      const prev = get().personnel
      set({ personnel: [], nameList: [] })

      serverApi.clearPersonnel()
        .catch((err) => {
          set({ personnel: prev, nameList: toNameList(prev), personnelError: errorMessage(err) })
        })
    },

    replacePersonnel: async (entries) => {
      const db = await serverApi.replacePersonnel(entries)
      set({ personnel: db.entries, nameList: toNameList(db.entries), personnelStatus: 'ready' })
    },

    // ── Query helpers ──
    getSchoolPersons: () => get().personnel.filter((p) => p.level === 'school'),

    getCollegePersons: (college: string) =>
      get().personnel.filter((p) => p.level === 'college' && p.college === college),

    getIndividualPersons: () =>
      get().personnel.filter((p) => p.level === 'individual'),

    // ── Legacy compat ──
    getFlatNameList: () => toNameList(get().personnel),

    setNameList: (list) => {
      // Legacy import: convert flat list to structured personnel
      const now = new Date().toISOString()
      const migrated: PersonEntry[] = list.map((entry) => ({
        id: genId(),
        name: entry.name,
        level: 'individual' as PersonnelLevel,
        category: entry.role || '其他',
        college: entry.department || undefined,
        role: entry.role || undefined,
        createdAt: now,
        updatedAt: now,
      }))
      get().importPersonnel(migrated)
    },
  }
})
