import { useState, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { useSettingsStore } from '../stores/settings-store'
import type { NameEntry } from '../stores/settings-store'
import { getClient } from '../lib/api/client'

export function SettingsPage() {
  const settings = useSettingsStore()
  const [apiUrl, setApiUrl] = useState(settings.apiUrl)
  const [authToken, setAuthToken] = useState(settings.authToken)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [tab, setTab] = useState<'connection' | 'namelist' | 'xhs'>('connection')
  const fileRef = useRef<HTMLInputElement>(null as unknown as HTMLInputElement)

  const handleSave = () => {
    settings.updateSettings({ apiUrl, authToken })
    getClient({ apiUrl, authToken })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const client = getClient({ apiUrl, authToken })
      const res = await client.health()
      setTestResult({ ok: true, msg: `连接成功！服务状态：${res.status}` })
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : '连接失败' })
    } finally {
      setTesting(false)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: 'binary' })
        const firstSheet = wb.SheetNames[0]
        if (!firstSheet) { alert('Excel 文件为空'); return }
        const ws = wb.Sheets[firstSheet]
        if (!ws) { alert('无法读取工作表'); return }
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][]

        if (rows.length < 2) {
          alert('Excel 文件至少需要表头行 + 一行数据')
          return
        }

        // First row is header — find "姓名" or "name" column
        const header = (rows[0] ?? []) as string[]
        const nameColIdx = header.findIndex(
          (h) => h && ['姓名', '名字', 'name', '名称'].includes(h.trim().toLowerCase())
        )
        const deptColIdx = header.findIndex(
          (h) => h && ['部门', '学院', 'department', 'unit'].includes(h.trim().toLowerCase())
        )
        const roleColIdx = header.findIndex(
          (h) => h && ['职务', '角色', 'role', 'title'].includes(h.trim().toLowerCase())
        )

        if (nameColIdx === -1) {
          alert('未找到姓名列。请确保表头包含"姓名"列。')
          return
        }

        const list: NameEntry[] = rows.slice(1)
          .filter((row) => row[nameColIdx] && String(row[nameColIdx]).trim())
          .map((row) => ({
            name: String(row[nameColIdx]).trim(),
            department: deptColIdx >= 0 ? String(row[deptColIdx] || '').trim() : undefined,
            role: roleColIdx >= 0 ? String(row[roleColIdx] || '').trim() : undefined,
          }))

        settings.setNameList(list)
      } catch {
        alert('文件解析失败，请确认是有效的 .xlsx 文件')
      }
    }
    reader.readAsBinaryString(file)
  }

  const tabs = [
    { key: 'connection' as const, label: '服务连接' },
    { key: 'namelist' as const, label: '名单管理' },
    { key: 'xhs' as const, label: '小红书' },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center border-b border-slate-200/10 px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-100">设置</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200/10 px-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'connection' && (
          <ConnectionTab
            apiUrl={apiUrl}
            authToken={authToken}
            saved={saved}
            testing={testing}
            testResult={testResult}
            onApiUrlChange={setApiUrl}
            onAuthTokenChange={setAuthToken}
            onSave={handleSave}
            onTest={handleTest}
          />
        )}

        {tab === 'namelist' && (
          <NameListTab
            nameList={settings.nameList}
            onUpload={handleFileUpload}
            onClear={() => settings.setNameList([])}
            fileRef={fileRef}
          />
        )}
        {tab === 'xhs' && <XhsTab />}
      </div>
    </div>
  )
}

