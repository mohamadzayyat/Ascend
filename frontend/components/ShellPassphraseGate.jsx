import { useState } from 'react'
import { Lock, KeyRound } from 'lucide-react'
import { apiClient } from '@/lib/api'

/**
 * Renders either the unlock form (passphrase exists) or the first-time setup
 * form (admin must create one) for the shell/server-files gate.
 *
 * Props:
 *   needsSetup     — true when the install has no passphrase yet
 *   canSetup       — true when the current user is an admin
 *   onUnlock       — async (passphrase) => void   throws on failure
 *   onUnlocked     — () => void                   called after setup auto-unlocks
 *   title          — heading (e.g. "Unlock terminal")
 *   description    — subheading shown beneath the heading
 *   setupTitle     — heading for the setup variant
 *   setupDescription — subheading for the setup variant
 */
export default function ShellPassphraseGate({
  needsSetup,
  canSetup,
  onUnlock,
  onUnlocked,
  title,
  description,
  setupTitle = 'Set shell passphrase',
  setupDescription = 'No shell passphrase is configured yet for this install. Choose one to gate the web terminal and server files.',
}) {
  const [passphrase, setPassphrase] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (needsSetup && !canSetup) {
    return (
      <div className="max-w-md w-full rounded border border-yellow-500/30 bg-yellow-500/10 p-4 text-yellow-200 text-sm">
        No shell passphrase has been set yet. Ask an admin to set one from the
        terminal or server files page on first use.
      </div>
    )
  }

  if (needsSetup) {
    const onSetup = async (e) => {
      e.preventDefault()
      if (busy) return
      setError('')
      if (passphrase.length < 8) {
        setError('Passphrase must be at least 8 characters.')
        return
      }
      if (passphrase !== confirmPass) {
        setError('Passphrases do not match.')
        return
      }
      setBusy(true)
      try {
        await apiClient.setShellPassphrase(passphrase)
        setPassphrase('')
        setConfirmPass('')
        onUnlocked?.()
      } catch (err) {
        setError(err.response?.data?.error || 'Could not set passphrase.')
      } finally {
        setBusy(false)
      }
    }

    return (
      <form
        onSubmit={onSetup}
        className="max-w-md w-full rounded border border-gray-700 bg-secondary p-6 space-y-4"
      >
        <div>
          <h2 className="text-white font-semibold mb-1 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-accent" /> {setupTitle}
          </h2>
          <p className="text-gray-400 text-sm">{setupDescription}</p>
        </div>
        <input
          autoFocus
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="New passphrase (min 8 chars)"
          className="w-full px-3 py-2 bg-primary border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-accent"
        />
        <input
          type="password"
          value={confirmPass}
          onChange={(e) => setConfirmPass(e.target.value)}
          placeholder="Confirm passphrase"
          className="w-full px-3 py-2 bg-primary border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-accent"
        />
        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300 text-sm">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !passphrase || !confirmPass}
          className="w-full px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Saving...' : 'Set passphrase and unlock'}
        </button>
      </form>
    )
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await onUnlock(passphrase)
      setPassphrase('')
    } catch (err) {
      setError(err.response?.data?.error || 'Unlock failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="max-w-md w-full rounded border border-gray-700 bg-secondary p-6 space-y-4"
    >
      <div>
        <h2 className="text-white font-semibold mb-1 flex items-center gap-2">
          <Lock className="w-4 h-4 text-accent" /> {title}
        </h2>
        <p className="text-gray-400 text-sm">{description}</p>
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
        disabled={busy || !passphrase}
        className="w-full px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold disabled:opacity-50"
      >
        {busy ? 'Unlocking...' : 'Unlock'}
      </button>
    </form>
  )
}
