import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Loader2, Mail, RefreshCw, Send, Settings, Trash2 } from 'lucide-react'
import { apiClient } from '@/lib/api'
import { useAuth } from '@/lib/hooks/useAuth'

const EVENT_OPTIONS = [
  { key: 'backup_success', label: 'Database backup succeeded' },
  { key: 'backup_failed', label: 'Database backup failed' },
  { key: 'panel_login', label: 'Panel login (web UI)' },
  { key: 'project_created', label: 'Project created' },
  { key: 'project_deleted', label: 'Project deleted' },
  { key: 'app_deleted', label: 'App deleted' },
  { key: 'deployment_success', label: 'Deployment / restart / SSL job succeeded' },
  { key: 'deployment_failed', label: 'Deployment / restart / SSL job failed' },
  { key: 'terminal_unlock', label: 'Web terminal unlocked (shell passphrase)' },
  { key: 'server_files_unlock', label: 'Server file manager unlocked' },
]

const emptyForm = {
  enabled: false,
  host: '',
  port: 587,
  use_tls: false,
  use_starttls: true,
  username: '',
  from_name: 'Ascend',
  from_addr: '',
  notify_to: '',
  smtp_password: '',
  has_password: false,
  smtp_password_error: '',
  delivery_status: {},
  events: {},
}

/** Port 465 is implicit TLS only; STARTTLS is for plain SMTP (usually 587). */
function normalizeSmtpTlsForPort(form) {
  const port = Number(form.port)
  if (port !== 465) return form
  return { ...form, use_tls: true, use_starttls: false }
}

