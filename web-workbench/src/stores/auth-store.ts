import { create } from 'zustand'
import { serverApi, setServerToken, type AuthUser } from '../lib/api/server'
import { useSettingsStore } from './settings-store'

/**
 * 登录会话 store。
 * token/user 持久化在 localStorage(ccnu-auth);token 同时镜像到
 * settings-store.authToken,供 Runtime 客户端与 SSE 使用(服务端代理会替换为 Runtime 凭证)。
 */

const AUTH_KEY = 'ccnu-auth'

export type AuthStatus = 'loading' | 'ready' | 'guest'

interface AuthState {
  token: string | null
  user: AuthUser | null
  status: AuthStatus
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** 启动时用持久化 token 恢复会话;无效则进入 guest */
  hydrate: () => Promise<void>
  /** 401 本地登出(不调服务端,用于 token 失效场景) */
  forceLogout: () => void
}

function loadPersisted(): { token: string | null; user: AuthUser | null } {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { token?: string; user?: AuthUser }
      if (typeof parsed.token === 'string' && parsed.user) {
        return { token: parsed.token, user: parsed.user }
      }
    }
  } catch {
    // corrupted, reset
  }
  return { token: null, user: null }
}

export const useAuthStore = create<AuthState>((set, get) => {
  const persisted = loadPersisted()
  if (persisted.token) {
    setServerToken(persisted.token)
    useSettingsStore.getState().updateSettings({ authToken: persisted.token })
  }

  const clearSession = () => {
    localStorage.removeItem(AUTH_KEY)
    setServerToken('')
    useSettingsStore.getState().updateSettings({ authToken: '' })
    set({ token: null, user: null, status: 'guest' })
  }

  return {
    token: persisted.token,
    user: persisted.user,
    status: persisted.token ? 'loading' : 'guest',

    login: async (username, password) => {
      const { token, user } = await serverApi.login(username, password)
      setServerToken(token)
      useSettingsStore.getState().updateSettings({ authToken: token })
      localStorage.setItem(AUTH_KEY, JSON.stringify({ token, user }))
      set({ token, user, status: 'ready' })
    },

    logout: async () => {
      try {
        await serverApi.logout()
      } catch {
        // 服务端不可达也允许本地登出
      }
      clearSession()
    },

    hydrate: async () => {
      if (!get().token) {
        if (get().status === 'loading') set({ status: 'guest' })
        return
      }
      try {
        const { user } = await serverApi.me()
        localStorage.setItem(AUTH_KEY, JSON.stringify({ token: get().token, user }))
        set({ user, status: 'ready' })
      } catch {
        clearSession()
      }
    },

    forceLogout: () => {
      if (!get().token) return
      clearSession()
    },
  }
})
