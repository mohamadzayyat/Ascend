import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Archive, ArrowLeft, Download, Loader2, RotateCcw, Upload } from 'lucide-react'
import { apiClient } from '@/lib/api'
import { typedConfirm } from '@/lib/confirm'

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = Number(bytes)
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  return `${value.toFixed(idx ? 1 : 0)} ${units[idx]}`
}

function formatTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

export default function AscendBackupSettings() {
  const fileRef = useRef(null)
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [restoring, setRestoring] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiClient.listAscendBackups()
      setBackups(res.data.backups || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load Ascend backups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const createBackup = async () => {
    setCreating(true)
    setMessage('')
    setError('')
    try {
      const res = await apiClient.createAscendBackup()
      const parts = [`Created ${res.data.backup.filename}`]
      if (res.data.uploaded_to) parts.push(`uploaded to ${res.data.uploaded_to}`)
      if (res.data.upload_error) parts.push(`remote upload failed: ${res.data.upload_error}`)
      setMessage(parts.join('; '))
      await load()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create backup')
    } finally {
      setCreating(false)
    }
  }

  const uploadBackup = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setMessage('')
    setError('')
    try {
      const res = await apiClient.uploadAscendBackup(file)
      setMessage(`Uploaded ${res.data.backup.filename}`)
      await load()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload backup')
    } finally {
      setUploading(false)
    }
  }

  const restore = async (backup) => {
    if (!typedConfirm(`Restore Ascend from "${backup.filename}"? A safety backup will be created first, then the panel services will restart.`, backup.filename)) return
    setRestoring(backup.filename)
    setMessage('')
    setError('')
    try {
      const res = await apiClient.restoreAscendBackup(backup.filename, backup.filename)
      setMessage(`Restore started. Safety backup: ${res.data.safety_backup}. The panel may reconnect after services restart.`)
      await load()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to restore backup')
    } finally {
      setRestoring('')
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      <Link href="/settings" className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-6 text-sm">
        <ArrowLeft className="w-4 h-4" /> Settings
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Archive className="w-10 h-10 text-accent shrink-0" />
          <div>
            <h1 className="text-3xl font-bold text-white mb-1">Ascend Backup</h1>
            <p className="text-gray-400 text-sm">
              Backup and restore Ascend's database, environment files, and Ascend Nginx config.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={createBackup}
            disabled={creating || uploading || restoring}
            className="px-4 py-2 bg-accent hover:bg-blue-600 rounded text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
            {creating ? 'Creating...' : 'Create backup'}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={creating || uploading || restoring}
            className="px-4 py-2 border border-gray-600 hover:bg-secondary rounded text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading...' : 'Upload backup'}
          </button>
          <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={uploadBackup} />
        </div>
      </div>

      {message && <div className="mb-4 rounded border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">{message}</div>}
      {error && <div className="mb-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}

      <div className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-white font-semibold">Backups</h2>
          <button type="button" onClick={load} disabled={loading} className="text-sm text-gray-300 hover:text-white disabled:opacity-50">
            Refresh
          </button>
        </div>
        {loading ? (
          <div className="p-6 text-gray-400 inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading backups...
          </div>
        ) : backups.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No Ascend backups yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-primary text-gray-400">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">File</th>
                  <th className="text-left px-4 py-3 font-medium">Created</th>
                  <th className="text-left px-4 py-3 font-medium">Size</th>
                  <th className="text-left px-4 py-3 font-medium">Reason</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {backups.map((backup) => (
                  <tr key={backup.filename}>
                    <td className="px-4 py-3 text-white font-mono text-xs">{backup.filename}</td>
                    <td className="px-4 py-3 text-gray-300">{formatTime(backup.manifest?.created_at || backup.created_at)}</td>
                    <td className="px-4 py-3 text-gray-300">{formatSize(backup.size_bytes)}</td>
                    <td className="px-4 py-3 text-gray-400">{backup.manifest?.reason || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <a
                          href={apiClient.downloadAscendBackupUrl(backup.filename)}
                          className="px-3 py-1.5 border border-gray-600 rounded text-gray-200 hover:text-white hover:border-gray-500 inline-flex items-center gap-1"
                        >
                          <Download className="w-4 h-4" /> Download
                        </a>
                        <button
                          type="button"
                          onClick={() => restore(backup)}
                          disabled={Boolean(restoring)}
                          className="px-3 py-1.5 border border-red-500/50 bg-red-500/10 rounded text-red-200 hover:text-white disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {restoring === backup.filename ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                          Restore
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-gray-500">
        Restore always creates a safety backup first. Project deployment folders and database dump archives are not included by default.
      </p>
    </div>
  )
}
