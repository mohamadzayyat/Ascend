import Link from 'next/link'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowLeft, Copy, Loader2, ShieldCheck } from 'lucide-react'
import { apiClient } from '@/lib/api'
import { useAuth } from '@/lib/hooks/useAuth'

export default function SecuritySettingsPage() {
  const { user, setUser } = useAuth()
  const [settings, setSettings] = useState(null)
  const [setup, setSetup] = useState(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = async () => {
    const { data } = await apiClient.getSecuritySettings()
    setSettings(data)
  }

  useEffect(() => { load().catch(() => setMessage('Failed to load security settings')) }, [])

  const startSetup = async () => {
    setBusy(true); setMessage('')
    try {
      const { data } = await apiClient.setupTwoFactor()
      setSetup(data)
      setQrDataUrl(await QRCode.toDataURL(data.otpauth_uri, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 220,
        color: { dark: '#0f172a', light: '#ffffff' },
      }))
      setCode('')
      setMessage('Scan the QR code with your authenticator, then enter the 6-digit code.')
    } catch (e) {
      setMessage(e.response?.data?.error || 'Failed to start 2FA setup')
    } finally {
      setBusy(false)
    }
  }

  const enable = async () => {
    setBusy(true); setMessage('')
    try {
      await apiClient.enableTwoFactor(code)
      await load()
      setUser({ ...user, two_factor_enabled: true })
      setSetup(null); setQrDataUrl(''); setCode('')
      setMessage('Two-factor authentication enabled.')
    } catch (e) {
      setMessage(e.response?.data?.error || 'Failed to enable 2FA')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    if (!window.confirm('Disable two-factor authentication?')) return
    setBusy(true); setMessage('')
    try {
      await apiClient.disableTwoFactor(password, code)
      await load()
      setUser({ ...user, two_factor_enabled: false })
      setPassword(''); setCode('')
      setMessage('Two-factor authentication disabled.')
    } catch (e) {
      setMessage(e.response?.data?.error || 'Failed to disable 2FA')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <Link href="/settings" className="text-gray-400 hover:text-white text-sm inline-flex items-center gap-1 mb-6">
        <ArrowLeft className="w-4 h-4" /> Settings
      </Link>
      <div className="mb-8 flex items-start gap-3">
        <ShieldCheck className="w-10 h-10 text-accent shrink-0" />
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Security</h1>
          <p className="text-gray-400 text-sm">Protect admin login with a time-based authenticator code.</p>
        </div>
      </div>

      {!settings ? (
        <div className="text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
      ) : (
        <div className="rounded-lg border border-gray-700 bg-secondary p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-white font-semibold">Two-factor authentication</h2>
              <p className="text-sm text-gray-400 mt-1">{settings.two_factor_enabled ? 'Enabled for this account.' : 'Not enabled yet.'}</p>
            </div>
            <span className={`text-xs px-2 py-1 rounded border ${settings.two_factor_enabled ? 'border-green-500/40 bg-green-500/10 text-green-200' : 'border-amber-500/40 bg-amber-500/10 text-amber-100'}`}>
              {settings.two_factor_enabled ? 'Enabled' : 'Off'}
            </span>
          </div>

          {message && <div className="rounded border border-gray-600 bg-primary px-3 py-2 text-sm text-gray-200">{message}</div>}

          {!settings.two_factor_enabled && !setup && (
            <button type="button" onClick={startSetup} disabled={busy} className="px-4 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold disabled:opacity-50">
              Start 2FA setup
            </button>
          )}

          {!settings.two_factor_enabled && setup && (
            <div className="space-y-4">
              {qrDataUrl && (
                <div className="flex flex-col sm:flex-row gap-4 rounded border border-gray-700 bg-primary p-4">
                  <div className="rounded bg-white p-3 w-fit">
                    <img src={qrDataUrl} alt="Authenticator QR code" className="w-[220px] h-[220px]" />
                  </div>
                  <div className="text-sm text-gray-300 leading-relaxed max-w-sm">
                    Scan this QR code in Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden, Authy, or any TOTP app. Then type the 6-digit code below to activate 2FA.
                  </div>
                </div>
              )}
              <div>
                <label className="text-sm text-gray-300">Authenticator setup URI</label>
                <div className="mt-1 flex gap-2">
                  <input readOnly value={setup.otpauth_uri} className="flex-1 bg-primary border border-gray-700 rounded px-3 py-2 text-white text-sm font-mono" />
                  <button type="button" onClick={() => navigator.clipboard?.writeText(setup.otpauth_uri)} className="px-3 py-2 border border-gray-600 rounded text-white">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="rounded border border-blue-500/25 bg-blue-500/10 p-3 text-xs text-blue-100/90">
                If your authenticator cannot open the URI, add account <span className="font-mono">Ascend:{settings.username}</span> manually with secret <span className="font-mono">{setup.secret}</span>.
              </div>
              <label className="block text-sm text-gray-300">
                6-digit code
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className="mt-1 w-40 bg-primary border border-gray-700 rounded px-3 py-2 text-white" />
              </label>
              <button type="button" onClick={enable} disabled={busy || code.length !== 6} className="px-4 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold disabled:opacity-50">
                Enable 2FA
              </button>
            </div>
          )}

          {settings.two_factor_enabled && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-sm text-gray-300">
                  Current password
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full bg-primary border border-gray-700 rounded px-3 py-2 text-white" />
                </label>
                <label className="text-sm text-gray-300">
                  Authenticator code
                  <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className="mt-1 w-full bg-primary border border-gray-700 rounded px-3 py-2 text-white" />
                </label>
              </div>
              <button type="button" onClick={disable} disabled={busy || !password || code.length !== 6} className="px-4 py-2 border border-red-500/40 rounded text-red-200 text-sm font-semibold hover:bg-red-500/10 disabled:opacity-50">
                Disable 2FA
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
