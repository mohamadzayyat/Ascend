import { useEffect, useState } from 'react'
import { FileText, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { apiClient } from '@/lib/api'

export default function AuditPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await apiClient.getAuditLog(250)
      setItems(Array.isArray(data.items) ? data.items : [])
      setError('')
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const clear = async () => {
    if (!window.confirm('Clear the audit log?')) return
    setClearing(true)
    try {
      await apiClient.clearAuditLog()
      setItems([])
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to clear audit log')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <FileText className="w-9 h-9 text-accent shrink-0" />
          <div>
            <h1 className="text-3xl font-bold text-white">Audit log</h1>
            <p className="text-gray-400 text-sm mt-1">Recent security and admin activity.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading || clearing} className="px-3 py-2 border border-gray-600 rounded text-white text-sm inline-flex items-center gap-2 hover:bg-secondary disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={clear} disabled={clearing || items.length === 0} className="px-3 py-2 border border-red-500/40 rounded text-red-200 text-sm inline-flex items-center gap-2 hover:bg-red-500/10 disabled:opacity-50">
            {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Clear
          </button>
        </div>
      </div>
      {error && <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{error}</div>}
      <div className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
        {loading ? (
          <div className="p-8 text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No audit events yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[840px]">
              <thead className="bg-primary/60 text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="px-4 py-3 font-medium">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/70">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{item.at ? new Date(item.at).toLocaleString() : '-'}</td>
                    <td className="px-4 py-3 text-gray-200 font-mono text-xs">{item.event}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded border ${item.status === 'ok' ? 'border-green-500/40 bg-green-500/10 text-green-200' : item.status === 'blocked' ? 'border-amber-500/40 bg-amber-500/10 text-amber-100' : 'border-red-500/40 bg-red-500/10 text-red-200'}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{item.username || '-'}</td>
                    <td className="px-4 py-3 text-gray-400">{item.ip || '-'}</td>
                    <td className="px-4 py-3 text-gray-300 max-w-md break-words">{item.message || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