// ── Connection Tab ──
function ConnectionTab({
  apiUrl, authToken, saved, testing, testResult,
  onApiUrlChange, onAuthTokenChange, onSave, onTest,
}: {
  apiUrl: string; authToken: string; saved: boolean; testing: boolean
  testResult: { ok: boolean; msg: string } | null
  onApiUrlChange: (v: string) => void; onAuthTokenChange: (v: string) => void
  onSave: () => void; onTest: () => void
}) {
  return (
    <div className="max-w-lg space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">运行时 API 地址</label>
        <input type="text" value={apiUrl} onChange={(e) => onApiUrlChange(e.target.value)}
          placeholder="http://localhost:7878"
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors" />
        <p className="mt-1.5 text-xs text-slate-500"><code className="text-slate-400">codewhale serve --http</code> 运行的地址</p>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">认证令牌</label>
        <input type="password" value={authToken} onChange={(e) => onAuthTokenChange(e.target.value)}
          placeholder="dev-token"
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors" />
        <p className="mt-1.5 text-xs text-slate-500">与启动命令中的 <code className="text-slate-400">--auth-token</code> 保持一致</p>
      </div>
      <div className="flex gap-3">
        <button onClick={onSave}
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors">
          {saved ? '✓ 已保存' : '保存'}
        </button>
        <button onClick={() => void onTest()} disabled={testing}
          className="rounded-xl border border-slate-700 bg-slate-900 px-5 py-2.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors">
          {testing ? '检测中...' : '测试连接'}
        </button>
      </div>
      {testResult && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          testResult.ok ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400'
            : 'border-red-500/20 bg-red-500/5 text-red-400'}`}>
          {testResult.msg}
        </div>
      )}
    </div>
  )
}

// ── Name List Tab ──
function NameListTab({
  nameList, onUpload, onClear, fileRef,
}: {
  nameList: { name: string; department?: string; role?: string }[]
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onClear: () => void
  fileRef: React.RefObject<HTMLInputElement>
}) {
  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          上传 Excel 名单（.xlsx），表头需含<strong className="text-slate-200">姓名</strong>列，可选部门、职务列。
        </p>
      </div>

      <div className="flex gap-3">
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onUpload}
          className="hidden" />
        <button onClick={() => fileRef.current?.click()}
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors">
          📎 上传 Excel
        </button>
        {nameList.length > 0 && (
          <button onClick={onClear}
            className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
            清空名单
          </button>
        )}
      </div>

      {nameList.length > 0 && (
        <div className="rounded-xl border border-slate-200/10 bg-slate-900/50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200/10">
            <p className="text-sm text-slate-300">已导入 <span className="text-blue-400 font-medium">{nameList.length}</span> 人</p>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-200/5">
                  <th className="text-left px-4 py-2 font-medium">姓名</th>
                  <th className="text-left px-4 py-2 font-medium">部门/学院</th>
                  <th className="text-left px-4 py-2 font-medium">职务</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/5">
                {nameList.slice(0, 50).map((entry, i) => (
                  <tr key={i} className="text-slate-400 hover:bg-slate-800/30">
                    <td className="px-4 py-1.5 text-slate-200">{entry.name}</td>
                    <td className="px-4 py-1.5">{entry.department || '-'}</td>
                    <td className="px-4 py-1.5">{entry.role || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {nameList.length > 50 && (
              <p className="px-4 py-2 text-xs text-slate-600">仅显示前 50 条，共 {nameList.length} 条</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 小红书 Tab ──
function XhsTab() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null) // null = checking
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [qrCode, setQrCode] = useState('')

  const api = (url: string, method = 'GET', timeout = 15000) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    return fetch(url, { method, signal: ctrl.signal })
      .then(r => r.json())
      .catch(() => ({ ok: false, output: '请求超时或失败' }))
      .finally(() => clearTimeout(timer))
  }

  useEffect(() => {
    api('/api/xhs/status').then(d => {
      setLoggedIn(d.ok && !d.output.includes('Not logged in'))
      if (d.ok) setMsg(d.output.slice(0, 200))
    })
  }, [])

  const doLogin = async () => {
    setLoading(true)
    setMsg('')
    const d = await api('/api/xhs/login', 'POST')
    setMsg(d.output)
    if (d.ok) {
      const s = await api('/api/xhs/status')
      setLoggedIn(s.ok && !s.output.includes('Not logged in'))
    }
    setLoading(false)
  }

  const doQrcode = async () => {
    setLoading(true)
    setQrCode('')
    const d = await api('/api/xhs/login-qrcode', 'POST', 300000)
    setQrCode(d.output || '')
    setMsg('请扫码')
    // Poll for login
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const s = await api('/api/xhs/status')
      if (s.ok && !s.output.includes('Not logged in')) {
        setLoggedIn(true)
        setMsg(s.output.slice(0, 200))
        setQrCode('')
        setLoading(false)
        return
      }
    }
    setLoggedIn(false)
    setQrCode('')
    setLoading(false)
  }

  const doLogout = async () => {
    setLoading(true)
    await api('/api/xhs/logout', 'POST')
    setLoggedIn(false)
    setMsg('')
    setLoading(false)
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="rounded-xl border border-slate-200/10 bg-slate-900/50 p-6 text-center">
        <span className="text-3xl">📕</span>
        <h3 className="text-base font-semibold text-slate-200 mt-2 mb-1">小红书</h3>
        <p className="text-sm text-slate-500 mb-4">
          {loggedIn === null ? '检测中...' : loggedIn ? '✅ 已登录' : '未登录'}
        </p>
        {msg && <p className="text-xs text-slate-500 font-mono mb-4 whitespace-pre-wrap max-h-20 overflow-auto">{msg}</p>}

        {qrCode && (
          <div className="mb-4 p-3 bg-white rounded-lg inline-block">
            <pre className="text-[6px] leading-[6px] text-black font-mono select-all whitespace-pre">{qrCode}</pre>
          </div>
        )}

        <div className="flex flex-col gap-2 items-center">
          {!loggedIn && (
            <>
              <button onClick={doLogin} disabled={loading}
                className="w-48 rounded-xl bg-gradient-to-r from-red-500 to-pink-500 px-4 py-2.5 text-sm font-medium text-white hover:from-red-400 disabled:opacity-50 transition-all">
                {loading ? '...' : '🔑 浏览器登录'}
              </button>
              <button onClick={doQrcode} disabled={loading}
                className="w-48 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-all">
                {loading ? '...' : '📱 扫码登录'}
              </button>
            </>
          )}
          {loggedIn && (
            <button onClick={doLogout} disabled={loading}
              className="w-48 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/20 transition-all">
              退出登录
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
