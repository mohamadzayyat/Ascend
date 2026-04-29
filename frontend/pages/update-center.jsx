import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, DownloadCloud, Loader2, RefreshCw } from 'lucide-react'
import { apiClient } from '@/lib/api'
import { useDialog } from '@/lib/dialog'

function shortSha(s) {
  return s ? String(s).slice(0, 12) : '-'
}

export default function UpdateCenterPage() {
  const [status, setStatus] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [message, setMessage] = useState('')
  const dialog = useDialog()

  const load = async () => {
    setLoading(true)
    try {
      const [statusRes, alertsRes] = await Promise.all([
        apiClient.getUpdateStatus(),
        apiClient.getSystemAlerts(),
      ])
      setStatus(statusRes.data)
      setAlerts(alertsRes.data.alerts || [])
    } catch (e) {
      setMessage(e.response?.data?.error || 'Failed to load update status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!status?.running) return undefined
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [status?.running])

  const stateText = useMemo(() => {
    if (!status) return 'Unknown'
    if (status.running) return 'Update running'
    return status.update_available ? 'Update available' : 'Up to date'
  }, [status])

  const start = async () => {
    const ok = await dialog.confirm({
      title: 'Start Ascend update?',
      message: 'The update runs detached, but the panel may briefly disconnect while services restart.',
      confirmLabel: 'Start update',
      tone: 'warning',
    })
    if (!ok) return
    setStarting(true)
    setMessage('')
    try {
      await apiClient.startUpdate()
      setMessage('Update started in a detached system session. This page will refresh the log while the panel is available.')
      await load()
    } catch (e) {
      setMessage(e.response?.data?.error || 'Failed to start update')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <DownloadCloud className="w-9 h-9 text-accent shrink-0" />
          <div>
            <h1 className="text-3xl font-bold text-white">Update Center</h1>
            <p className="text-gray-400 text-sm mt-1">Check version, review alerts, and run the one-line updater from a detached session.</p>
          </div>
        </div>
        <button onClick={load} disabled={loading || starting} className="px-3 py-2 border border-gray-600 rounded text-white text-sm inline-flex items-center gap-2 hover:bg-secondary disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {message && <div className="mb-4 rounded border border-gray-600 bg-secondary px-3 py-2 text-sm text-gray-200">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="rounded-lg border border-gray-700 bg-secondary p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-3 mb-5">
            <div>
              <h2 className="text-white font-semibold">Version</h2>
              <p className="text-xs text-gray-500 mt-1">Branch: {status?.branch || '-'}</p>
            </div>
            <span className={`text-xs px-2 py-1 rounded border ${status?.running ? 'border-blue-500/40 bg-blue-500/10 text-blue-200' : status?.update_available ? 'border-amber-500/40 bg-amber-500/10 text-amber-100' : 'border-green-500/40 bg-green-500/10 text-green-200'}`}>
              {stateText}
            </span>
          </div>
          {loading && !status ? (
            <div className="text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="rounded border border-gray-700 bg-primary p-3">
                <p className="text-gray-500 text-xs mb-1">Current</p>
                <p className="text-white font-mono">{shortSha(status?.current_commit)}</p>
                <p className="text-gray-400 mt-2 break-words">{status?.current_subject || '-'}</p>
              </div>
              <div className="rounded border border-gray-700 bg-primary p-3">
                <p className="text-gray-500 text-xs mb-1">Latest on origin</p>
                <p className="text-white font-mono">{shortSha(status?.remote?.commit)}</p>
                <p className="text-gray-400 mt-2 break-words">{status?.remote?.subject || '-'}</p>
                {status?.remote?.fetch_error && <p className="text-red-300 text-xs mt-2 break-words">{status.remote.fetch_error}</p>}
              </div>
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <button onClick={start} disabled={starting || status?.running} className="px-4 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
              {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
              {status?.running ? 'Update running' : 'Run update'}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gray-700 bg-secondary p-5">
          <h2 className="text-white font-semibold mb-3">System alerts</h2>
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-200"><CheckCircle2 className="w-4 h-4" /> No active alerts</div>
          ) : (
            <div className="space-y-3">
              {alerts.map((a, idx) => (
                <div key={`${a.title}-${idx}`} className={`rounded border p-3 text-sm ${a.severity === 'critical' ? 'border-red-500/40 bg-red-500/10 text-red-100' : 'border-amber-500/40 bg-amber-500/10 text-amber-100'}`}>
                  <div className="font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {a.title}</div>
                  <div className="text-xs mt-1 opacity-90">{a.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-white font-semibold">Latest update log</h2>
          {status?.state?.launcher && <span className="text-xs text-gray-500">Launcher: {status.state.launcher}</span>}
        </div>
        <pre className="min-h-[260px] max-h-[520px] overflow-auto bg-primary p-4 text-xs text-gray-300 whitespace-pre-wrap">
          {status?.log_tail || 'No update log yet.'}
        </pre>
      </div>
    </div>
  )
}
