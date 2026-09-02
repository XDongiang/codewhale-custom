import { serverApi, type ServerReport } from './api/server'
import type { PersonEntry, PersonnelLevel, ReportLevel } from '../types'

/**
 * 浏览器 localStorage → 服务端 的一次性迁移与备份工具。
 *
 * 迁移条件(见 MigrationBanner):本浏览器存在旧键 && 服务端名单/报告均为空。
 * 旧数据成功写入服务端后才删除本地键,失败可重试。
 */

const P_STRUCT = 'codewhale-personnel' // 结构化名单 {version, updatedAt, entries}
const P_FLAT = 'codewhale-namelist' // 旧扁平名单 [{name, department?, role?}]
const R_V2 = 'ccnu-monitor-reports-v2' // 结构化报告
const R_V1 = 'ccnu-monitor-reports' // 旧报告(无 level 字段)

export const REPORT_MAIL_KEY = 'ccnu-monitor-report-mail'
const MIGRATION_DISMISSED_KEY = 'ccnu-migration-dismissed'

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function hasLegacyData(): boolean {
  return Boolean(
    localStorage.getItem(P_STRUCT) ||
      localStorage.getItem(P_FLAT) ||
      localStorage.getItem(R_V2) ||
      localStorage.getItem(R_V1)
  )
}

export function isMigrationDismissed(): boolean {
  return localStorage.getItem(MIGRATION_DISMISSED_KEY) === '1'
}

export function dismissMigration(): void {
  localStorage.setItem(MIGRATION_DISMISSED_KEY, '1')
}

export function clearLegacyData(): void {
  localStorage.removeItem(P_STRUCT)
  localStorage.removeItem(P_FLAT)
  localStorage.removeItem(R_V2)
  localStorage.removeItem(R_V1)
}

function readLegacyPersonnel(): PersonEntry[] {
  const structured = safeParse<{ version?: number; entries?: unknown[] }>(localStorage.getItem(P_STRUCT))
  if (structured?.entries && structured.entries.length > 0) {
    return structured.entries
      .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
      .map(normalizePersonEntry)
      .filter((e): e is PersonEntry => e !== null)
  }

  const flat = safeParse<Array<{ name?: unknown; department?: unknown; role?: unknown }>>(localStorage.getItem(P_FLAT))
  if (Array.isArray(flat) && flat.length > 0) {
    const now = new Date().toISOString()
    return flat
      .filter((e) => typeof e?.name === 'string' && e.name.trim() !== '')
      .map((e) => ({
        id: `migrated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: (e.name as string).trim(),
        level: 'individual' as PersonnelLevel,
        category: typeof e.role === 'string' && e.role ? e.role : '其他',
        college: typeof e.department === 'string' ? e.department : undefined,
        role: typeof e.role === 'string' ? e.role : undefined,
        createdAt: now,
        updatedAt: now,
      }))
  }
  return []
}

function normalizePersonEntry(raw: Record<string, unknown>): PersonEntry | null {
  if (typeof raw['name'] !== 'string' || (raw['name'] as string).trim() === '') return null
  const now = new Date().toISOString()
  return {
    id: typeof raw['id'] === 'string' ? (raw['id'] as string) : `migrated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: (raw['name'] as string).trim(),
    level: isPersonnelLevel(raw['level']) ? raw['level'] : 'individual',
    category: typeof raw['category'] === 'string' && raw['category'] ? (raw['category'] as string) : '其他',
    college: typeof raw['college'] === 'string' ? raw['college'] : undefined,
    department: typeof raw['department'] === 'string' ? raw['department'] : undefined,
    role: typeof raw['role'] === 'string' ? raw['role'] : undefined,
    tags: Array.isArray(raw['tags']) ? raw['tags'].filter((t): t is string => typeof t === 'string') : undefined,
    notes: typeof raw['notes'] === 'string' ? raw['notes'] : undefined,
    createdAt: typeof raw['createdAt'] === 'string' ? (raw['createdAt'] as string) : now,
    updatedAt: typeof raw['updatedAt'] === 'string' ? (raw['updatedAt'] as string) : now,
  }
}

function isPersonnelLevel(v: unknown): v is PersonnelLevel {
  return (
    typeof v === 'string' &&
    ['school', 'college', 'department', 'class', 'course', 'individual'].includes(v)
  )
}

function readLegacyReports(): ServerReport[] {
  const structured = safeParse<ServerReport[]>(localStorage.getItem(R_V2))
  if (Array.isArray(structured) && structured.length > 0) return structured

  const legacy = safeParse<Array<Record<string, unknown>>>(localStorage.getItem(R_V1))
  if (Array.isArray(legacy) && legacy.length > 0) {
    return legacy
      .filter((r) => typeof r['content'] === 'string' && (r['content'] as string).trim() !== '')
      .map((r) => ({
        id: typeof r['id'] === 'string' ? (r['id'] as string) : `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        dept: typeof r['dept'] === 'string' ? (r['dept'] as string) : '未命名报告',
        timeRange: typeof r['timeRange'] === 'string' ? (r['timeRange'] as string) : '',
        content: r['content'] as string,
        createdAt: typeof r['createdAt'] === 'string' ? (r['createdAt'] as string) : new Date().toISOString(),
        threadId: typeof r['threadId'] === 'string' ? (r['threadId'] as string) : undefined,
        level: isReportLevel(r['level']) ? r['level'] : 'college',
        personName: typeof r['personName'] === 'string' ? (r['personName'] as string) : undefined,
      }))
  }
  return []
}

function isReportLevel(v: unknown): v is ReportLevel {
  return (
    typeof v === 'string' &&
    ['school', 'college', 'department', 'class', 'course', 'individual'].includes(v)
  )
}

/** 执行迁移:旧数据写入服务端,成功后清空本地键。 */
export async function migrateLegacyData(): Promise<{ personnel: number; reports: number }> {
  const personnel = readLegacyPersonnel()
  const reports = readLegacyReports()

  if (personnel.length > 0) {
    await serverApi.bulkPersonnel(personnel)
  }
  if (reports.length > 0) {
    await serverApi.replaceReports(reports)
  }
  clearLegacyData()
  return { personnel: personnel.length, reports: reports.length }
}

/** 备份:导出服务端全部数据(名单 + 报告)为 JSON 字符串。 */
export async function exportAllData(): Promise<string> {
  const [personnel, reports] = await Promise.all([serverApi.listPersonnel(), serverApi.listReports()])
  return JSON.stringify(
    {
      app: 'ccnu-ai-workbench',
      exportedAt: new Date().toISOString(),
      personnel,
      reports,
    },
    null,
    2
  )
}

/** 还原:整体替换服务端名单与报告(兜底恢复路径)。 */
export async function restoreFromJson(text: string): Promise<{ personnel: number; reports: number }> {
  const data = JSON.parse(text) as { personnel?: { entries?: PersonEntry[] }; reports?: ServerReport[] }
  let personnelCount = 0
  let reportCount = 0
  if (Array.isArray(data.personnel?.entries)) {
    await serverApi.replacePersonnel(data.personnel.entries)
    personnelCount = data.personnel.entries.length
  }
  if (Array.isArray(data.reports)) {
    await serverApi.replaceReports(data.reports)
    reportCount = data.reports.length
  }
  return { personnel: personnelCount, reports: reportCount }
}
