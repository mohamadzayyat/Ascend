import { useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import { FolderTree, Lock, Loader2 } from 'lucide-react'
import AppFileManager from '@/components/AppFileManager'
import { apiClient, serverFileApi } from '@/lib/api'

export default function ServerFilesPage() {
  const [state, setState] = useState('loading')
  const [root, setRoot] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const fileApi = useMemo(() => serverFileApi(), [])

  useEffect(() => {
    let cancelled = false
    apiClient.getServerFilesStatus()
      .then((res) => {
        if (cancelled) return
        setRoot(res.data.root || '')
        setState(res.data.unlocked ? 'unlocked' : 'locked')
      })
      .catch(() => {
        if (!cancelled) setState('locked')
      })
    return () => { cancelled = true }
  }, [])

  const onUnlock = async (e) => {
    e.preventDefault()
    if (unlocking) return
    setError('')
    setUnlocking(true)
    try {
      const res = await apiClient.unlockServerFiles(passphrase)
      setRoot(res.data.root || root)
      setPassphrase('')
      setState('unlocked')
    } catch (err) {
      setError(err.response?.data?.error || 'Unlock failed')
    } finally {
      setUnlocking(false)
    }
  }

  const onLock = async () => {
    try { await apiClient.lockServerFiles() } catch { /* ignore */ }
    setState('locked')
  }

  return (
    <>
      <Head><title>Server Files - Ascend</title></Head>
      <div className="p-8 max-w-7xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <FolderTree className="w-8 h-8 text-accent" /> Server Files
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Browse and manage files from the server root, independently from project and app file managers.
            </p>
          </div>
          {state === 'unlocked' && (
            <button
              type="button"
              onClick={onLock}
              className="inline-flex items-center gap-2 px-3 py-2 bg-secondary hover:bg-gray-700 border border-gray-700 rounded text-white text-sm"
              title="Lock server file access in this session"
            >
              <Lock className="w-4 h-4" /> Lock
            </button>
          )}
        </div>

        {state === 'loading' && (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking server file access...
          </div>
        )}

        {state === 'locked' && (
          <form
            onSubmit={onUnlock}
            className="max-w-md w-full rounded border border-gray-700 bg-secondary p-6 space-y-4"
          >
            <div>
              <h2 className="text-white font-semibold mb-1">Unlock server files</h2>
              <p className="text-gray-400 text-sm">
                Enter the server file passphrase to browse and edit files outside Ascend projects.
              </p>
            </div>
            <input
              autoFocus
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Passphrase"
              className="w-full px-3 py-2 bg-primary border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-accent"
            />
            {error && (
              <div className="rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300 text-sm">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={unlocking || !passphrase}
              className="w-full px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold disabled:opacity-50"
            >
              {unlocking ? 'Unlocking...' : 'Unlock'}
            </button>
          </form>
        )}

        {state === 'unlocked' && (
          <AppFileManager
            api={fileApi}
            scopeKey="server"
            title="Server Files"
            description={`Browse, edit, upload, search, archive, and move files under ${root || 'the configured server root'}.`}
            rootLabel={root || 'server root'}
            hiddenLabel="Show node_modules / .git"
            missingText="The configured server file root does not exist."
          />
        )}
      </div>
    </>
  )
}
