import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getClient } from '../lib/api/client'
import { withMonitorNameList } from '../lib/monitor-prompt'
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
const REPORT_MAIL_KEY = 'ccnu-monitor-report-mail'

function loadReports(): SavedReport[] {
  try {
    return JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]')
  } catch { return [] }
}
function saveReports(reports: SavedReport[]) {
  localStorage.setItem(REPORTS_KEY, JSON.stringify(reports))
}
function loadReportMail() {
  return localStorage.getItem(REPORT_MAIL_KEY) || ''
}
function saveReportMail(email: string) {
  localStorage.setItem(REPORT_MAIL_KEY, email)
}

interface MailSummary {
  action?: string
  attachment_count?: number
  from?: string
  subject?: string
  to?: string[]
}

interface PendingMail {
  report: SavedReport
  recipient: string
  subject: string
  confirmationToken: string
  summary?: MailSummary
  expiresIn?: number
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
  const runIdRef = useRef(0)
  const [savedReports, setSavedReports] = useState<SavedReport[]>(loadReports)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [recipientEmail, setRecipientEmail] = useState(loadReportMail)
  const [mailStatus, setMailStatus] = useState('')
  const [mailError, setMailError] = useState('')
  const [mailSending, setMailSending] = useState(false)
  const [pendingMail, setPendingMail] = useState<PendingMail | null>(null)

  const targetDept = customDept ? deptInput.trim() : dept
  const canRun = !!targetDept && !running
  const normalizedRecipient = recipientEmail.trim()

  const sendReportMail = useCallback(async (reportToSend: SavedReport, confirmationToken?: string) => {
    const recipient = normalizedRecipient
    if (!recipient) {
      setMailStatus('')
      setMailError('')
      return
    }

    setMailSending(true)
    setMailError('')
    setMailStatus(confirmationToken ? '正在发送报告邮件...' : '正在准备报告邮件...')

    const subject = `舆情监控报告：${reportToSend.dept} · ${reportToSend.timeRange}`
    const body = [
      subject,
      `生成时间：${new Date(reportToSend.createdAt).toLocaleString('zh-CN')}`,
      '',
      reportToSend.content,
    ].join('\n')

    try {
      const res = await fetch('/api/mail/send-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipient,
          subject,
          body,
          confirmationToken,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || '邮件发送失败')
      }

      const result = data.result || {}
      const mailData = result.data || result
      if (mailData.confirmation_required && mailData.confirmation_token) {
        setPendingMail({
          report: reportToSend,
          recipient,
          subject,
          confirmationToken: mailData.confirmation_token,
          summary: mailData.summary,
          expiresIn: mailData.expires_in,
        })
        setMailStatus('邮件已准备好，请确认发送')
      } else {
        setPendingMail(null)
        setMailStatus('报告邮件已发送')
      }
    } catch (err) {
      setMailError(err instanceof Error ? err.message : '邮件发送失败')
      setMailStatus('')
    } finally {
      setMailSending(false)
    }
  }, [normalizedRecipient])

  const handleRecipientChange = (value: string) => {
    setRecipientEmail(value)
    saveReportMail(value)
  }

  const handleRun = useCallback(async () => {
    if (!targetDept || runningRef.current) return
    const runId = ++runIdRef.current
    runningRef.current = true
    setRunning(true)
    setReport('')
    setError('')

    const client = getClient(settings)

    try {
      const thread = await client.createThread({ model: 'deepseek-v4-pro', auto_approve: true })
      const inputSummary = `$ccnu-monitor 搜索${timeRange}华中师范大学${targetDept}的最新信息`
      const prompt = withMonitorNameList(
        `${inputSummary}。用微博搜索和小红书搜索。最终输出完整报告，不要省略。`,
        settings.nameList,
      )
      await client.startTurn(thread.id, { prompt, input_summary: inputSummary, auto_approve: true })

      // Poll thread until turn completes
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 3000))
        if (!runningRef.current || runIdRef.current !== runId) return

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
            void sendReportMail(newReport)
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
          void sendReportMail(newReport)
        } else {
          setError('监控超时，未获取到结果')
        }
      } catch {
        setError('监控超时')
      }
    } catch (err: any) {
      if (!runningRef.current || runIdRef.current !== runId) return
      setError(err.message || '执行失败')
    } finally {
      if (runIdRef.current === runId) {
        setRunning(false)
        runningRef.current = false
      }
    }
  }, [targetDept, timeRange, settings, savedReports, sendReportMail])

  const handleStop = () => {
    runIdRef.current += 1
    runningRef.current = false
    setRunning(false)
  }

  const deleteReport = (id: string) => {
    const updated = savedReports.filter(r => r.id !== id)
    setSavedReports(updated)
    saveReports(updated)
    if (expandedId === id) setExpandedId(null)
  }

  const confirmSendMail = () => {
    if (!pendingMail || mailSending) return
    void sendReportMail(pendingMail.report, pendingMail.confirmationToken)
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
        <div className="mt-4 max-w-xl rounded-lg border border-slate-700/70 bg-slate-900/50 p-3">
          <label className="mb-1.5 block text-xs font-medium text-slate-400">报告收件邮箱（可选）</label>
          <input type="email" value={recipientEmail} onChange={e => handleRecipientChange(e.target.value)}
            placeholder="输入邮箱，报告生成后会准备发送"
            disabled={running}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50" />
          <p className="mt-1.5 text-xs text-slate-600">填写后，报告生成完成会显示邮件摘要，需要点击确认才会发送。</p>
        </div>
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

        {(mailStatus || mailError || pendingMail) && !running && (
          <div className={`mb-4 rounded-xl border p-4 ${
            mailError
              ? 'border-red-500/20 bg-red-500/5'
              : 'border-blue-500/20 bg-blue-500/5'
          }`}>
            {mailError ? (
              <p className="text-sm text-red-400">{mailError}</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-blue-300">{mailStatus}</p>
                {pendingMail && (
                  <div className="space-y-2">
                    <div className="rounded-lg border border-slate-700/70 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
                      <p>收件人：{pendingMail.summary?.to?.join(', ') || pendingMail.recipient}</p>
                      <p>主题：{pendingMail.summary?.subject || pendingMail.subject}</p>
                      {pendingMail.summary?.from && <p>发件人：{pendingMail.summary.from}</p>}
                      {pendingMail.expiresIn && <p>确认有效期：{pendingMail.expiresIn} 秒</p>}
                    </div>
                    <button onClick={confirmSendMail} disabled={mailSending}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors">
                      {mailSending ? '发送中...' : '确认发送邮件'}
                    </button>
                  </div>
                )}
              </div>
            )}
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
                    <button onClick={(e) => { e.stopPropagation(); void sendReportMail(r) }}
                      disabled={!normalizedRecipient || mailSending}
                      className="text-xs text-slate-600 hover:text-emerald-400 disabled:opacity-30 px-2 py-1 rounded transition-colors"
                      title="发送到收件邮箱">✉️</button>
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
