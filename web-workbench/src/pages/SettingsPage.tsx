import { useState } from 'react'
import { useSettingsStore } from '../stores/settings-store'
import { getClient } from '../lib/api/client'

export function SettingsPage() {
  const settings = useSettingsStore()
  const [apiUrl, setApiUrl] = useState(settings.apiUrl)
  const [authToken, setAuthToken] = useState(settings.authToken)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleSave = () => {
    settings.updateSettings({ apiUrl, authToken })
    // Reinitialize client
    getClient({ apiUrl, authToken })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const client = getClient({ apiUrl, authToken })
      const res = await client.health()
      setTestResult({ ok: true, msg: `Connected! Status: ${res.status}` })
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : 'Connection failed' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center border-b border-gray-800 px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-100">Settings</h1>
      </div>

      {/* Form */}
      <div className="max-w-lg space-y-5 p-6">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-300">
            CodeWhale Runtime API URL
          </label>
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="http://localhost:7878"
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            The address where <code className="text-gray-400">codewhale serve --http</code> is running
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-300">
            Auth Token
          </label>
          <input
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder="your-secret-token"
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            Token passed via <code className="text-gray-400">--auth-token</code> flag
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleSave}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            {saved ? '✓ Saved!' : 'Save'}
          </button>
          <button
            onClick={() => void handleTest()}
            disabled={testing}
            className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {testResult && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              testResult.ok
                ? 'border-green-800 bg-green-900/30 text-green-300'
                : 'border-red-800 bg-red-900/30 text-red-300'
            }`}
          >
            {testResult.msg}
          </div>
        )}
      </div>
    </div>
  )
}
