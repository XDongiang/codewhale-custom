import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ServerConfig } from '../config.js'
import type { PersonnelService, ReportsService } from '../services/personnel.js'
import { sendReportMail } from '../services/mail.js'
import { runXhs, startQrLogin, killQrLogin } from '../services/xhs.js'
import type { SessionService } from '../services/sessions.js'
import type { UserRecord, UserService } from '../services/users.js'
import { buildAskPrompt, type KbService } from '../services/kb.js'
import type { RuntimeClient } from '../services/runtime.js'
import { isAdmin, resolveUser } from './auth.js'
import { readJsonBody, sendError, sendJson } from './json.js'
import { proxyRequest } from './proxy.js'
import { serveStatic } from './static.js'

export interface RouteDeps {
  personnel: PersonnelService
  reports: ReportsService
  users: UserService
  sessions: SessionService
  kb: KbService
  runtime: RuntimeClient
}

interface SegmentMatch {
  matched: boolean
  params: Record<string, string>
}

/** /api/xxx/:id 形式的参数路由匹配。 */
function matchSegments(pattern: string[], actual: string[]): SegmentMatch {
  if (pattern.length !== actual.length) return { matched: false, params: {} }
  const params: Record<string, string> = {}
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(actual[i])
    } else if (p !== actual[i]) {
      return { matched: false, params: {} }
    }
  }
  return { matched: true, params }
}

function runtimeReachable(runtimeUrl: string): Promise<boolean> {
  return fetch(`${runtimeUrl}/health`, { signal: AbortSignal.timeout(1500) })
    .then((res) => res.ok)
    .catch(() => false)
}

function scopeOf(user: UserRecord): { role: UserRecord['role']; college?: string } {
  return { role: user.role, college: user.college }
}

function requireAdmin(res: ServerResponse, user: UserRecord): boolean {
  if (isAdmin(user)) return true
  sendError(res, 403, '越权:需要管理员权限')
  return false
}

/**
 * 统一请求入口。返回 true 表示已处理响应。
 */
