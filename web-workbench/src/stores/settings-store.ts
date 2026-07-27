import { create } from 'zustand'
import type { AppSettings, PersonEntry, PersonnelLevel } from '../types'

const STORAGE_KEY = 'codewhale-settings'
const NAMELIST_KEY = 'codewhale-namelist'       // old key (flat list)
const PERSONNEL_KEY = 'codewhale-personnel'      // new key (structured)
const PERSONNEL_SCHEMA_VERSION = 1

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

// ── ID generator ──
function genId(): string {
  return `person-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ── Migration: old flat NameEntry[] → structured PersonEntry[] ──
function migrateFromNameList(): PersonEntry[] {
  const oldRaw = localStorage.getItem(NAMELIST_KEY)
  if (!oldRaw) return []
  try {
    const oldList = JSON.parse(oldRaw) as NameEntry[]
    if (!Array.isArray(oldList) || oldList.length === 0) return []
    const now = new Date().toISOString()
    return oldList.map((entry) => ({
      id: genId(),
      name: entry.name,
      level: 'individual' as PersonnelLevel,
      category: entry.role || '其他',
      college: entry.department || undefined,
      role: entry.role || undefined,
      createdAt: now,
      updatedAt: now,
    }))
  } catch { return [] }
}

// ── Personnel load/save ──
function loadPersonnel(): PersonEntry[] {
  const raw = loadJson<{ version: number; entries: PersonEntry[] } | null>(PERSONNEL_KEY, null as never)
  if (raw && raw.version && Array.isArray(raw.entries) && raw.entries.length > 0) {
    return raw.entries
  }

  // Attempt migration from old flat list
  const migrated = migrateFromNameList()
  if (migrated.length > 0) {
    saveJson(PERSONNEL_KEY, {
      version: PERSONNEL_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      entries: migrated,
    })
  }
  return migrated
}

function savePersonnel(entries: PersonEntry[]) {
  saveJson(PERSONNEL_KEY, {
    version: PERSONNEL_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    entries,
  })
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

// ── Store ──
interface SettingsStore extends AppSettings {
  personnel: PersonEntry[]

  updateSettings: (patch: Partial<AppSettings>) => void
  isConfigured: () => boolean

  // Personnel CRUD
  addPerson: (entry: Omit<PersonEntry, 'id' | 'createdAt' | 'updatedAt'>) => void
  updatePerson: (id: string, patch: Partial<PersonEntry>) => void
  deletePerson: (id: string) => void
  importPersonnel: (entries: PersonEntry[]) => void
  clearPersonnel: () => void

  // Query helpers
  getSchoolPersons: () => PersonEntry[]
  getCollegePersons: (college: string) => PersonEntry[]
  getIndividualPersons: () => PersonEntry[]

  // Legacy compat (used by ChatView → monitor-prompt.ts)
  getFlatNameList: () => NameEntry[]
  nameList: NameEntry[]
  setNameList: (list: NameEntry[]) => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => {
  const initialPersonnel = loadPersonnel()

  return {
    ...loadSettings(),
    personnel: initialPersonnel,

    // Backward-compat nameList (derived from personnel)
    nameList: initialPersonnel.map(p => ({
      name: p.name,
      department: p.college || p.department,
      role: p.role || p.category,
    })),

    updateSettings: (patch) => {
      const merged = normalizeSettings({ ...get(), ...patch })
      set({ apiUrl: merged.apiUrl, authToken: merged.authToken })
      saveJson(STORAGE_KEY, { apiUrl: merged.apiUrl, authToken: merged.authToken })
    },

    isConfigured: () => {
      const { apiUrl } = get()
      return apiUrl.length > 0
    },

    // ── Personnel CRUD ──
    addPerson: (entry) => {
      const now = new Date().toISOString()
      const newEntry: PersonEntry = {
        id: genId(),
        ...entry,
        createdAt: now,
        updatedAt: now,
      }
      const updated = [...get().personnel, newEntry]
      set({ personnel: updated })
      savePersonnel(updated)
      // Sync legacy nameList
      set({ nameList: updated.map(p => ({ name: p.name, department: p.college || p.department, role: p.role || p.category })) })
    },

    updatePerson: (id, patch) => {
      const now = new Date().toISOString()
      const updated = get().personnel.map(p =>
        p.id === id ? { ...p, ...patch, updatedAt: now } : p
      )
      set({ personnel: updated })
      savePersonnel(updated)
      set({ nameList: updated.map(p => ({ name: p.name, department: p.college || p.department, role: p.role || p.category })) })
    },

    deletePerson: (id) => {
      const updated = get().personnel.filter(p => p.id !== id)
      set({ personnel: updated })
      savePersonnel(updated)
      set({ nameList: updated.map(p => ({ name: p.name, department: p.college || p.department, role: p.role || p.category })) })
    },

    importPersonnel: (entries) => {
      const updated = [...get().personnel, ...entries]
      set({ personnel: updated })
      savePersonnel(updated)
      set({ nameList: updated.map(p => ({ name: p.name, department: p.college || p.department, role: p.role || p.category })) })
    },

    clearPersonnel: () => {
      set({ personnel: [], nameList: [] })
      savePersonnel([])
    },

    // ── Query helpers ──
    getSchoolPersons: () => get().personnel.filter(p => p.level === 'school'),

    getCollegePersons: (college: string) =>
      get().personnel.filter(p => p.level === 'college' && p.college === college),

    getIndividualPersons: () =>
      get().personnel.filter(p => p.level === 'individual'),

    // ── Legacy compat ──
    getFlatNameList: () =>
      get().personnel.map(p => ({
        name: p.name,
        department: p.college || p.department,
        role: p.role || p.category,
      })),

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
      set({ personnel: migrated, nameList: migrated.map(p => ({ name: p.name, department: p.college || p.department, role: p.role || p.category })) })
      savePersonnel(migrated)
    },
  }
})
