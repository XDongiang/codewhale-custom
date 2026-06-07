import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { getClient } from '../../lib/api/client'
import { useSettingsStore } from '../../stores/settings-store'

const navItems = [
  { to: '/', label: 'Chat', icon: '💬', end: true },
  { to: '/history', label: 'History', icon: '📋' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

export function Sidebar() {
  const location = useLocation()
  const settings = useSettingsStore()
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking')

  useEffect(() => {
    let cancelled = false
    async function check() {
      setApiStatus('checking')
      try {
        const client = getClient(settings)
        await client.health()
        if (!cancelled) setApiStatus('connected')
      } catch {
        if (!cancelled) setApiStatus('disconnected')
      }
    }
    void check()
    return () => { cancelled = true }
  }, [settings])

  return (
    <aside className="flex h-full w-56 flex-col border-r border-gray-800 bg-gray-900">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-gray-800 px-4">
        <span className="text-xl">🐳</span>
        <span className="text-sm font-semibold text-gray-200">CodeWhale</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 p-3">
        {navItems.map((item) => {
          const active = item.end
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to)

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-800 p-3">
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-gray-500">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              apiStatus === 'connected'
                ? 'bg-green-500'
                : apiStatus === 'checking'
                  ? 'bg-yellow-500 animate-pulse'
                  : 'bg-red-500'
            }`}
          />
          <span>
            {apiStatus === 'connected'
              ? 'Runtime API connected'
              : apiStatus === 'checking'
                ? 'Checking...'
                : 'Runtime API disconnected'}
          </span>
        </div>
      </div>
    </aside>
  )
}
