import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getClient } from '../lib/api/client'
import { serverApi, setServerToken, type ServerReport } from '../lib/api/server'
import { buildMonitorPrompt } from '../lib/monitor-prompt'
import { DEPARTMENTS } from '../lib/departments'
import { useSettingsStore } from '../stores/settings-store'
import type { ReportLevel } from '../types'

const REPORT_LEVELS: { key: ReportLevel; label: string; desc: string }[] = [
  { key: 'school', label: '全校', desc: '汇总全部学院' },
  { key: 'college', label: '学院', desc: '搜索指定学院' },
  { key: 'department', label: '专业/系部', desc: '搜索指定专业' },
  { key: 'class', label: '班级', desc: '搜索指定班级' },
  { key: 'course', label: '课程', desc: '搜索指定课程' },
  { key: 'individual', label: '个人', desc: '搜索指定人员' },
]

const TIME_RANGES = [
  { label: '今天', value: '今天' },
  { label: '近三天', value: '最近三天' },
  { label: '近一周', value: '最近一周' },
]

type SavedReport = ServerReport

const REPORT_MAIL_KEY = 'ccnu-monitor-report-mail'

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

const LEVEL_BADGE: Record<ReportLevel, { bg: string; text: string; label: string }> = {
  school: { bg: 'bg-purple-500/10', text: 'text-purple-400', label: '校级' },
  college: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: '学院' },
  department: { bg: 'bg-teal-500/10', text: 'text-teal-400', label: '专业' },
  class: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: '班级' },
  course: { bg: 'bg-rose-500/10', text: 'text-rose-400', label: '课程' },
  individual: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: '个人' },
}

