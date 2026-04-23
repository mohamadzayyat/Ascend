import Link from 'next/link'
import { Play, Settings } from 'lucide-react'
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { apiClient } from '@/lib/api'
import { useAppRuntime } from '@/lib/hooks/useAuth'

const STATUS_CLASS = {
  deployed: 'bg-green-500/10 text-green-400',
  deploying: 'bg-yellow-500/10 text-yellow-400',
  error: 'bg-red-500/10 text-red-400',
  created: 'bg-blue-500/10 text-blue-400',
}

export default function AppCard({ app, onDeployStarted }) {
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState('')
  const { runtime } = useAppRuntime(app.id)

  const handleDeploy = async () => {
    setDeploying(true)
    setError('')
    try {
      const res = await apiClient.deployApp(app.id)
      if (onDeployStarted) onDeployStarted(res.data.id, app.id)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start deployment')
    } finally {
      setDeploying(false)
    }
  }

  const statusClass = STATUS_CLASS[app.status] || 'bg-gray-500/10 text-gray-400'
  const pm2 = runtime?.pm2

  return (
    <div className="bg-secondary rounded-lg border border-gray-700 p-5 hover:border-accent transition">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <Link href={`/app/${app.id}`}>
            <h3 className="text-base font-bold text-white hover:text-accent transition cursor-pointer">
              {app.name}
            </h3>
          </Link>
          <p className="text-xs text-gray-500 capitalize mt-0.5">
            {app.app_type}{app.subdirectory ? ` · ${app.subdirectory}` : ''}
          </p>
        </div>
        <Link
          href={`/app/${app.id}?tab=settings`}
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
        <p className="text-xs text-gray-400 mb-3 truncate">{app.domain}</p>
      )}
      {app.last_deployment && (
        <p className="text-xs text-gray-500 mb-3">
          Last deployed {formatDistanceToNow(new Date(app.last_deployment), { addSuffix: true })}
        </p>
      )}

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

      <button
        onClick={handleDeploy}
        disabled={deploying || app.status === 'deploying'}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Play className="w-4 h-4" />
        {app.status === 'deploying' ? 'Deploying…' : deploying ? 'Starting…' : 'Deploy'}
      </button>
    </div>
  )
}