export default function EmailSettingsPage() {
  const { user, loading: authLoading } = useAuth()
  const [activeTab, setActiveTab] = useState('settings')
  const [form, setForm] = useState(emptyForm)
  const [emailLog, setEmailLog] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [logLoading, setLogLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [clearingLog, setClearingLog] = useState(false)
  const [message, setMessage] = useState('')
  const [testTo, setTestTo] = useState('')

  const mergeEvents = useCallback((ev) => {
    const o = {}
    EVENT_OPTIONS.forEach(({ key }) => {
      o[key] = !!(ev && ev[key])
    })
    return o
  }, [])

  const loadLog = useCallback(async () => {
    setLogLoading(true)
    try {
      const { data } = await apiClient.getEmailNotificationLog(200)
      setEmailLog(Array.isArray(data.items) ? data.items : [])
    } catch (_) {
      setEmailLog([])
    } finally {
      setLogLoading(false)
    }
  }, [])

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const [{ data }] = await Promise.all([
        apiClient.getEmailNotifications(),
        loadLog(),
      ])
      setForm(
        normalizeSmtpTlsForPort({
          ...emptyForm,
          ...data,
          smtp_password: '',
          events: mergeEvents(data.events),
        }),
      )
    } catch (e) {
      setLoadError(e.response?.data?.error || 'Failed to load settings')
    } finally {
      setLoaded(true)
    }
  }, [loadLog, mergeEvents])

  useEffect(() => {
    if (!authLoading && user?.is_admin) load()
    if (!authLoading && !user?.is_admin) setLoaded(true)
  }, [authLoading, user, load])

  const setEv = (key, val) => {
    setForm((f) => ({ ...f, events: { ...f.events, [key]: val } }))
  }

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const payload = {
        enabled: !!form.enabled,
        host: form.host,
        port: Number(form.port) || 587,
        use_tls: !!form.use_tls,
        use_starttls: !!form.use_starttls,
        username: form.username,
        from_name: form.from_name,
        from_addr: form.from_addr,
        notify_to: form.notify_to,
        events: { ...form.events },
        clear_smtp_password: false,
      }
      if (form.smtp_password.trim()) {
        payload.smtp_password = form.smtp_password.trim()
      }
      const { data } = await apiClient.updateEmailNotifications(payload)
      setForm((f) =>
        normalizeSmtpTlsForPort({
          ...f,
          ...data,
          smtp_password: '',
          events: mergeEvents(data.events),
        }),
      )
      setMessage('Saved.')
    } catch (e) {
      setMessage(e.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const clearPassword = async () => {
    if (!window.confirm('Remove stored SMTP password?')) return
    setSaving(true)
    setMessage('')
    try {
      const { data } = await apiClient.updateEmailNotifications({
        enabled: form.enabled,
        host: form.host,
        port: Number(form.port) || 587,
        use_tls: form.use_tls,
        use_starttls: form.use_starttls,
        username: form.username,
        from_name: form.from_name,
        from_addr: form.from_addr,
        notify_to: form.notify_to,
        events: form.events,
        clear_smtp_password: true,
      })
      setForm((f) =>
        normalizeSmtpTlsForPort({
          ...f,
          ...data,
          smtp_password: '',
          events: mergeEvents(data.events),
        }),
      )
      setMessage('Password cleared.')
    } catch (e) {
      setMessage(e.response?.data?.error || 'Request failed')
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async () => {
    setTesting(true)
    setMessage('')
    try {
      const body = {}
      if (testTo.trim()) body.to = testTo.trim()
      const { data } = await apiClient.testEmailNotifications(body)
      setMessage(`Test sent to ${(data.sent_to || []).join(', ')}`)
    } catch (e) {
      setMessage(e.response?.data?.error || 'Test send failed')
    } finally {
      await load()
      setTesting(false)
    }
  }

  const eventLabel = (key) => (key === 'test' ? 'Test email' : EVENT_OPTIONS.find((ev) => ev.key === key)?.label || key)
  const clearLog = async () => {
    if (!window.confirm('Clear the email delivery log?')) return
    setClearingLog(true)
    setMessage('')
    try {
      await apiClient.clearEmailNotificationLog()
      setEmailLog([])
      setMessage('Email log cleared.')
    } catch (e) {
      setMessage(e.response?.data?.error || 'Failed to clear email log')
    } finally {
      setClearingLog(false)
    }
  }

  const deliveryEntries = Object.entries(form.delivery_status || {})
    .sort((a, b) => String(b[1]?.at || '').localeCompare(String(a[1]?.at || '')))
    .slice(0, 6)

  if (!authLoading && user && !user.is_admin) {
    return (
      <div className="p-8 max-w-3xl">
        <p className="text-gray-400">Email notifications are limited to admin accounts.</p>
        <Link href="/settings" className="text-accent hover:underline mt-4 inline-block">← Settings</Link>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl">
      <Link href="/settings" className="text-gray-400 hover:text-white text-sm inline-flex items-center gap-1 mb-6">
        <ArrowLeft className="w-4 h-4" /> Settings
      </Link>

      <div className="mb-8 flex items-start gap-3">
        <Mail className="w-10 h-10 text-accent shrink-0" />
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Email &amp; alerts</h1>
          <p className="text-gray-400 text-sm">
            SMTP is used only for outbound alerts (backups, logins, projects, deployments, privileged unlocks).
            Save settings before sending a test message.
          </p>
          <p className="text-amber-200/80 text-xs mt-2 leading-relaxed max-w-2xl">
            <strong className="text-amber-100">Timeouts</strong> usually mean the Ascend server cannot reach your SMTP host
            (wrong name — e.g. <span className="font-mono">mail.enmail.co</span> vs a typo — firewall, or outbound port blocked).
            Port <span className="font-mono">465</span> uses <strong>implicit TLS only</strong>; do not combine it with STARTTLS
            (that path is for port <span className="font-mono">587</span>).
          </p>
        </div>
      </div>

      {!loaded && (
        <div className="text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      )}
      {loadError && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm mb-4">{loadError}</div>
      )}
      {loaded && !loadError && (
        <>
          <div className="mb-6 inline-flex rounded-lg border border-gray-700 bg-secondary p-1">
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`px-3 py-2 rounded-md text-sm inline-flex items-center gap-2 ${activeTab === 'settings' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'}`}
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('log')
                loadLog()
              }}
              className={`px-3 py-2 rounded-md text-sm inline-flex items-center gap-2 ${activeTab === 'log' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'}`}
            >
              <Mail className="w-4 h-4" />
              Email log
              <span className="text-xs text-gray-500">{emailLog.length}</span>
            </button>
          </div>

          {message && (
            <div className={`text-sm rounded border px-3 py-2 mb-6 ${message.startsWith('Test sent') || message === 'Saved.' || message.includes('cleared')
              ? 'border-green-500/40 bg-green-500/10 text-green-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-100'}`}
            >
              {message}
            </div>
          )}

          {activeTab === 'settings' ? (
        <form onSubmit={save} className="space-y-6">
          <div className="rounded-lg border border-gray-700 bg-secondary p-6 space-y-4">
            <label className="flex items-center gap-2 text-white font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                className="rounded border-gray-600"
              />
              Enable email notifications
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block text-sm text-gray-300 md:col-span-2">
                SMTP host
                <input
                  value={form.host}
                  onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                  className="mt-1 w-full bg-primary border border-gray-700 rounded px-3 py-2 text-white"
                  placeholder="mail.enmail.co"
                  autoComplete="off"
                />
                <span className="text-[11px] text-gray-500 mt-1 block">Must match your provider’s outgoing server exactly.</span>
              </label>
              <label className="block text-sm text-gray-300">
                Port
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) => setForm((f) => normalizeSmtpTlsForPort({ ...f, port: e.target.value }))}
                  className="mt-1 w-full bg-primary border border-gray-700 rounded px-3 py-2 text-white"
                />
              </label>
              <div className="flex flex-col gap-2 text-sm text-gray-300 justify-end pb-1">
                <label className={`flex items-center gap-2 ${Number(form.port) === 465 ? 'cursor-default' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    checked={Number(form.port) === 465 ? true : !!form.use_tls}
                    disabled={Number(form.port) === 465}
                    onChange={(e) => setForm((f) => ({ ...f, use_tls: e.target.checked }))}
                  />
                  Implicit TLS (SSL){Number(form.port) === 465 && <span className="text-gray-500"> — required for 465</span>}
                </label>
                <label className={`flex items-center gap-2 ${Number(form.port) === 465 ? 'cursor-default opacity-50' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    checked={Number(form.port) === 465 ? false : !!form.use_starttls}
                    disabled={Number(form.port) === 465}
                    onChange={(e) => setForm((f) => ({ ...f, use_starttls: e.target.checked }))}
                  />
                  STARTTLS (use with port 587)
                </label>
              </div>
              <label className="block text-sm text-gray-300">
                SMTP username (optional)
                <input
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  className="mt-1 w-full bg-primary border border-gray-700 rounded px-3 py-2 text-white"
                  autoComplete="username"
                />
              </label>
              <label className="block text-sm text-gray-300">
                SMTP password {form.has_password && <span className="text-gray-500 font-normal">(leave blank to keep)</span>}
                <input
                  type="password"
                  value={form.smtp_password}
                  onChange={(e) => setForm((f) => ({ ...f, smtp_password: e.target.value }))}
                  className="mt-1 w-full bg-primary border border-gray-700 rounded px-3 py-2 text-white"
                  autoComplete="new-password"
                  placeholder={form.has_password ? '••••••••' : ''}
                />
              </label>
              {form.has_password && (
                <div className="md:col-span-2">
                  <button
                    type="button"
                    onClick={clearPassword}
                    className="text-xs text-red-400 hover:underline"
                  >
                    Clear stored password
                  </button>
                </div>
              )}
              {form.smtp_password_error && (
                <div className="md:col-span-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  {form.smtp_password_error}
                </div>
              )}
              <label className="block text-sm text-gray-300 md:col-span-2">
                Sender name
                <input
                  value={form.from_name}
                  onChange={(e) => setForm((f) => ({ ...f, from_name: e.target.value }))}
                  className="mt-1 w-full bg-primary border border-gray-700 rounded px-3 py-2 text-white"
                  placeholder="Ascend"
                />
              </label>
              <label className="block text-sm text-gray-300 md:col-span-2">
                From address
                <input
                  value={form.from_addr}
                  onChange={(e) => setForm((f) => ({ ...f, from_addr: e.target.value }))}
                  className="mt-1 w-full bg-primary border border-gray-700 rounded px-3 py-2 text-white"
                  placeholder="alerts@yourdomain.com"
                />
              </label>
              <label className="block text-sm text-gray-300 md:col-span-2">
                Send alerts to (comma-separated)
                <input
                  value={form.notify_to}
                  onChange={(e) => setForm((f) => ({ ...f, notify_to: e.target.value }))}
                  className="mt-1 w-full bg-primary border border-gray-700 rounded px-3 py-2 text-white"
                  placeholder="you@example.com, ops@example.com"
                />
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-gray-700 bg-secondary p-6">
            <h2 className="text-white font-semibold mb-3">Notify when…</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              {EVENT_OPTIONS.map(({ key, label }) => (
                <label key={key} className="flex items-start gap-2 text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!form.events[key]}
                    onChange={(e) => setEv(key, e.target.checked)}
                    className="rounded border-gray-600 mt-0.5"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {deliveryEntries.length > 0 && (
            <div className="rounded-lg border border-gray-700 bg-secondary p-6">
              <h2 className="text-white font-semibold mb-3">Recent delivery status</h2>
              <div className="space-y-3 text-sm">
                {deliveryEntries.map(([key, item]) => (
                  <div key={key} className="border-b border-gray-700/70 pb-3 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-gray-200 font-medium">{eventLabel(key)}</span>
                      <span className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded border ${
                        item.status === 'sent'
                          ? 'border-green-500/40 bg-green-500/10 text-green-200'
                          : item.status === 'failed'
                            ? 'border-red-500/40 bg-red-500/10 text-red-200'
                            : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                      }`}>
                        {item.status}
                      </span>
                      {item.at && <span className="text-xs text-gray-500">{new Date(item.at).toLocaleString()}</span>}
                    </div>
                    {item.message && <div className="text-gray-400 mt-1 break-words">{item.message}</div>}
                    {Array.isArray(item.recipients) && item.recipients.length > 0 && (
                      <div className="text-xs text-gray-500 mt-1 break-words">To: {item.recipients.join(', ')}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save settings
            </button>
            <div className="flex flex-wrap items-center gap-2 border-l border-gray-600 pl-3 ml-1">
              <input
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="Optional test recipient"
                className="bg-primary border border-gray-700 rounded px-3 py-2 text-white text-sm w-56 max-w-full"
              />
              <button
                type="button"
                onClick={sendTest}
                disabled={testing || saving}
                className="px-3 py-2 border border-gray-600 rounded text-white text-sm inline-flex items-center gap-2 hover:bg-primary/60 disabled:opacity-50"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send test email
              </button>
            </div>
          </div>
        </form>
          ) : (
            <div className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
              <div className="p-4 border-b border-gray-700 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-white font-semibold">Email log</h2>
                  <p className="text-xs text-gray-500 mt-1">Latest 200 notification attempts. History is capped at 500 entries.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={loadLog}
                    disabled={logLoading || clearingLog}
                    className="px-3 py-2 border border-gray-600 rounded text-white text-sm inline-flex items-center gap-2 hover:bg-primary/60 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${logLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={clearLog}
                    disabled={clearingLog || emailLog.length === 0}
                    className="px-3 py-2 border border-red-500/40 rounded text-red-200 text-sm inline-flex items-center gap-2 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {clearingLog ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Clear log
                  </button>
                </div>
              </div>
              {emailLog.length === 0 ? (
                <div className="p-8 text-center text-gray-500 text-sm">No email attempts recorded yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left min-w-[760px]">
                    <thead className="bg-primary/60 text-gray-400">
                      <tr>
                        <th className="px-4 py-3 font-medium">Time</th>
                        <th className="px-4 py-3 font-medium">Event</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Recipients</th>
                        <th className="px-4 py-3 font-medium">Subject</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/70">
                      {emailLog.map((item) => (
                        <tr key={item.id || `${item.at}-${item.event}`} className="align-top">
                          <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{item.at ? new Date(item.at).toLocaleString() : '-'}</td>
                          <td className="px-4 py-3 text-gray-200">{eventLabel(item.event)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded border ${
                              item.status === 'sent'
                                ? 'border-green-500/40 bg-green-500/10 text-green-200'
                                : item.status === 'failed'
                                  ? 'border-red-500/40 bg-red-500/10 text-red-200'
                                  : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                            }`}>
                              {item.status}
                            </span>
                            {item.message && <div className="mt-2 text-xs text-gray-500 max-w-xs break-words">{item.message}</div>}
                          </td>
                          <td className="px-4 py-3 text-gray-300 max-w-[220px] break-words">
                            {Array.isArray(item.recipients) && item.recipients.length > 0 ? item.recipients.join(', ') : '-'}
                          </td>
                          <td className="px-4 py-3 text-gray-300 max-w-sm">
                            <div className="font-medium break-words">{item.subject || '-'}</div>
                            {item.body && (
                              <details className="mt-2">
                                <summary className="cursor-pointer text-xs text-accent">View body</summary>
                                <pre className="mt-2 whitespace-pre-wrap break-words rounded border border-gray-700 bg-primary p-3 text-xs text-gray-300 max-h-64 overflow-auto">{item.body}</pre>
                              </details>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
