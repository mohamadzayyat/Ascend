import { useState, useEffect, useRef } from 'react'
import { useDeployment, useProjectDeployments } from '@/lib/hooks/useAuth'
import { formatDistanceToNow } from 'date-fns'

function statusClass(status) {
  if (status === 'success') return 'bg-green-500/20 text-green-400'
  if (status === 'running' || status === 'pending') return 'bg-yellow-500/20 text-yellow-400'
  return 'bg-red-500/20 text-red-400'
}

function LogViewer({ deploymentId, onClose }) {
  const [log, setLog] = useState('')
  const logEndRef = useRef(null)
  // Always call hook unconditionally — passes null when no id is selected
  const { deployment, getLog } = useDeployment(deploymentId)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  useEffect(() => {
    if (!deploymentId) return

    let cancelled = false

    const fetchLog = async () => {
      try {
        const data = await getLog()
        if (!cancelled) setLog(data.log || '')
      } catch (_) {}
    }

    fetchLog()
    const interval = setInterval(fetchLog, 1500)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [deploymentId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusClass(deployment?.status)}`}>
            {deployment?.status || 'loading'}
          </span>
          {deployment?.duration_seconds != null && (
            <span className="text-gray-400 text-sm">
              {Math.floor(deployment.duration_seconds / 60)}m {deployment.duration_seconds % 60}s
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm transition">
          ✕ Close
        </button>
      </div>

      <div className="bg-black/40 rounded-lg border border-gray-700 p-4 font-mono text-xs text-gray-300 max-h-96 overflow-auto">
        <pre className="whitespace-pre-wrap break-all">{log || 'Waiting for logs…'}</pre>
        <div ref={logEndRef} />
      </div>
    </div>
  )
}

export default function DeploymentLogs({ projectId }) {
  const { deployments, isLoading, mutate } = useProjectDeployments(projectId)
  const [selectedId, setSelectedId] = useState(null)

  // Auto-select the most recent running/pending deployment
  useEffect(() => {
    if (!deployments.length) return
    const active = deployments.find((d) => d.status === 'running' || d.status === 'pending')
    if (active && !selectedId) setSelectedId(active.id)
  }, [deployments, selectedId])

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full spinner mx-auto mb-4" />
        <p className="text-gray-400">Loading deployments…</p>
      </div>
    )
  }

  if (!deployments.length) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">No deployments yet. Click "Start Deployment" to begin.</p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-4">Deployment History</h2>

      <div className="bg-secondary rounded-lg border border-gray-700 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700 bg-primary/50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">#</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Branch</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Triggered</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Started</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Duration</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {deployments.map((d) => (
              <tr
                key={d.id}
                className={`border-b border-gray-700 transition ${selectedId === d.id ? 'bg-accent/10' : 'hover:bg-primary/50'}`}
              >
                <td className="px-4 py-3 text-gray-400 text-sm font-mono">#{d.id}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${statusClass(d.status)}`}>
                    {d.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-300 text-sm font-mono">{d.branch || '—'}</td>
                <td className="px-4 py-3 text-gray-400 text-sm capitalize">{d.triggered_by || '—'}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">
                  {formatDistanceToNow(new Date(d.started_at), { addSuffix: true })}
                </td>
                <td className="px-4 py-3 text-gray-400 text-sm">
                  {d.duration_seconds != null
                    ? `${Math.floor(d.duration_seconds / 60)}m ${d.duration_seconds % 60}s`
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setSelectedId(selectedId === d.id ? null : d.id)}
                    className="text-accent hover:text-blue-400 text-xs font-semibold transition"
                  >
                    {selectedId === d.id ? 'Hide logs' : 'View logs'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedId && (
        <LogViewer
          key={selectedId}
          deploymentId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}
