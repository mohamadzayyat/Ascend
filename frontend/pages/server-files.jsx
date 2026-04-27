import { useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import { FolderTree, Lock, Loader2 } from 'lucide-react'
import AppFileManager from '@/components/AppFileManager'
import ShellPassphraseGate from '@/components/ShellPassphraseGate'
import { apiClient, serverFileApi } from '@/lib/api'

export default function ServerFilesPage() {
  const [state, setState] = useState('loading')
  const [root, setRoot] = useState('')
  const [needsSetup, setNeedsSetup] = useState(false)
  const [canSetup, setCanSetup] = useState(false)
  const fileApi = useMemo(() => serverFileApi(), [])

  const refreshStatus = async () => {
    try {
      const res = await apiClient.getServerFilesStatus()
      setRoot(res.data.root || '')
      setNeedsSetup(!!res.data.needs_setup)
      setCanSetup(!!res.data.can_setup)
      setState(res.data.unlocked ? 'unlocked' : 'locked')
    } catch {
      setState('locked')
    }
  }

  useEffect(() => {
    let cancelled = false
    apiClient.getServerFilesStatus()
      .then((res) => {
        if (cancelled) return
        setRoot(res.data.root || '')
        setNeedsSetup(!!res.data.needs_setup)
        setCanSetup(!!res.data.can_setup)
        setState(res.data.unlocked ? 'unlocked' : 'locked')
      })
      .catch(() => {
        if (!cancelled) setState('locked')
      })
    return () => { cancelled = true }
  }, [])

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
          <ShellPassphraseGate
            needsSetup={needsSetup}
            canSetup={canSetup}
            title="Unlock server files"
            description="Enter the shell passphrase to browse and edit files outside Ascend projects."
            setupDescription="No shell passphrase is set yet for this install. Choose one to unlock the server files browser — it also gates the web terminal."
            onUnlock={async (pass) => {
              const res = await apiClient.unlockServerFiles(pass)
              setRoot(res.data.root || root)
              setState('unlocked')
            }}
            onUnlocked={async () => {
              await refreshStatus()
              setState('unlocked')
            }}
          />
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
