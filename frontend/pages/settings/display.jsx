import Link from 'next/link'
import { Check, Palette } from 'lucide-react'
import { useEffect, useState } from 'react'

const THEMES = [
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'The original Ascend dark theme with a clear blue accent.',
    colors: ['#0f172a', '#1e293b', '#3b82f6'],
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Cool teal tones for long operational sessions.',
    colors: ['#081b23', '#112d39', '#14b8a6'],
  },
  {
    id: 'ember',
    name: 'Ember',
    description: 'Warm dark surfaces with a confident orange accent.',
    colors: ['#1e1412', '#32221d', '#f4722a'],
  },
  {
    id: 'violet',
    name: 'Violet',
    description: 'Deep violet panels with a focused purple action color.',
    colors: ['#191428', '#2b2141', '#8b5cf6'],
  },
  {
    id: 'graphite',
    name: 'Graphite',
    description: 'Neutral charcoal with a green infrastructure accent.',
    colors: ['#11181d', '#1f292f', '#22c55e'],
  },
]

function applyTheme(themeId) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', themeId)
  try {
    localStorage.setItem('ascend-theme', themeId)
  } catch {}
}

export default function DisplaySettings() {
  const [theme, setTheme] = useState('midnight')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('ascend-theme') || 'midnight'
      setTheme(saved)
      applyTheme(saved)
    } catch {
      applyTheme('midnight')
    }
  }, [])

  const selectTheme = (themeId) => {
    setTheme(themeId)
    applyTheme(themeId)
  }

  return (
    <div className="p-8 max-w-6xl">
      <Link href="/settings" className="text-gray-400 hover:text-white text-sm inline-flex items-center gap-1 mb-6">
        Back to Settings
      </Link>

      <div className="mb-8 flex items-start gap-3">
        <Palette className="w-10 h-10 text-accent shrink-0" />
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Display Settings</h1>
          <p className="text-gray-400 text-sm">
            Choose the panel theme used across dashboards, settings, security, databases, and deployment screens.
          </p>
        </div>
      </div>

      <section className="rounded-lg border border-gray-700 bg-secondary p-5 mb-6">
        <h2 className="text-white font-semibold inline-flex items-center gap-2 mb-2">
          <Palette className="w-5 h-5 text-accent" /> Theme
        </h2>
        <p className="text-gray-400 text-sm">
          These themes keep the same contrast model as the current dark mode, so existing tables, forms, alerts, and buttons remain readable.
        </p>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {THEMES.map((item) => {
          const active = item.id === theme
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => selectTheme(item.id)}
              className={`text-left rounded-lg border p-4 bg-secondary hover:border-accent transition relative overflow-hidden ${
                active ? 'border-accent ring-1 ring-accent/50' : 'border-gray-700'
              }`}
            >
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="text-white font-semibold">{item.name}</div>
                {active && <Check className="w-5 h-5 text-accent" />}
              </div>
              <div className="flex rounded-md overflow-hidden border border-gray-700 mb-4 h-16">
                {item.colors.map((color) => (
                  <span key={color} className="flex-1" style={{ backgroundColor: color }} />
                ))}
              </div>
              <p className="text-gray-400 text-sm min-h-[3.75rem]">{item.description}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
