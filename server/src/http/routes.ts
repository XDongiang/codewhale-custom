import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ServerConfig } from '../config.js'
import type { PersonnelService, ReportsService } from '../services/personnel.js'
import { sendReportMail, type SendMailResult } from '../services/mail.js'
import { runXhs, startQrLogin, killQrLogin } from '../services/xhs.js'
import { authorized } from './auth.js'
import { readJsonBody, sendError, sendJson } from './json.js'
import { proxyRequest } from './proxy.js'
import { serveStatic } from './static.js'

export interface RouteDeps {
  personnel: PersonnelService
  reports: ReportsService
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
    // ── runtime 代理(先于鉴权:未带 token 的请求由 runtime 自行拒绝) ──
    if (pathname === '/runtime-api' || pathname.startsWith('/runtime-api/')) {
      if (!authorized(req, config.authToken)) {
        sendError(res, 401, '未授权')
        return true
      }
      const target = pathname.replace(/^\/runtime-api/, '') || '/'
      const qs = url.search
      await proxyRequest(config.runtimeUrl, `${target}${qs}`, req, res)
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

    // ── API:除 /api/health 外全部要求 Bearer token ──
    if (pathname !== '/api/health' && !authorized(req, config.authToken)) {
      sendError(res, 401, '未授权')
      return true
    }

    // ── health ──
    if (pathname === '/api/health' && method === 'GET') {
      sendJson(res, 200, { ok: true, runtime: { reachable: await runtimeReachable(config.runtimeUrl) } })
      return true
    }

    // ── 邮件 ──
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
      sendJson(res, 200, { ok: true, result: result.result satisfies SendMailResult })
      return true
    }

    // ── 小红书 ──
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

    // ── 人员名单 ──
    const personnelMatch = matchSegments(['api', 'personnel'], segments)
    if (personnelMatch.matched) {
      if (method === 'GET') {
        sendJson(res, 200, deps.personnel.list())
        return true
      }
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

    const bulkMatch = matchSegments(['api', 'personnel', 'bulk'], segments)
    if (bulkMatch.matched && method === 'POST') {
      const body = await readJsonBody(req)
      const rawEntries = Array.isArray(body['entries']) ? (body['entries'] as unknown[]) : []
      const result = deps.personnel.bulkAdd(rawEntries)
      sendJson(res, 200, { ok: true, added: result.added, entries: result.entries })
      return true
    }

    const personnelById = matchSegments(['api', 'personnel', ':id'], segments)
    if (personnelById.matched) {
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

    // ── 舆情报告 ──
    const reportsMatch = matchSegments(['api', 'reports'], segments)
    if (reportsMatch.matched) {
      if (method === 'GET') {
        sendJson(res, 200, deps.reports.list())
        return true
      }
      if (method === 'POST') {
        const body = await readJsonBody(req)
        const report = deps.reports.create(body)
        if (!report) {
          sendError(res, 400, '报告内容不能为空')
          return true
        }
        sendJson(res, 201, report)
        return true
      }
      if (method === 'PUT') {
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
      const removed = deps.reports.remove(reportById.params['id'] ?? '')
      if (!removed) {
        sendError(res, 404, '报告不存在')
        return true
      }
      sendJson(res, 200, { ok: true })
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
