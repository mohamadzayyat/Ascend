import { useState } from 'react'
import Link from 'next/link'
import { Copy, Check, RefreshCw } from 'lucide-react'
import { apiClient } from '@/lib/api'
import { useAppRuntime } from '@/lib/hooks/useAuth'

function formatUptime(ms) {
  if (!ms || ms <= 0) return '—'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m`
  return `${s}s`
}

export default function AppRuntime({ appId }) {
  const { runtime, isLoading } = useAppRuntime(appId)
  const [copied, setCopied] = useState(false)
  const [sslLoading, setSslLoading] = useState(false)
  const [sslResult, setSslResult] = useState(null)
  const [sslError, setSslError] = useState('')

  if (isLoading && !runtime) {
    return (
      <div className="bg-secondary rounded-lg border border-gray-700 p-6">
        <p className="text-gray-400">Loading runtime status…</p>
      </div>
    )
  }
  if (!runtime) return null

  const { pm2, port, port_listening, webhook_path, domain } = runtime
  const webhookUrl =
    webhook_path && typeof window !== 'undefined'
      ? `${window.location.origin}${webhook_path}`
      : null

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (_) {}
  }

  const retrySsl = async () => {
    setSslLoading(true)
    setSslError('')
    setSslResult(null)
    try {
      const res = await apiClient.retryAppSsl(appId)
      setSslResult(res.data)
    } catch (err) {
      setSslError(err.response?.data?.error || err.message || 'Failed to start SSL retry')
    } finally {
      setSslLoading(false)
    }
  }

  return (
    <div className="bg-secondary rounded-lg border border-gray-700 p-6">
      <h2 className="text-xl font-bold text-white mb-4">Runtime</h2>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-gray-400 text-sm">PM2 status</p>
          {pm2 ? (
            <p className="text-white">
              <span
                className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mr-2 ${
                  pm2.status === 'online'
                    ? 'bg-green-500/20 text-green-400'
                    : pm2.status === 'errored'
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-gray-500/20 text-gray-400'
                }`}
              >
                {pm2.status}
              </span>
              PID {pm2.pid || '—'}
            </p>
          ) : (
            <p className="text-gray-500">Not running under PM2</p>
          )}
        </div>

        <div>
          <p className="text-gray-400 text-sm">Port</p>
          {port ? (
            <p className="text-white font-mono">
              {port}
              {port_listening === true && (
                <span className="text-green-400 text-xs ml-2">listening</span>
              )}
              {port_listening === false && (
                <span className="text-red-400 text-xs ml-2">not bound</span>
              )}
            </p>
          ) : (
            <p className="text-gray-500">—</p>
          )}
        </div>

        {pm2 && (
          <>
            <div>
              <p className="text-gray-400 text-sm">CPU / Memory</p>
              <p className="text-white">{pm2.cpu}% · {pm2.memory_mb} MB</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Uptime · Restarts</p>
              <p className="text-white">{formatUptime(pm2.uptime_ms)} · {pm2.restarts}</p>
            </div>
          </>
        )}

        {domain && (
          <div className="col-span-2">
            <p className="text-gray-400 text-sm">Domain</p>
            <p className="text-white">{domain}</p>
          </div>
        )}
      </div>

      {domain && (
        <div className="pt-4 border-t border-gray-700 mb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-gray-400 text-sm">SSL</p>
              <p className="text-gray-500 text-xs">Retry certificate issuance without rebuilding the app.</p>
            </div>
            <button
              type="button"
              onClick={retrySsl}
              disabled={sslLoading}
              className="inline-flex items-center gap-2 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${sslLoading ? 'animate-spin' : ''}`} />
              {sslLoading ? 'Starting...' : 'Retry SSL'}
            </button>
          </div>
          {sslError && <p className="text-red-400 text-xs mt-2">{sslError}</p>}
          {sslResult?.id && (
            <p className="text-green-400 text-xs mt-2">
              SSL retry started as deployment #{sslResult.id}.{' '}
              <Link href={`/app/${appId}?tab=deployments`} className="underline">
                View logs
              </Link>
            </p>
          )}
        </div>
      )}

      {webhookUrl && (
        <div className="pt-4 border-t border-gray-700">
          <p className="text-gray-400 text-sm mb-2">GitHub webhook URL (project-level)</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-primary px-3 py-2 rounded text-white text-xs font-mono truncate">
              {webhookUrl}
            </code>
            <button
              onClick={() => copy(webhookUrl)}
              className="px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm flex items-center gap-1"
              title="Copy URL"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-gray-500 text-xs mt-2">
            Same webhook for every app in the project. Auto-deploy on push installs this into
            GitHub automatically when enabled in project settings.
          </p>
        </div>
      )}
    </div>
  )
}
