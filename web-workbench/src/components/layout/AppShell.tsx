import { useEffect, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { MigrationBanner } from './MigrationBanner'
import { useSettingsStore } from '../../stores/settings-store'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  // 启动时从服务端加载人员名单(旧 localStorage 数据由 MigrationBanner 一次性迁移)
  useEffect(() => {
    void useSettingsStore.getState().hydratePersonnel()
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950">
      <MigrationBanner />
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  )
}
