import { useState } from 'react'
import { HardDrive, RefreshCw } from 'lucide-react'
import { relativeLocalTime } from '@/lib/time'

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function DiskUsage({
  bytes,
  computedAt,
  missing = 0,
  onRecalculate,
  label = 'Disk usage',
  compact = false,
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const recalc = async () => {
    if (!onRecalculate) return
    setLoading(true)
    setError('')
    try {
      await onRecalculate()
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to recalculate')
    } finally {
      setLoading(false)
    }
  }

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400">
        <HardDrive className="w-3 h-3" />
        {bytes === null || bytes === undefined ? 'size not measured' : formatBytes(bytes)}
      </span>
    )
  }

  return (
    <div className="inline-flex items-center gap-2 bg-primary/60 border border-gray-700 rounded-lg px-3 py-2">
      <HardDrive className="w-4 h-4 text-gray-400" />
      <div className="flex flex-col">
        <span className="text-sm text-white font-semibold">
          {label}: {formatBytes(bytes)}
          {missing > 0 && (
            <span className="text-yellow-400 text-xs font-normal ml-2">
              ({missing} app{missing === 1 ? '' : 's'} not measured)
            </span>
          )}
        </span>
        <span className="text-xs text-gray-500">
          {computedAt ? `Measured ${relativeLocalTime(computedAt)}` : 'Never measured'}
          {error && <span className="text-red-400 ml-2">· {error}</span>}
        </span>
      </div>
      {onRecalculate && (
        <button
          type="button"
          onClick={recalc}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2 py-1 ml-1 bg-secondary hover:bg-gray-700 rounded text-white text-xs disabled:opacity-50"
          title="Walk the directory and update the cached size"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Calculating…' : 'Recalculate'}
        </button>
      )}
    </div>
  )
}
