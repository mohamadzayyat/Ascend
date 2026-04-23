import Link from 'next/link'
import { useRouter } from 'next/router'
import { Settings } from 'lucide-react'
import { useAppRuntime } from '@/lib/hooks/useAuth'
import { relativeLocalTime } from '@/lib/time'

const STATUS_CLASS = {
  deployed: 'bg-green-500/10 text-green-400',
  deploying: 'bg-yellow-500/10 text-yellow-400',
  error: 'bg-red-500/10 text-red-400',
  created: 'bg-blue-500/10 text-blue-400',
}

export default function AppCard({ app }) {
  const router = useRouter()
  const { runtime } = useAppRuntime(app.id)
  const statusClass = STATUS_CLASS[app.status] || 'bg-gray-500/10 text-gray-400'
  const pm2 = runtime?.pm2

  const openApp = () => router.push(`/app/${app.id}`)
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openApp()
    }
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openApp}
      onKeyDown={onKey}
      className="bg-secondary rounded-lg border border-gray-700 p-5 hover:border-accent transition cursor-pointer"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-white hover:text-accent transition">
            {app.name}
          </h3>
          <p className="text-xs text-gray-500 capitalize mt-0.5">
            {app.app_type}{app.subdirectory ? ` · ${app.subdirectory}` : ''}
          </p>
        </div>
        <Link
          href={`/app/${app.id}?tab=settings`}
          onClick={(e) => e.stopPropagation()}
          className="p-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-primary transition"
          title="App settings"
        >
          <Settings className="w-4 h-4" />
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${statusClass}`}>
          {app.status}
        </span>
        {pm2 && (
          <span
            className={`px-2 py-0.5 rounded text-xs font-semibold ${
              pm2.status === 'online'
                ? 'bg-green-500/10 text-green-400'
                : pm2.status === 'errored'
                ? 'bg-red-500/10 text-red-400'
                : 'bg-gray-500/10 text-gray-400'
            }`}
          >
            pm2: {pm2.status}
          </span>
        )}
        {app.app_port && (
          <span className="text-xs text-gray-500 font-mono">:{app.app_port}</span>
        )}
      </div>

      {app.domain && (
        <p className="text-xs text-gray-400 mb-1 truncate">{app.domain}</p>
      )}
      {app.last_deployment && (
        <p className="text-xs text-gray-500">
          Last deployed {relativeLocalTime(app.last_deployment)}
        </p>
      )}
    </div>
  )
}
