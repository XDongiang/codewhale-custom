import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getClient } from '../lib/api/client'
import { useSettingsStore } from '../stores/settings-store'

const DEPARTMENTS = [
  '文学院', '数学与统计学学院', '物理科学与技术学院', '化学学院',
  '生命科学学院', '计算机学院', '教育学院', '心理学院',
  '马克思主义学院', '历史文化学院', '外国语学院', '经济与工商管理学院',
  '法学院', '新闻传播学院', '音乐学院', '美术学院', '体育学院',
  '信息管理学院', '公共管理学院', '城市与环境科学学院', '国际文化交流学院',
]

const TIME_RANGES = [
  { label: '今天', value: '今天' },
  { label: '近三天', value: '最近三天' },
  { label: '近一周', value: '最近一周' },
]

interface SavedReport {
  id: string
  dept: string
  timeRange: string
  content: string
  createdAt: string
  threadId: string
}

const REPORTS_KEY = 'ccnu-monitor-reports'

function loadReports(): SavedReport[] {
  try {
    return JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]')
  } catch { return [] }
}
function saveReports(reports: SavedReport[]) {
  localStorage.setItem(REPORTS_KEY, JSON.stringify(reports))
}

export function MonitorPage() {
  const navigate = useNavigate()
  const settings = useSettingsStore()
  const [dept, setDept] = useState(DEPARTMENTS[0])
  const [timeRange, setTimeRange] = useState('最近三天')
  const [customDept, setCustomDept] = useState(false)
  const [deptInput, setDeptInput] = useState('')
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState('')
  const [error, setError] = useState('')
  const runningRef = useRef(false)
  const [savedReports, setSavedReports] = useState<SavedReport[]>(loadReports)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const targetDept = customDept ? deptInput.trim() : dept
  const canRun = !!targetDept && !running

  const handleRun = useCallback(async () => {
    if (!targetDept || runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setReport('')
    setError('')

    const client = getClient(settings)

    try {
      const thread = await client.createThread({ model: 'deepseek-v4-pro', auto_approve: true })
      const prompt = `$ccnu-monitor 帮我搜索${timeRange}华中师范大学${targetDept}的最新信息。用微博搜索和小红书搜索。最终输出完整报告，不要省略。`
      await client.startTurn(thread.id, { prompt, auto_approve: true })

      // Poll thread until turn completes
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 3000))
        if (!runningRef.current) return

        try {
          const detail = await client.getThread(thread.id)
          const agentItems = (detail.items || []).filter(
            (item: any) => item.kind === 'agent_message' && item.status === 'completed'
          )
          const turns = detail.turns || []
          const lastTurn = turns[turns.length - 1]

          if (agentItems.length > 0 && lastTurn?.status === 'completed') {
            const reportText = agentItems.map((item: any) => item.detail || item.summary).join('\n\n')
            setReport(reportText)

            // Save to localStorage
            const newReport: SavedReport = {
              id: thread.id,
              dept: targetDept,
              timeRange,
              content: reportText,
              createdAt: new Date().toISOString(),
              threadId: thread.id,
            }
            const updated = [newReport, ...savedReports].slice(0, 50)
            setSavedReports(updated)
            saveReports(updated)
            setExpandedId(newReport.id)
            return
          }
          if (lastTurn?.status === 'failed') {
            setError('监控执行失败')
            return
          }
        } catch { /* retry */ }
      }

      // Timeout fallback
      try {
        const detail = await client.getThread(thread.id)
        const text = (detail.items || [])
          .filter((i: any) => i.kind === 'agent_message')
          .map((i: any) => i.detail || i.summary).join('\n\n')
        if (text) {
          setReport(text)
          const newReport: SavedReport = {
            id: thread.id, dept: targetDept, timeRange,
            content: text, createdAt: new Date().toISOString(), threadId: thread.id,
          }
          const updated = [newReport, ...savedReports].slice(0, 50)
          setSavedReports(updated)
          saveReports(updated)
          setExpandedId(newReport.id)
        } else {
          setError('监控超时，未获取到结果')
        }
      } catch {
        setError('监控超时')
      }
    } catch (err: any) {
      if (!runningRef.current) return
      setError(err.message || '执行失败')
    }
    setRunning(false)
    runningRef.current = false
  }, [targetDept, timeRange, settings, savedReports])

  const handleStop = () => {
    runningRef.current = false
    setRunning(false)
  }

  const deleteReport = (id: string) => {
    const updated = savedReports.filter(r => r.id !== id)
    setSavedReports(updated)
    saveReports(updated)
    if (expandedId === id) setExpandedId(null)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-slate-200/10 px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-100">舆情监控</h1>
      </div>

      {/* Controls */}
      <div className="border-b border-slate-200/10 px-6 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">学院/部门</label>
            {customDept ? (
              <div className="flex gap-2">
                <input type="text" value={deptInput} onChange={e => setDeptInput(e.target.value)}
                  placeholder="输入名称" disabled={running}
                  className="w-44 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50" autoFocus />
                <button onClick={() => setCustomDept(false)} className="text-xs text-slate-500 hover:text-slate-300">列表</button>
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                <select value={dept} onChange={e => setDept(e.target.value)} disabled={running}
                  className="w-44 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none disabled:opacity-50">
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <button onClick={() => { setCustomDept(true); setDeptInput('') }} className="text-xs text-slate-500 hover:text-slate-300">自定义</button>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500">时间范围</label>
            <div className="flex gap-1">
              {TIME_RANGES.map(t => (
                <button key={t.value} onClick={() => setTimeRange(t.value)} disabled={running}
                  className={`rounded-lg px-3 py-2 text-sm transition-colors ${timeRange === t.value ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'} disabled:opacity-50`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <button onClick={handleRun} disabled={!canRun}
            className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2 text-sm font-medium text-white hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 transition-all shadow-lg shadow-blue-600/20">
            {running ? '监控中...' : '🔍 开始监控'}
          </button>
          {running && (
            <button onClick={handleStop}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors">停止</button>
          )}
        </div>
        {targetDept && <p className="mt-2 text-xs text-slate-600">将对 <span className="text-slate-400">{targetDept}</span> 进行{timeRange}舆情监控</p>}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Running spinner */}
        {running && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-10 h-10 rounded-full border-4 border-slate-700 border-t-blue-500 animate-spin mb-3" />
            <p className="text-sm text-slate-400">搜索微博、小红书中...</p>
          </div>
        )}

        {/* Error */}
        {error && !running && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5 mb-4">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={handleRun} className="mt-2 text-xs text-slate-500 hover:text-slate-300">重试</button>
          </div>
        )}

        {/* Current report (just generated) */}
        {report && !running && !expandedId && (
          <div className="rounded-xl border border-slate-200/10 bg-slate-900/50 p-5 mb-4">
            <div className="prose-stream text-sm text-slate-300">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* Saved reports */}
        {savedReports.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-300">历史报告</h3>
            {savedReports.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-200/10 bg-slate-900/30 overflow-hidden">
                {/* Card header */}
                <button
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/30 transition-colors text-left"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-slate-300 font-medium truncate">
                      {r.dept} · {r.timeRange}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {new Date(r.createdAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <button onClick={(e) => { e.stopPropagation(); navigate(`/chat/${r.threadId}`) }}
                      className="text-xs text-slate-600 hover:text-blue-400 px-2 py-1 rounded transition-colors"
                      title="查看原始对话">💬</button>
                    <button onClick={(e) => { e.stopPropagation(); deleteReport(r.id) }}
                      className="text-xs text-slate-600 hover:text-red-400 px-2 py-1 rounded transition-colors"
                      title="删除">🗑️</button>
                    <span className="text-xs text-slate-600">{expandedId === r.id ? '▲' : '▼'}</span>
                  </div>
                </button>
                {/* Expanded content */}
                {expandedId === r.id && (
                  <div className="border-t border-slate-200/10 px-4 py-4 prose-stream text-sm text-slate-300">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!running && !error && !report && savedReports.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-600">
            <span className="text-4xl mb-3">📊</span>
            <p className="text-sm">选择学院和时间，点击「开始监控」</p>
          </div>
        )}
      </div>
    </div>
  )
}
