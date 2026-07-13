import { create } from 'zustand'
import type { AppSettings } from '../types'

const STORAGE_KEY = 'codewhale-settings'
const NAMELIST_KEY = 'codewhale-namelist'

// ── Name list entry ──
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

function loadSettings(): AppSettings {
  return loadJson<AppSettings>(STORAGE_KEY, {
    apiUrl: import.meta.env.VITE_RUNTIME_API_URL ?? 'http://localhost:7878',
    authToken: import.meta.env.VITE_AUTH_TOKEN ?? '',
  })
}

function loadNameList(): NameEntry[] {
  return loadJson<NameEntry[]>(NAMELIST_KEY, [])
}

// ── Store ──
interface SettingsStore extends AppSettings {
  nameList: NameEntry[]

  updateSettings: (patch: Partial<AppSettings>) => void
  isConfigured: () => boolean

  setNameList: (list: NameEntry[]) => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...loadSettings(),
  nameList: loadNameList(),

  updateSettings: (patch) => {
    set(patch)
    const merged = { ...get(), ...patch }
    saveJson(STORAGE_KEY, { apiUrl: merged.apiUrl, authToken: merged.authToken })
  },

  isConfigured: () => {
    const { apiUrl } = get()
    return apiUrl.length > 0
  },

  setNameList: (list) => {
    set({ nameList: list })
    saveJson(NAMELIST_KEY, list)
  },
}))
