import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth-store'

export function LoginPage() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(username.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200/10 bg-slate-900/60 p-8">
        <div className="mb-6 text-center">
          <span className="text-4xl">📡</span>
          <h1 className="mt-3 text-lg font-semibold text-slate-100">华师 AI 工作台</h1>
          <p className="mt-1 text-xs text-slate-500">请使用管理员分配的账号登录</p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-400">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              autoFocus
              required
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:border-blue-500 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-400">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:border-blue-500 focus:outline-none transition-colors"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !username.trim() || !password}
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {busy ? '登录中...' : '登 录'}
          </button>
        </form>
      </div>
    </div>
  )
}
