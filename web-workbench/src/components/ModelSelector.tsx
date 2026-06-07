import { useState, useRef, useEffect } from 'react'

const AVAILABLE_MODELS = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', desc: '最新旗舰模型' },
  { id: 'deepseek-chat', label: 'DeepSeek Chat', desc: '通用对话' },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', desc: '深度推理' },
]

interface ModelSelectorProps {
  /** Currently selected model id */
  value: string
  /** Called when user selects a different model */
  onChange: (model: string) => void
  disabled?: boolean
}

export function ModelSelector({ value, onChange, disabled }: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  const selected = AVAILABLE_MODELS.find((m) => m.id === value) ?? AVAILABLE_MODELS[0]!

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-gray-300 hover:border-gray-600 hover:text-gray-200 disabled:opacity-50 transition-colors"
      >
        <span className="max-w-[100px] truncate">{selected.label}</span>
        <span className="text-gray-600">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
          <div className="p-1">
            {AVAILABLE_MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => {
                  onChange(model.id)
                  setOpen(false)
                }}
                className={`flex w-full flex-col rounded-md px-3 py-2 text-left transition-colors ${
                  model.id === value
                    ? 'bg-blue-600/20 text-blue-400'
                    : 'text-gray-300 hover:bg-gray-800'
                }`}
              >
                <span className="text-sm font-medium">{model.label}</span>
                <span className="text-xs text-gray-500">{model.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
