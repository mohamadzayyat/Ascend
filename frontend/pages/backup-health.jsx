import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Activity, Database, Loader2, RefreshCw } from 'lucide-react'
import { apiClient } from '@/lib/api'

function formatBytes(n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = Number(n)
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function statusClass(status) {
  if (status === 'healthy') return 'border-green-500/40 bg-green-500/10 text-green-200'
  if (status === 'running') return 'border-blue-500/40 bg-blue-500/10 text-blue-200'
  if (status === 'failed') return 'border-red-500/40 bg-red-500/10 text-red-200'
  return 'border-amber-500/40 bg-amber-500/10 text-amber-100'
}

export default function BackupHealthPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await apiClient.getBackupHealth()
      setItems(Array.isArray(data.items) ? data.items : [])
      setError('')
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load backup health')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Activity className="w-9 h-9 text-accent shrink-0" />
          <div>
            <h1 className="text-3xl font-bold text-white">Backup health</h1>
            <p className="text-gray-400 text-sm mt-1">Last backup, schedule coverage, and recent failures per database connection.</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="px-3 py-2 border border-gray-600 rounded text-white text-sm inline-flex items-center gap-2 hover:bg-secondary disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {error && <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{error}</div>}
      {loading ? (
        <div className="text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-gray-700 bg-secondary p-8 text-center text-gray-500 text-sm">No database connections yet.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {items.map((row) => (
            <div key={row.connection.id} className="rounded-lg border border-gray-700 bg-secondary p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Database className="w-5 h-5 text-accent shrink-0" />
                  <div className="min-w-0">
                    <h2 className="text-white font-semibold truncate">{row.connection.name}</h2>
                    <p className="text-xs text-gray-500 truncate">{row.connection.host}:{row.connection.port}</p>
                  </div>
                </div>
                <span className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded border ${statusClass(row.status)}`}>{row.status}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Last backup</p>
                  <p className="text-gray-200">{row.last_backup?.completed_at ? new Date(row.last_backup.completed_at).toLocaleString() : 'Never'}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Last status</p>
                  <p className="text-gray-200">{row.last_backup?.status || '-'}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Schedules</p>
                  <p className="text-gray-200">{row.enabled_schedule_count} enabled / {row.schedule_count} total</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Recent failures</p>
                  <p className="text-gray-200">{row.recent_failed_count}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Recent success size</p>
                  <p className="text-gray-200">{formatBytes(row.total_success_size_bytes)}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Schedule last run</p>
                  <p className="text-gray-200">{row.last_schedule_run_at ? new Date(row.last_schedule_run_at).toLocaleString() : '-'}</p>
                </div>
              </div>
              {(row.last_backup?.error_message || row.last_schedule_error) && (
                <div className="mt-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200 break-words">
                  {row.last_backup?.error_message || row.last_schedule_error}
                </div>
              )}
              <Link href="/databases" className="mt-4 inline-block text-sm text-accent hover:underline">Open backups</Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