export function MonitorPage() {
  const navigate = useNavigate()
  const settings = useSettingsStore()
  const [reportLevel, setReportLevel] = useState<ReportLevel>('college')
  const [dept, setDept] = useState<string>(DEPARTMENTS[0])
  const [timeRange, setTimeRange] = useState('最近三天')
  const [customDept, setCustomDept] = useState(false)
  const [deptInput, setDeptInput] = useState('')
  const [selectedPersonId, setSelectedPersonId] = useState('')
  const [personSearch, setPersonSearch] = useState('')
  const [deptScope, setDeptScope] = useState('')     // department/major name
  const [classScope, setClassScope] = useState('')    // class name
  const [courseScope, setCourseScope] = useState('')  // course name
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState('')
  const [error, setError] = useState('')
  const runningRef = useRef(false)
  const runIdRef = useRef(0)
  const [savedReports, setSavedReports] = useState<SavedReport[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [recipientEmail, setRecipientEmail] = useState(loadReportMail)
  const [mailStatus, setMailStatus] = useState('')
  const [mailError, setMailError] = useState('')
  const [mailSending, setMailSending] = useState(false)
  const [pendingMail, setPendingMail] = useState<PendingMail | null>(null)

  // 报告以服务端为准,进入页面时加载
  useEffect(() => {
    setServerToken(settings.authToken)
    serverApi.listReports()
      .then(setSavedReports)
      .catch((err) => setError(err instanceof Error ? err.message : '加载报告失败'))
  }, [settings.authToken])

  // Computed values
  const targetDept = customDept ? deptInput.trim() : dept
  const canRun = (reportLevel === 'school') ? !running
    : (reportLevel === 'individual') ? !!selectedPersonId && !running
    : (reportLevel === 'department') ? !!deptScope.trim() && !running
    : (reportLevel === 'class') ? !!classScope.trim() && !running
    : (reportLevel === 'course') ? !!courseScope.trim() && !running
    : !!targetDept && !running
  const normalizedRecipient = recipientEmail.trim()

  // Filtered personnel for person selector
  const allPersonnel = settings.personnel
  const filteredPersons = allPersonnel.filter(p => {
    if (!personSearch) return true
    const q = personSearch.toLowerCase()
    return p.name.toLowerCase().includes(q) ||
      (p.college || '').toLowerCase().includes(q) ||
      (p.role || '').toLowerCase().includes(q)
  })

  const selectedPerson = allPersonnel.find(p => p.id === selectedPersonId)

  const getReportLabel = () => {
    if (reportLevel === 'school') return `全校 · ${timeRange}`
    if (reportLevel === 'individual') return `${selectedPerson?.name || '个人'} · ${timeRange}`
    if (reportLevel === 'department') return `${deptScope} · ${timeRange}`
    if (reportLevel === 'class') return `${classScope} · ${timeRange}`
    if (reportLevel === 'course') return `${courseScope} · ${timeRange}`
    return `${targetDept} · ${timeRange}`
  }

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
        headers: {
          'Content-Type': 'application/json',
          ...(settings.authToken ? { Authorization: `Bearer ${settings.authToken}` } : {}),
        },
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
  }, [normalizedRecipient, settings.authToken])

  const handleRecipientChange = (value: string) => {
    setRecipientEmail(value)
    saveReportMail(value)
  }

  /** 报告保存到服务端(成功后置顶并展开),随后触发邮件准备。 */
  const persistReport = useCallback((report: SavedReport) => {
    serverApi.createReport(report)
      .then((created) => {
        setSavedReports((prev) => [created, ...prev.filter((r) => r.id !== created.id)].slice(0, 50))
        setExpandedId(created.id)
      })
      .catch((err) => setError(err instanceof Error ? err.message : '保存报告失败'))
    void sendReportMail(report)
  }, [sendReportMail])

  const handleRun = useCallback(async () => {
    if (runningRef.current) return

    // Validate
    if (reportLevel === 'college' && !targetDept) return
    if (reportLevel === 'individual' && !selectedPersonId) return

    const runId = ++runIdRef.current
    runningRef.current = true
    setRunning(true)
    setReport('')
    setError('')

    const client = getClient(settings)

    try {
      const scope = reportLevel === 'school' ? ''
        : reportLevel === 'individual' ? (selectedPerson?.name || '')
        : reportLevel === 'department' ? deptScope.trim()
        : reportLevel === 'class' ? classScope.trim()
        : reportLevel === 'course' ? courseScope.trim()
        : targetDept

      const { prompt, inputSummary } = buildMonitorPrompt({
        level: reportLevel,
        scope,
        timeRange,
        personnel: {
          version: 1,
          updatedAt: new Date().toISOString(),
          entries: settings.personnel,
        },
      })

      const thread = await client.createThread({ model: 'deepseek-v4-pro', auto_approve: true })
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

            const newReport: SavedReport = {
              id: thread.id,
              dept: getReportLabel(),
              timeRange,
              content: reportText,
              createdAt: new Date().toISOString(),
              threadId: thread.id,
              level: reportLevel,
              personName: reportLevel === 'individual' ? selectedPerson?.name : undefined,
            }
            persistReport(newReport)
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
            id: thread.id, dept: getReportLabel(), timeRange,
            content: text, createdAt: new Date().toISOString(), threadId: thread.id,
            level: reportLevel,
            personName: reportLevel === 'individual' ? selectedPerson?.name : undefined,
          }
          persistReport(newReport)
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
  }, [reportLevel, targetDept, timeRange, settings, selectedPersonId, selectedPerson, persistReport])

  const handleStop = () => {
    runIdRef.current += 1
    runningRef.current = false
    setRunning(false)
  }

  const deleteReport = (id: string) => {
    serverApi.deleteReport(id)
      .then(() => {
        setSavedReports((prev) => prev.filter((r) => r.id !== id))
        if (expandedId === id) setExpandedId(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : '删除报告失败'))
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
        {/* Report level selector */}
        <div className="mb-3">
          <label className="mb-1.5 block text-xs text-slate-500">报告层级</label>
          <div className="flex gap-1">
            {REPORT_LEVELS.map(rl => (
              <button key={rl.key} onClick={() => setReportLevel(rl.key)} disabled={running}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  reportLevel === rl.key
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                } disabled:opacity-50`}>
                {rl.label}
                <span className="ml-1 text-xs opacity-60">{rl.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Scope selector (depends on level) */}
        <div className="flex flex-wrap items-end gap-3">
          {/* College level: department selector */}
          {reportLevel === 'college' && (
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
          )}

          {/* School level: info */}
          {reportLevel === 'school' && (
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-2 text-sm text-slate-300">
              覆盖全校 {DEPARTMENTS.length} 个学院/部门
              {settings.personnel.filter(p => p.level === 'school').length > 0 && (
                <span className="ml-2 text-purple-400">
                  · 校级名单 {settings.personnel.filter(p => p.level === 'school').length} 人
                </span>
              )}
            </div>
          )}

          {/* Department level: text input */}
          {reportLevel === 'department' && (
            <div>
              <label className="mb-1 block text-xs text-slate-500">专业/系部名称</label>
              <input type="text" value={deptScope} onChange={e => setDeptScope(e.target.value)}
                placeholder="如：汉语言文学、计算机科学系"
                disabled={running}
                className="w-56 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50" />
              <p className="mt-1 text-xs text-slate-600">输入具体专业或系部名称</p>
            </div>
          )}

          {/* Class level: text input */}
          {reportLevel === 'class' && (
            <div>
              <label className="mb-1 block text-xs text-slate-500">班级名称</label>
              <input type="text" value={classScope} onChange={e => setClassScope(e.target.value)}
                placeholder="如：2024级汉语言文学1班"
                disabled={running}
                className="w-56 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50" />
              <p className="mt-1 text-xs text-slate-600">输入具体班级名称</p>
            </div>
          )}

          {/* Course level: text input */}
          {reportLevel === 'course' && (
            <div>
              <label className="mb-1 block text-xs text-slate-500">课程名称</label>
              <input type="text" value={courseScope} onChange={e => setCourseScope(e.target.value)}
                placeholder="如：高等数学、大学英语"
                disabled={running}
                className="w-56 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50" />
              <p className="mt-1 text-xs text-slate-600">输入课程名，系统将搜索该课程的舆情</p>
            </div>
          )}

          {/* Individual level: person selector */}
          {reportLevel === 'individual' && (
            <div>
              <label className="mb-1 block text-xs text-slate-500">选择监控对象</label>
              {allPersonnel.length === 0 ? (
                <p className="text-sm text-slate-600">请先在设置 → 人员名单中添加人员</p>
              ) : (
                <div className="flex flex-col gap-1">
                  <input type="text" value={personSearch} onChange={e => { setPersonSearch(e.target.value); setSelectedPersonId('') }}
                    placeholder="搜索姓名、学院、职务..."
                    disabled={running}
                    className="w-56 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50" />
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-700/50 bg-slate-900/50">
                    {filteredPersons.slice(0, 30).map(p => (
                      <button key={p.id}
                        onClick={() => { setSelectedPersonId(p.id); setPersonSearch(p.name) }}
                        className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                          selectedPersonId === p.id
                            ? 'bg-blue-600/20 text-blue-300'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}>
                        <span className="font-medium">{p.name}</span>
                        {p.college && <span className="ml-1.5 text-xs text-slate-500">{p.college}</span>}
                        {p.role && <span className="ml-1.5 text-xs text-slate-500">{p.role}</span>}
                        <span className={`ml-1.5 text-xs ${LEVEL_BADGE[p.level].text}`}>({LEVEL_BADGE[p.level].label})</span>
                      </button>
                    ))}
                    {filteredPersons.length === 0 && personSearch && (
                      <p className="px-3 py-2 text-xs text-slate-600">无匹配人员</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Time range (shared) */}
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

        {/* Summary line */}
        {reportLevel !== 'school' && !running && (
          <p className="mt-2 text-xs text-slate-600">
            将对 <span className="text-slate-400">{getReportLabel()}</span> 进行舆情监控
          </p>
        )}

        {/* Email recipient */}
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
            {savedReports.map((r) => {
              const badge = LEVEL_BADGE[r.level] || LEVEL_BADGE.college
              return (
                <div key={r.id} className="rounded-xl border border-slate-200/10 bg-slate-900/30 overflow-hidden">
                  {/* Card header */}
                  <button
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/30 transition-colors text-left"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className={`inline-block rounded-md border px-1.5 py-0.5 text-xs font-medium ${badge.bg} ${badge.text} border-current/20`}>
                        {badge.label}
                      </span>
                      <div>
                        <p className="text-sm text-slate-300 font-medium truncate">
                          {r.dept}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {new Date(r.createdAt).toLocaleString('zh-CN')}
                        </p>
                      </div>
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
              )
            })}
          </div>
        )}

        {/* Empty */}
        {!running && !error && !report && savedReports.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-600">
            <span className="text-4xl mb-3">📊</span>
            <p className="text-sm">选择报告层级和参数，点击「开始监控」</p>
          </div>
        )}
      </div>
    </div>
  )
}
