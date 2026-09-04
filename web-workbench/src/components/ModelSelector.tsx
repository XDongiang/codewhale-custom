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
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-slate-300 hover:text-slate-800 disabled:opacity-50 transition-colors"
      >
        <span className="max-w-[100px] truncate">{selected.label}</span>
        <span className="text-slate-500">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white shadow-xl">
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
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="text-sm font-medium">{model.label}</span>
                <span className="text-xs text-slate-400">{model.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
