import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react'
import { apiClient } from '@/lib/api'

function Badge({ value, tone = 'gray' }) {
  const cls = {
    green: 'border-green-500/40 bg-green-500/10 text-green-200',
    yellow: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200',
    red: 'border-red-500/40 bg-red-500/10 text-red-200',
    blue: 'border-blue-500/40 bg-blue-500/10 text-blue-200',
    gray: 'border-gray-600 bg-primary/40 text-gray-300',
  }[tone] || 'border-gray-600 bg-primary/40 text-gray-300'
  return <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${cls}`}>{value}</span>
}

function ToolCard({ title, installed, subtitle, status }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-secondary p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-white font-semibold">{title}</div>
          <div className="text-gray-500 text-xs mt-1 break-all">{subtitle || 'Not detected'}</div>
        </div>
        <Badge value={installed ? 'installed' : 'missing'} tone={installed ? 'green' : 'yellow'} />
      </div>
      {status && <div className="text-xs text-gray-400 mt-3">{status}</div>}
    </div>
  )
}

function Kpi({ label, value, tone = 'gray' }) {
  const color = {
    green: 'text-green-300',
    yellow: 'text-yellow-300',
    red: 'text-red-300',
    blue: 'text-blue-300',
    gray: 'text-white',
  }[tone] || 'text-white'
  return (
    <div className="rounded-lg border border-gray-700 bg-secondary p-4">
      <div className="text-gray-400 text-sm">{label}</div>
      <div className={`text-3xl font-bold mt-2 ${color}`}>{value}</div>
    </div>
  )
}

export default function SecurityPage() {
  const [status, setStatus] = useState(null)
  const [logKind, setLogKind] = useState('scan')
  const [log, setLog] = useState('')
  const [selectedPaths, setSelectedPaths] = useState({})
  const [quarantine, setQuarantine] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const state = status?.state || {}
  const scan = state.scan || {}
  const install = state.install || {}
  const crowdsecInstall = state.crowdsec_install || {}
  const findings = state.findings || scan.findings || []
  const quarantineItems = state.quarantine || []
  const scanRunning = ['starting', 'running'].includes(scan.status)
  const installRunning = ['starting', 'running'].includes(install.status)
  const crowdsecInstallRunning = ['starting', 'running'].includes(crowdsecInstall.status)
  const clamInstalled = !!status?.tools?.clamscan?.installed
  const crowdsecInstalled = !!status?.tools?.cscli?.installed
  const crowdsecDecisions = status?.tools?.crowdsec_decisions?.items || []

  const load = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    try {
      const [{ data: statusData }, { data: logData }] = await Promise.all([
        apiClient.getSecurityCenterStatus(),
        apiClient.getSecurityLogs(logKind),
      ])
      setStatus(statusData)
      setLog(logData.log || '')
      setError('')
      setSelectedPaths((current) => {
        if (Object.keys(current).length) return current
        const next = {}
        for (const p of statusData.scan_paths || []) {
          next[p.key] = ['web_roots', 'tmp', 'deployments', 'static_sites'].includes(p.key)
        }
        return next
      })
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load security status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [logKind])
  useEffect(() => {
    if (!scanRunning && !installRunning && !crowdsecInstallRunning) return undefined
    const timer = setInterval(() => load({ quiet: true }), 2500)
    return () => clearInterval(timer)
  }, [scanRunning, installRunning, crowdsecInstallRunning, logKind])

  const summary = useMemo(() => {
    const definitions = status?.tools?.definitions?.database_files || []
    const newest = definitions
      .map((f) => f.updated_at)
      .filter(Boolean)
      .sort()
      .pop()
    return {
      newestDefinitions: newest ? new Date(newest).toLocaleString() : 'unknown',
      activeThreats: findings.length,
      quarantined: quarantineItems.length,
      scanStatus: scan.status || 'never',
      blockedIps: crowdsecDecisions.length,
    }
  }, [status, findings.length, quarantineItems.length, scan.status, crowdsecDecisions.length])

  const startInstall = async () => {
    setBusy('install')
    setMessage('')
    try {
      const { data } = await apiClient.startSecurityInstall()
      setMessage(data.message || 'Install started')
      setLogKind('install')
      await load({ quiet: true })
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to start ClamAV install')
    } finally {
      setBusy('')
    }
  }

  const startScan = async () => {
    setBusy('scan')
    setMessage('')
    try {
      const paths = Object.entries(selectedPaths).filter(([, enabled]) => enabled).map(([key]) => key)
      const { data } = await apiClient.startSecurityScan({ paths, quarantine })
      setMessage(data.message || 'Scan started')
      setLogKind('scan')
      await load({ quiet: true })
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to start security scan')
    } finally {
      setBusy('')
    }
  }

  const startCrowdSecInstall = async () => {
    setBusy('crowdsec')
    setMessage('')
    try {
      const { data } = await apiClient.startCrowdSecInstall()
      setMessage(data.message || 'CrowdSec install started')
      setLogKind('crowdsec')
      await load({ quiet: true })
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to start CrowdSec install')
    } finally {
      setBusy('')
    }
  }

  const unblockDecision = async (item) => {
    const label = item.value || item.id
    if (!window.confirm(`Remove CrowdSec block for ${label}?`)) return
    setBusy(`unblock-${label}`)
    try {
      await apiClient.deleteCrowdSecDecision({ id: item.id, value: item.value })
      await load({ quiet: true })
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to remove CrowdSec decision')
    } finally {
      setBusy('')
    }
  }

  const clearFindings = async () => {
    if (!window.confirm('Clear security findings from Ascend? Quarantined files will remain.')) return
    setBusy('clear-findings')
    try {
      await apiClient.clearSecurityFindings()
      await load({ quiet: true })
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to clear findings')
    } finally {
      setBusy('')
    }
  }

  const clearQuarantine = async () => {
    if (!window.confirm('Delete all quarantined files permanently?')) return
    setBusy('clear-quarantine')
    try {
      await apiClient.clearSecurityQuarantine()
      await load({ quiet: true })
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to clear quarantine')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-10 h-10 text-accent shrink-0" />
          <div>
            <h1 className="text-3xl font-bold text-white">Security Center</h1>
            <p className="text-gray-400 text-sm mt-1">Malware scanning, quarantine, and server security findings powered by ClamAV.</p>
          </div>
        </div>
        <button onClick={() => load()} disabled={loading} className="px-3 py-2 border border-gray-600 rounded text-white text-sm inline-flex items-center gap-2 hover:bg-secondary disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {message && <div className="mb-4 rounded border border-green-500/30 bg-green-500/10 p-3 text-green-200 text-sm">{message}</div>}
      {error && <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{error}</div>}

      {loading && !status ? (
        <div className="rounded-lg border border-gray-700 bg-secondary p-8 text-gray-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading security status...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Kpi label="Scanner" value={clamInstalled ? 'Ready' : 'Missing'} tone={clamInstalled ? 'green' : 'yellow'} />
            <Kpi label="Scan status" value={summary.scanStatus} tone={scan.status === 'infected' ? 'red' : scanRunning ? 'blue' : 'green'} />
            <Kpi label="Findings" value={summary.activeThreats} tone={summary.activeThreats ? 'red' : 'green'} />
            <Kpi label="Blocked IPs" value={summary.blockedIps} tone={summary.blockedIps ? 'red' : crowdsecInstalled ? 'green' : 'yellow'} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
            <div className="xl:col-span-2 rounded-lg border border-gray-700 bg-secondary p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-white font-semibold text-lg">Malware Scan</h2>
                  <p className="text-gray-500 text-sm">Select the areas Ascend should scan. Infected files are moved to quarantine by default.</p>
                </div>
                <button
                  onClick={startScan}
                  disabled={!clamInstalled || scanRunning || installRunning || busy === 'scan'}
                  className="px-4 py-2 bg-accent text-white rounded-lg text-sm inline-flex items-center gap-2 hover:bg-blue-600 disabled:opacity-50"
                >
                  {busy === 'scan' || scanRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Start scan
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                {(status?.scan_paths || []).map((p) => (
                  <label key={p.key} className={`rounded border p-3 flex items-start gap-3 ${p.exists ? 'border-gray-700 bg-primary/30' : 'border-gray-800 bg-primary/10 opacity-60'}`}>
                    <input
                      type="checkbox"
                      checked={!!selectedPaths[p.key]}
                      disabled={!p.exists}
                      onChange={(e) => setSelectedPaths((cur) => ({ ...cur, [p.key]: e.target.checked }))}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-white text-sm font-medium">{p.label}</span>
                      <span className="block text-gray-500 text-xs font-mono break-all">{p.path}</span>
                    </span>
                  </label>
                ))}
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={quarantine} onChange={(e) => setQuarantine(e.target.checked)} />
                Move infected files to quarantine
              </label>

              {scan.message && (
                <div className={`mt-4 rounded border p-3 text-sm ${scan.status === 'infected' ? 'border-red-500/30 bg-red-500/10 text-red-200' : scan.status === 'failed' ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200' : 'border-gray-700 bg-primary/30 text-gray-300'}`}>
                  {scanRunning && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
                  {scan.message}
                  {scan.finished_at && <span className="text-gray-500 ml-2">{new Date(scan.finished_at).toLocaleString()}</span>}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <ToolCard
                title="ClamAV scanner"
                installed={clamInstalled}
                subtitle={status?.tools?.clamscan?.version}
              />
              <ToolCard
                title="Freshclam updates"
                installed={!!status?.tools?.freshclam?.installed}
                subtitle={status?.tools?.freshclam?.version}
                status={`Definitions: ${summary.newestDefinitions}`}
              />
              <button
                onClick={startInstall}
                disabled={installRunning || busy === 'install'}
                className="w-full px-4 py-2 border border-gray-600 rounded-lg text-white text-sm inline-flex items-center justify-center gap-2 hover:bg-primary disabled:opacity-50"
              >
                {installRunning || busy === 'install' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                Install / repair ClamAV
              </button>
              {install.message && (
                <div className="text-xs text-gray-400 rounded border border-gray-700 bg-primary/30 p-3">
                  {install.message}
                </div>
              )}
            </div>
          </div>

          <section className="rounded-lg border border-gray-700 bg-secondary overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-gray-700 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-white font-semibold text-lg inline-flex items-center gap-2">
                  <Ban className="w-5 h-5 text-accent" /> IP Blocking
                </h2>
                <p className="text-gray-500 text-sm mt-1">CrowdSec watches SSH/Nginx behavior and the firewall bouncer blocks active attack decisions.</p>
              </div>
              <button
                onClick={startCrowdSecInstall}
                disabled={crowdsecInstallRunning || busy === 'crowdsec'}
                className="px-4 py-2 border border-gray-600 rounded-lg text-white text-sm inline-flex items-center gap-2 hover:bg-primary disabled:opacity-50"
              >
                {crowdsecInstallRunning || busy === 'crowdsec' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                Install / repair CrowdSec
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-5 border-b border-gray-700">
              <ToolCard
                title="CrowdSec agent"
                installed={crowdsecInstalled}
                subtitle={status?.tools?.crowdsec?.version || status?.tools?.cscli?.version}
                status={`Service: ${status?.tools?.crowdsec_service?.active || 'unknown'}`}
              />
              <ToolCard
                title="Firewall bouncer"
                installed={status?.tools?.crowdsec_firewall_bouncer_service?.ok}
                subtitle="Enforces CrowdSec decisions on the server firewall"
                status={`Service: ${status?.tools?.crowdsec_firewall_bouncer_service?.active || 'unknown'}`}
              />
              <div className="rounded-lg border border-gray-700 bg-primary/30 p-4">
                <div className="text-gray-400 text-sm">Active CrowdSec decisions</div>
                <div className={`text-3xl font-bold mt-2 ${crowdsecDecisions.length ? 'text-red-300' : 'text-green-300'}`}>{crowdsecDecisions.length}</div>
                {crowdsecInstall.message && <div className="text-xs text-gray-400 mt-3">{crowdsecInstall.message}</div>}
              </div>
            </div>
            {status?.tools?.crowdsec_decisions?.error && (
              <div className="mx-5 mt-5 rounded border border-yellow-500/30 bg-yellow-500/10 p-3 text-yellow-200 text-sm">
                {status.tools.crowdsec_decisions.error}
              </div>
            )}
            {crowdsecDecisions.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">No active IP blocks right now.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left min-w-[900px]">
                  <thead className="bg-primary/60 text-gray-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Value</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Reason</th>
                      <th className="px-4 py-3 font-medium">Origin</th>
                      <th className="px-4 py-3 font-medium">Until</th>
                      <th className="px-4 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/70">
                    {crowdsecDecisions.map((item, idx) => (
                      <tr key={`${item.id || item.value}-${idx}`}>
                        <td className="px-4 py-3 text-white font-mono">{item.value || item.id || '-'}</td>
                        <td className="px-4 py-3 text-gray-300">{item.type || item.scope || '-'}</td>
                        <td className="px-4 py-3 text-gray-300">{item.reason || item.scenario || '-'}</td>
                        <td className="px-4 py-3 text-gray-400">{item.origin || '-'}</td>
                        <td className="px-4 py-3 text-gray-400">{item.until || item.duration || '-'}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => unblockDecision(item)}
                            disabled={busy === `unblock-${item.value || item.id}`}
                            className="px-2 py-1 border border-gray-600 rounded text-gray-200 hover:bg-primary disabled:opacity-50"
                          >
                            Unblock
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between gap-3">
                <h2 className="text-white font-semibold inline-flex items-center gap-2">
                  {findings.length ? <AlertTriangle className="w-4 h-4 text-red-300" /> : <CheckCircle2 className="w-4 h-4 text-green-300" />}
                  Findings
                </h2>
                <button onClick={clearFindings} disabled={!findings.length || busy === 'clear-findings'} className="text-xs px-2 py-1 border border-gray-600 rounded text-gray-300 hover:bg-primary disabled:opacity-50">
                  Clear
                </button>
              </div>
              {findings.length === 0 ? (
                <div className="p-8 text-center text-gray-500 text-sm">No malware findings recorded.</div>
              ) : (
                <div className="max-h-80 overflow-auto divide-y divide-gray-700">
                  {findings.map((item, idx) => (
                    <div key={`${item.path}-${idx}`} className="p-4">
                      <div className="flex flex-wrap gap-2 items-center mb-2">
                        <Badge value={item.severity || 'critical'} tone="red" />
                        {item.quarantine_status && <Badge value={`quarantine: ${item.quarantine_status}`} tone={item.quarantine_status === 'moved' ? 'yellow' : 'gray'} />}
                      </div>
                      <div className="text-red-200 text-sm font-medium">{item.signature}</div>
                      <div className="text-gray-400 text-xs font-mono break-all mt-1">{item.path}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between gap-3">
                <h2 className="text-white font-semibold">Quarantine</h2>
                <button onClick={clearQuarantine} disabled={!quarantineItems.length || busy === 'clear-quarantine'} className="text-xs px-2 py-1 border border-red-500/40 rounded text-red-200 hover:bg-red-500/10 disabled:opacity-50 inline-flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Delete all
                </button>
              </div>
              {quarantineItems.length === 0 ? (
                <div className="p-8 text-center text-gray-500 text-sm">No files in quarantine.</div>
              ) : (
                <div className="max-h-80 overflow-auto divide-y divide-gray-700">
                  {quarantineItems.map((item, idx) => (
                    <div key={`${item.quarantine_path}-${idx}`} className="p-4">
                      <div className="text-yellow-200 text-sm">{item.signature}</div>
                      <div className="text-gray-400 text-xs font-mono break-all mt-1">{item.original_path}</div>
                      <div className="text-gray-500 text-xs font-mono break-all mt-1">{item.quarantine_path}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between gap-3">
              <h2 className="text-white font-semibold">Live Log</h2>
              <div className="flex gap-2">
                {['scan', 'install', 'crowdsec'].map((kind) => (
                  <button
                    key={kind}
                    onClick={() => setLogKind(kind)}
                    className={`px-3 py-1.5 rounded text-xs ${logKind === kind ? 'bg-accent text-white' : 'border border-gray-600 text-gray-300 hover:bg-primary'}`}
                  >
                    {kind}
                  </button>
                ))}
              </div>
            </div>
            <pre className="m-0 max-h-[420px] overflow-auto bg-[#050914] p-4 text-xs text-gray-300 whitespace-pre-wrap font-mono">
              {log || 'No log output yet.'}
            </pre>
          </section>
        </>
      )}
    </div>
  )
}
