import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { apiClient } from '@/lib/api'
import { absoluteLocalTime, relativeLocalTime } from '@/lib/time'

function LogBlock({ title, subtitle, content, empty = 'No log output.' }) {
  return (
    <div className="bg-secondary rounded-lg border border-gray-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700 bg-primary/40">
        <h3 className="text-white font-semibold">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mt-1 break-all">{subtitle}</p>}
      </div>
      <pre className="max-h-[28rem] overflow-auto p-4 bg-black/40 text-xs text-gray-300 whitespace-pre-wrap break-words">
        {content || empty}
      </pre>
    </div>
  )
}

export default function AppLogs({ appId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [active, setActive] = useState('nginx')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiClient.getAppLogs(appId, 260)
      setData(res.data)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load logs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [appId]) // eslint-disable-line react-hooks/exhaustive-deps

  const tabs = [
    ['nginx', 'Nginx'],
    ['deployment', 'Deployments'],
    ['pm2', 'PM2'],
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">App Logs</h2>
          <p className="text-sm text-gray-500">Use Nginx errors first for 500/403/404 on domains, then deployment or PM2 logs.</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{error}</div>}

      <div className="flex gap-2 border-b border-gray-700">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            className={`px-3 py-2 text-sm font-semibold border-b-2 ${active === id ? 'text-accent border-accent' : 'text-gray-400 border-transparent hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="text-gray-400">Loading logs...</div>
      ) : active === 'nginx' ? (
        <div className="space-y-4">
          {(data?.nginx_logs || []).map((log) => (
            <LogBlock
              key={log.path}
              title={log.path?.includes('error') ? 'Nginx error log' : 'Nginx access log'}
              subtitle={log.path}
              content={log.content || log.error}
              empty={log.exists === false ? 'Log file was not found on this server.' : 'No recent Nginx output.'}
            />
          ))}
        </div>
      ) : active === 'pm2' ? (
        <LogBlock
          title="PM2 logs"
          subtitle={data?.app?.pm2_name || 'This app is not running under PM2.'}
          content={data?.pm2_logs?.combined}
          empty="No PM2 logs for this app."
        />
      ) : (
        <div className="space-y-4">
          {(data?.deployment_logs || []).map((dep) => (
            <LogBlock
              key={dep.id}
              title={`Deployment #${dep.id} - ${dep.status}`}
              subtitle={`${dep.branch || '-'} - ${dep.started_at ? relativeLocalTime(dep.started_at) : '-'} (${absoluteLocalTime(dep.started_at)})`}
              content={dep.log?.content || dep.log?.error}
              empty="No deployment log content."
            />
          ))}
        </div>
      )}
    </div>
  )
}
