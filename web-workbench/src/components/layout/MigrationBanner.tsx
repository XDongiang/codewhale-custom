import { useEffect, useState } from 'react'
import { serverApi } from '../../lib/api/server'
import {
  hasLegacyData,
  isMigrationDismissed,
  dismissMigration,
  migrateLegacyData,
} from '../../lib/migration'

/**
 * 旧浏览器数据一键迁移横幅。
 * 条件:本地存在旧名单/报告键 && 服务端名单与报告均为空。迁移成功后整页刷新。
 */
export function MigrationBanner() {
  const [state, setState] = useState<'checking' | 'offer' | 'migrating' | 'none' | 'error'>('checking')
  const [error, setError] = useState('')

  useEffect(() => {
    if (isMigrationDismissed()) {
      setState('none')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const [personnel, reports] = await Promise.all([
          serverApi.listPersonnel(),
          serverApi.listReports(),
        ])
        if (!cancelled && hasLegacyData() && personnel.entries.length === 0 && reports.length === 0) {
          setState('offer')
        } else {
          setState('none')
        }
      } catch {
        // 服务端不可达时不打扰用户
        setState('none')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'checking' || state === 'none' || state === 'migrating') return null

  const handleMigrate = async () => {
    setState('migrating')
    setError('')
    try {
      await migrateLegacyData()
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '迁移失败,请重试')
      setState('offer')
    }
  }

  const handleDismiss = () => {
    dismissMigration()
    setState('none')
    window.location.reload()
  }

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4">
      <div className="flex max-w-xl items-center gap-4 rounded-xl border border-blue-500/30 bg-slate-900 px-5 py-4 shadow-xl shadow-blue-500/10">
        <span className="text-2xl">🔄</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-200">
            检测到本浏览器的旧数据(名单 / 报告),是否迁移到服务器?
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            迁移后任何浏览器、任何设备都能看到同一份数据,且不再依赖本机浏览器缓存。
          </p>
          {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => void handleMigrate()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          >
            一键迁移
          </button>
          <button
            onClick={handleDismiss}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            暂不
          </button>
        </div>
      </div>
    </div>
  )
}
