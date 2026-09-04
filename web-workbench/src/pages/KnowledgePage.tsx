import { useState, useRef, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { serverApi, type KbDocumentMeta } from '../lib/api/server'
import { extractTextFromFile } from '../lib/pdf'
import { useAuthStore } from '../stores/auth-store'
import { DEPARTMENTS } from '../lib/departments'

/**
 * 文件知识库:问答 + 文件管理。
 * 上传/删除仅 admin;校级可问答全部,院级仅全校+本院文件(服务端过滤)。
 */
export function KnowledgePage() {
  const auth = useAuthStore()
  const isAdmin = auth.user?.role === 'admin'
  const [tab, setTab] = useState<'ask' | 'files'>('ask')

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-slate-200/10 px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-100">📚 文件知识库</h1>
        <div className="ml-6 flex gap-1">
          <button
            onClick={() => setTab('ask')}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === 'ask' ? 'bg-blue-600/20 text-blue-300' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            智能问答
          </button>
          <button
            onClick={() => setTab('files')}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === 'files' ? 'bg-blue-600/20 text-blue-300' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            文件库
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'ask' ? <AskTab /> : <FilesTab isAdmin={isAdmin} />}
      </div>
    </div>
  )
}

// ── 问答 ──
function AskTab() {
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ answer: string; sources: Array<{ filename: string; college: string | null; scope: 'school' | 'college'; chunks: number }>; threadId: string } | null>(null)

  const handleAsk = async () => {
    const q = question.trim()
    if (!q || running) return
    setRunning(true)
    setError('')
    setResult(null)
    try {
      const res = await serverApi.kbAsk(q)
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '问答失败')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="rounded-xl border border-slate-200/10 bg-slate-900/50 p-4">
        <label className="mb-2 block text-sm font-medium text-slate-300">
          向已导入的文件提问
        </label>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleAsk()
          }}
          placeholder="例如:差旅费报销需要提供哪些材料?审批流程是怎样的?"
          rows={3}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:border-blue-500 focus:outline-none transition-colors"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-slate-600">仅依据已导入文件作答,并标注出处(⌘/Ctrl+Enter 发送)</p>
          <button
            onClick={() => void handleAsk()}
            disabled={running || !question.trim()}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {running ? '问答中...' : '提问'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {running && (
        <div className="mt-6 flex items-center gap-3 text-sm text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
          正在检索文件并生成回答(通常 1-2 分钟)...
        </div>
      )}

      {result && !running && (
        <div className="mt-6 space-y-4">
          <div className="prose-stream rounded-xl border border-slate-200/10 bg-slate-900/50 p-5 text-sm text-slate-300">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
          </div>
          {result.sources.length > 0 && (
            <div className="rounded-xl border border-slate-200/10 bg-slate-900/30 p-4">
              <p className="mb-2 text-xs font-medium text-slate-500">依据文件</p>
              <ul className="space-y-1">
                {result.sources.map((s, i) => (
                  <li key={i} className="text-xs text-slate-400">
                    «{s.filename}»{s.college ? ` · ${s.college}` : ' · 全校'}
                    <span className="ml-1 text-slate-600">({s.chunks} 段)</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 文件库 ──
function FilesTab({ isAdmin }: { isAdmin: boolean }) {
  const [docs, setDocs] = useState<KbDocumentMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [scope, setScope] = useState<'school' | 'college'>('school')
  const [college, setCollege] = useState<string>(String(DEPARTMENTS[0]))

  const load = useCallback(async () => {
    try {
      setDocs(await serverApi.listKbDocuments())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载文件列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const text = await extractTextFromFile(file)
      await serverApi.createKbDocument({
        filename: file.name,
        scope,
        college: scope === 'college' ? college : undefined,
        text,
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string, filename: string) => {
    if (!confirm(`确定删除文件 ${filename}?问答将不再引用它。`)) return
    try {
      await serverApi.deleteKbDocument(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-4">
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {isAdmin && (
        <div className="rounded-xl border border-slate-200/10 bg-slate-900/50 p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-300">上传文件(文本 / PDF)</h3>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-lg bg-slate-800 p-0.5">
              {(['school', 'college'] as const).map((s) => (
                <button key={s} onClick={() => setScope(s)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    scope === s ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}>
                  {s === 'school' ? '全校文件' : '学院文件'}
                </button>
              ))}
            </div>
            {scope === 'college' && (
              <select value={college} onChange={(e) => setCollege(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none">
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <input ref={fileRef} type="file" accept=".pdf,.txt,.md" onChange={(e) => void handleUpload(e)} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors">
              {busy ? '解析上传中...' : '⬆ 选择文件'}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-600">
            支持 .pdf(文本型)/.txt/.md;扫描版 PDF 无文字层无法入库,请先 OCR(后续支持)。
          </p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200/10 overflow-hidden">
        <div className="border-b border-slate-200/5 bg-slate-900/50 px-4 py-2.5 text-xs text-slate-500">
          {loading ? '加载中...' : `共 ${docs.length} 个文件`}
        </div>
        {!loading && docs.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-slate-600">
            还没有导入任何文件
            {isAdmin ? ',上传后即可问答' : ',请等待管理员导入'}
          </div>
        )}
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-200/5">
            {docs.map((d) => (
              <tr key={d.id} className="text-slate-400 hover:bg-slate-800/30">
                <td className="px-4 py-2.5">
                  <p className="text-slate-200 font-medium">{d.filename}</p>
                  <p className="text-xs text-slate-600">
                    {d.scope === 'school' ? '全校' : d.college} · 上传者 {d.uploadedBy} ·{' '}
                    {new Date(d.uploadedAt).toLocaleString('zh-CN')} · {d.charCount} 字 · {d.chunkCount} 段
                  </p>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {isAdmin && (
                    <button onClick={() => void handleDelete(d.id, d.filename)}
                      className="text-xs text-slate-600 hover:text-red-400 transition-colors">
                      删除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
