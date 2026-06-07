import { create } from 'zustand'
import type { AppSettings } from '../types'

const STORAGE_KEY = 'codewhale-settings'

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return JSON.parse(raw) as AppSettings
    }
  } catch {
    // corrupted data, reset
  }
  return {
    apiUrl: import.meta.env.VITE_RUNTIME_API_URL ?? 'http://localhost:7878',
    authToken: import.meta.env.VITE_AUTH_TOKEN ?? '',
  }
}

function saveSettings(s: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

interface SettingsStore extends AppSettings {
  updateSettings: (patch: Partial<AppSettings>) => void
  isConfigured: () => boolean
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...loadSettings(),
  updateSettings: (patch) => {
    set(patch)
    saveSettings({ ...get(), ...patch } as AppSettings)
  },
  isConfigured: () => {
    const { apiUrl } = get()
    return apiUrl.length > 0
  },
}))
