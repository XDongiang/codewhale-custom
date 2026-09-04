import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth-store'
import { serverApi } from '../lib/api/server'

type ServerState = 'checking' | 'up' | 'down'

export function LoginPage() {
  const navigate = useNavigate()
  const auth = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [serverState, setServerState] = useState<ServerState>('checking')

  // 周期检测服务连通性;服务恢复时自动重试会话恢复,成功后路由守卫自动进入主界面
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        await serverApi.health()
        if (cancelled) return
        setServerState('up')
        if (auth.token && auth.status !== 'ready') {
          await auth.retryHydrate()
        }
      } catch {
        if (!cancelled) setServerState('down')
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [auth])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await auth.login(username.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <span className="text-4xl">📡</span>
          <h1 className="mt-3 text-lg font-semibold text-slate-800">华师 AI 工作台</h1>
          <p className="mt-1 text-xs text-slate-500">请使用管理员分配的账号登录</p>
        </div>

        {/* 服务连接状态 */}
        {serverState !== 'checking' && (
          <div
            className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
              serverState === 'up'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            {serverState === 'up'
              ? auth.token && auth.status !== 'ready'
                ? '服务已恢复,正在恢复会话...'
                : '服务连接正常'
              : '无法连接服务器,每 5 秒自动重试...'}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              autoFocus
              required
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-colors"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-colors"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !username.trim() || !password || serverState === 'down'}
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {busy ? '登录中...' : '登 录'}
          </button>
        </form>
      </div>
    </div>
  )
}