export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  deps: RouteDeps
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.pathname
  const segments = pathname.split('/').filter(Boolean)
  const method = req.method ?? 'GET'

  try {
    // ── 除 /api/health 与 /api/auth/login|logout 外,一律要求有效用户会话(含 /runtime-api 代理与 /api/auth/me) ──
    const needsAuth =
      (pathname.startsWith('/api/') && pathname !== '/api/health' && pathname !== '/api/auth/login' && pathname !== '/api/auth/logout') ||
      pathname === '/runtime-api' ||
      pathname.startsWith('/runtime-api/')

    const user: UserRecord | null = needsAuth
      ? await resolveUser(req, deps.sessions, deps.users)
      : null
    if (needsAuth && !user) {
      sendError(res, 401, '未登录或会话已过期')
      return true
    }

    // ── Runtime 代理(用户会话鉴权,注入服务器 Runtime 凭证) ──
    if (pathname === '/runtime-api' || pathname.startsWith('/runtime-api/')) {
      const target = pathname.replace(/^\/runtime-api/, '') || '/'
      const qs = url.search
      await proxyRequest(config.runtimeUrl, `${target}${qs}`, req, res, config.authToken)
      return true
    }

    if (!pathname.startsWith('/api/')) {
      // 静态服务(仅生产模式);API-only 模式直接 404
      if (config.staticDir) {
        return serveStatic(config.staticDir, pathname, req, res)
      }
      sendError(res, 404, 'Not Found')
      return true
    }

    // ── health(开放) ──
    if (pathname === '/api/health' && method === 'GET') {
      sendJson(res, 200, { ok: true, runtime: { reachable: await runtimeReachable(config.runtimeUrl) } })
      return true
    }

    // ── 认证 ──
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await readJsonBody(req)
      const username = typeof body['username'] === 'string' ? body['username'].trim() : ''
      const password = typeof body['password'] === 'string' ? body['password'] : ''
      if (!username || !password) {
        sendError(res, 400, '用户名和密码不能为空')
        return true
      }
      const stored = deps.users.getByUsername(username)
      if (!stored || stored.disabled || !(await deps.users.verifyPassword(stored, password))) {
        sendError(res, 401, '用户名或密码错误')
        return true
      }
      const token = deps.sessions.create(stored.id)
      const { salt: _salt, hash: _hash, ...pub } = stored
      sendJson(res, 200, { ok: true, token, user: pub })
      return true
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      const authHeader = req.headers['authorization']
      const token = typeof authHeader === 'string' ? /^Bearer\s+(.+)$/i.exec(authHeader.trim())?.[1] : undefined
      if (token) deps.sessions.revoke(token)
      sendJson(res, 200, { ok: true })
      return true
    }

    if (pathname === '/api/auth/me' && method === 'GET') {
      if (!user) {
        sendError(res, 401, '未登录或会话已过期')
        return true
      }
      sendJson(res, 200, { ok: true, user })
      return true
    }

    // 以下全部需要用户(已在 needsAuth 分支解析)
    if (!user) {
      sendError(res, 401, '未登录或会话已过期')
      return true
    }

    // ── 邮件(任意已登录用户) ──
    if (pathname === '/api/mail/send-report' && method === 'POST') {
      const body = await readJsonBody(req)
      const result = await sendReportMail(
        {
          to: String(body['to'] ?? ''),
          subject: String(body['subject'] ?? ''),
          body: String(body['body'] ?? ''),
          confirmationToken: typeof body['confirmationToken'] === 'string' ? body['confirmationToken'] : undefined,
        },
        config.agentlyBin
      )
      sendJson(res, 200, { ok: true, result })
      return true
    }

    // ── 小红书(任意已登录用户) ──
    if (pathname === '/api/xhs/status') {
      sendJson(res, 200, runXhs(config.xhsBin, 'status --json'))
      return true
    }
    if (pathname === '/api/xhs/login') {
      sendJson(res, 200, runXhs(config.xhsBin, 'login', 30000))
      return true
    }
    if (pathname === '/api/xhs/login-qrcode') {
      const result = await startQrLogin(config.xhsBin, config.xvfbArgs)
      sendJson(res, 200, result)
      return true
    }
    if (pathname === '/api/xhs/logout') {
      killQrLogin()
      sendJson(res, 200, runXhs(config.xhsBin, 'logout'))
      return true
    }
    if (pathname === '/api/xhs/cancel') {
      // 终止正在进行的扫码登录进程(前端"取消"按钮调用)
      killQrLogin()
      sendJson(res, 200, { ok: true })
      return true
    }

    // ── 用户管理(仅 admin) ──
    const usersMatch = matchSegments(['api', 'users'], segments)
    if (usersMatch.matched) {
      if (!requireAdmin(res, user)) return true
      if (method === 'GET') {
        sendJson(res, 200, deps.users.list())
        return true
      }
      if (method === 'POST') {
        const body = await readJsonBody(req)
        const created = await deps.users.create({
          username: String(body['username'] ?? ''),
          password: String(body['password'] ?? ''),
          role: String(body['role'] ?? ''),
          college: body['college'] !== undefined ? String(body['college']) : undefined,
        })
        sendJson(res, 201, created)
        return true
      }
      sendError(res, 405, 'Method Not Allowed')
      return true
    }

    const userById = matchSegments(['api', 'users', ':id'], segments)
    if (userById.matched) {
      if (!requireAdmin(res, user)) return true
      const id = userById.params['id'] ?? ''
      if (id === user.id) {
        sendError(res, 400, '不能操作当前登录账号')
        return true
      }
      if (method === 'PATCH') {
        const body = await readJsonBody(req)
        const updated = await deps.users.update(id, {
          role: body['role'] !== undefined ? String(body['role']) : undefined,
          college: body['college'] !== undefined ? String(body['college']) : undefined,
          password: body['password'] !== undefined ? String(body['password']) : undefined,
          disabled: body['disabled'] !== undefined ? Boolean(body['disabled']) : undefined,
        })
        if (!updated) {
          sendError(res, 404, '用户不存在')
          return true
        }
        sendJson(res, 200, updated)
        return true
      }
      if (method === 'DELETE') {
        const username = deps.users.remove(id)
        if (username === null) {
          sendError(res, 404, '用户不存在')
          return true
        }
        sendJson(res, 200, { ok: true })
        return true
      }
      sendError(res, 405, 'Method Not Allowed')
      return true
    }

    // ── 人员名单(读:按角色过滤;写:仅 admin) ──
    const personnelMatch = matchSegments(['api', 'personnel'], segments)
    if (personnelMatch.matched) {
      if (method === 'GET') {
        sendJson(res, 200, deps.personnel.listScoped(scopeOf(user)))
        return true
      }
      if (!requireAdmin(res, user)) return true
      if (method === 'POST') {
        const body = await readJsonBody(req)
        const entry = deps.personnel.create(body)
        if (!entry) {
          sendError(res, 400, '人员姓名不能为空')
          return true
        }
        sendJson(res, 201, entry)
        return true
      }
      if (method === 'PUT') {
        const body = await readJsonBody(req)
        const entries = Array.isArray(body['entries']) ? (body['entries'] as unknown[]) : []
        sendJson(res, 200, deps.personnel.replace(entries))
        return true
      }
      if (method === 'DELETE') {
        deps.personnel.clear()
        sendJson(res, 200, { ok: true })
        return true
      }
      sendError(res, 405, 'Method Not Allowed')
      return true
    }

    const personnelById = matchSegments(['api', 'personnel', ':id'], segments)
    if (personnelById.matched) {
      if (!requireAdmin(res, user)) return true
      const id = personnelById.params['id'] ?? ''
      if (method === 'PATCH') {
        const body = await readJsonBody(req)
        const updated = deps.personnel.update(id, body)
        if (!updated) {
          sendError(res, 404, '人员不存在')
          return true
        }
        sendJson(res, 200, updated)
        return true
      }
      if (method === 'DELETE') {
        const removed = deps.personnel.remove(id)
        if (!removed) {
          sendError(res, 404, '人员不存在')
          return true
        }
        sendJson(res, 200, { ok: true })
        return true
      }
      sendError(res, 405, 'Method Not Allowed')
      return true
    }

    const bulkMatch = matchSegments(['api', 'personnel', 'bulk'], segments)
    if (bulkMatch.matched && method === 'POST') {
      if (!requireAdmin(res, user)) return true
      const body = await readJsonBody(req)
      const rawEntries = Array.isArray(body['entries']) ? (body['entries'] as unknown[]) : []
      const result = deps.personnel.bulkAdd(rawEntries)
      sendJson(res, 200, { ok: true, added: result.added, entries: result.entries })
      return true
    }

    // ── 舆情报告(读:按角色过滤;写:报告创建/删除按范围,整表替换仅 admin) ──
    const reportsMatch = matchSegments(['api', 'reports'], segments)
    if (reportsMatch.matched) {
      if (method === 'GET') {
        sendJson(res, 200, deps.reports.listScoped(scopeOf(user)))
        return true
      }
      if (method === 'POST') {
        const body = await readJsonBody(req)
        const report = deps.reports.createScoped(body, scopeOf(user))
        if (!report) {
          sendError(res, 400, '报告内容不能为空')
          return true
        }
        sendJson(res, 201, report)
        return true
      }
      if (method === 'PUT') {
        if (!requireAdmin(res, user)) return true
        const body = await readJsonBody(req)
        const reports = Array.isArray(body['reports']) ? (body['reports'] as unknown[]) : []
        sendJson(res, 200, deps.reports.replace(reports))
        return true
      }
      sendError(res, 405, 'Method Not Allowed')
      return true
    }

    const reportById = matchSegments(['api', 'reports', ':id'], segments)
    if (reportById.matched && method === 'DELETE') {
      const removed = deps.reports.removeScoped(reportById.params['id'] ?? '', scopeOf(user))
      if (!removed) {
        sendError(res, 404, '报告不存在')
        return true
      }
      sendJson(res, 200, { ok: true })
      return true
    }

    // ── 文件知识库 ──
    const kbDocs = matchSegments(['api', 'kb', 'documents'], segments)
    if (kbDocs.matched) {
      if (method === 'GET') {
        sendJson(res, 200, deps.kb.listMeta(scopeOf(user)))
        return true
      }
      if (!requireAdmin(res, user)) return true
      if (method === 'POST') {
        const body = await readJsonBody(req)
        const doc = deps.kb.add({
          filename: String(body['filename'] ?? ''),
          college: body['college'] !== undefined ? String(body['college']) : undefined,
          scope: body['scope'] === 'college' ? 'college' : 'school',
          text: String(body['text'] ?? ''),
          uploadedBy: user.username,
        })
        sendJson(res, 201, doc)
        return true
      }
      sendError(res, 405, 'Method Not Allowed')
      return true
    }

    const kbDocById = matchSegments(['api', 'kb', 'documents', ':id'], segments)
    if (kbDocById.matched && method === 'DELETE') {
      if (!requireAdmin(res, user)) return true
      const removed = deps.kb.remove(kbDocById.params['id'] ?? '')
      if (!removed) {
        sendError(res, 404, '文件不存在')
        return true
      }
      sendJson(res, 200, { ok: true })
      return true
    }

    if (pathname === '/api/kb/search' && method === 'GET') {
      const q = url.searchParams.get('q') ?? ''
      const topK = Number.parseInt(url.searchParams.get('top_k') ?? '6', 10)
      sendJson(res, 200, { results: deps.kb.search(q, scopeOf(user), Number.isFinite(topK) ? topK : 6) })
      return true
    }

    if (pathname === '/api/kb/ask' && method === 'POST') {
      const body = await readJsonBody(req)
      const question = String(body['question'] ?? '').trim()
      if (!question) {
        sendError(res, 400, '问题不能为空')
        return true
      }
      const hits = deps.kb.search(question, scopeOf(user))
      const prompt = buildAskPrompt(question, hits)
      try {
        const result = await deps.runtime.ask(prompt, config.kbModel)
        sendJson(res, 200, {
          ok: true,
          answer: result.answer,
          threadId: result.threadId,
          sources: hits.map((h) => ({ filename: h.doc.filename, college: h.doc.college ?? null, scope: h.doc.scope, chunks: h.chunks.length })),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : '问答服务不可用'
        sendError(res, 502, `问答服务暂不可用:${message}。请确认 CodeWhale Runtime 已启动。`)
      }
      return true
    }

    sendError(res, 404, 'Not Found')
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : '服务器内部错误'
    console.error(`[${method} ${pathname}]`, err)
    if (!res.headersSent) {
      sendError(res, 400, message)
    } else {
      res.end()
    }
    return true
  }
}
