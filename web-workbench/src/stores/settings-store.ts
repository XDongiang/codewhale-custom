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
    const merged = normalizeSettings({ ...get(), ...patch })
    set({ apiUrl: merged.apiUrl, authToken: merged.authToken })
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
