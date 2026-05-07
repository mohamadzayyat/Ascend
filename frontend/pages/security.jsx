import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clipboard,
  FileWarning,
  Loader2,
  Play,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react'
import { apiClient, securityStatusStreamUrl } from '@/lib/api'
import { useDialog } from '@/lib/dialog'

const TABS = [
  ['overview', 'Overview'],
  ['malware', 'Malware'],
  ['threats', 'Threats'],
  ['ip', 'IP Protection'],
  ['fixes', 'Fixes'],
  ['logs', 'Logs'],
]

const PAGE_SIZE = 10

function toneClasses(tone) {
  return {
    green: 'border-green-500/40 bg-green-500/10 text-green-200',
    yellow: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200',
    red: 'border-red-500/40 bg-red-500/10 text-red-200',
    blue: 'border-blue-500/40 bg-blue-500/10 text-blue-200',
    gray: 'border-gray-600 bg-primary/40 text-gray-300',
  }[tone] || 'border-gray-600 bg-primary/40 text-gray-300'
}

function Badge({ value, tone = 'gray' }) {
  return <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${toneClasses(tone)}`}>{value}</span>
}

function Metric({ label, value, tone = 'gray', hint }) {
  const color = { green: 'text-green-300', yellow: 'text-yellow-300', red: 'text-red-300', blue: 'text-blue-300', gray: 'text-white' }[tone] || 'text-white'
  return (
    <div className="rounded-lg border border-gray-700 bg-secondary p-4">
      <div className="text-gray-400 text-sm">{label}</div>
      <div className={`text-2xl font-bold mt-2 ${color}`}>{value}</div>
      {hint && <div className="text-gray-500 text-xs mt-2">{hint}</div>}
    </div>
  )
}

function StatusRow({ title, ok, detail, action, busy, onAction }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-primary/30 p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {ok ? <CheckCircle2 className="w-4 h-4 text-green-300" /> : <AlertTriangle className="w-4 h-4 text-yellow-300" />}
          <span className="text-white font-medium">{title}</span>
          <Badge value={ok ? 'OK' : 'Needs attention'} tone={ok ? 'green' : 'yellow'} />
        </div>
        <div className="text-gray-400 text-sm mt-1 break-words">{detail}</div>
      </div>
      {action && (
        <button onClick={onAction} disabled={busy} className="px-3 py-2 border border-gray-600 rounded text-white text-sm inline-flex items-center gap-2 hover:bg-secondary disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
          {action}
        </button>
      )}
    </div>
  )
}

function IssueCard({ issue, onFix, busy }) {
  const icon = issue.severity === 'critical' ? <ShieldAlert className="w-5 h-5 text-red-300" /> : <FileWarning className="w-5 h-5 text-yellow-300" />
  return (
    <div className={`rounded-lg border p-4 ${issue.severity === 'critical' ? 'border-red-500/40 bg-red-500/10' : 'border-yellow-500/40 bg-yellow-500/10'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3 min-w-0">
          {icon}
          <div>
            <div className="text-white font-semibold">{issue.title}</div>
            <div className="text-gray-300 text-sm mt-1">{issue.message}</div>
            {issue.command && <div className="text-gray-500 text-xs font-mono mt-2 break-all">{issue.command}</div>}
          </div>
        </div>
        {issue.fix && (
          <button onClick={() => onFix(issue.fix)} disabled={busy === issue.fix} className="px-3 py-2 rounded border border-gray-600 text-white text-sm inline-flex items-center gap-2 hover:bg-secondary disabled:opacity-50">
            {busy === issue.fix ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
            Fix
          </button>
        )}
      </div>
    </div>
  )
}

function LogViewer({ log, logKind, setLogKind }) {
  const lines = (log || 'No log output yet.').split('\n')
  const copyLog = () => navigator.clipboard?.writeText(log || '')
  return (
    <section className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-white font-semibold">Logs</h2>
        <div className="flex flex-wrap gap-2">
          {['scan', 'install', 'crowdsec'].map((kind) => (
            <button key={kind} onClick={() => setLogKind(kind)} className={`px-3 py-1.5 rounded text-xs ${logKind === kind ? 'bg-accent text-white' : 'border border-gray-600 text-gray-300 hover:bg-primary'}`}>
              {kind}
            </button>
          ))}
          <button onClick={copyLog} className="px-3 py-1.5 rounded text-xs border border-gray-600 text-gray-300 hover:bg-primary inline-flex items-center gap-1">
            <Clipboard className="w-3 h-3" /> Copy
          </button>
        </div>
      </div>
      <pre className="m-0 max-h-[520px] overflow-auto bg-[#050914] p-4 text-xs whitespace-pre-wrap font-mono">
        {lines.map((line, idx) => {
          const bad = /error|failed|denied|not found|lock|fatal/i.test(line)
          const good = /success|completed|installed|enabled|done/i.test(line)
          return <div key={idx} className={bad ? 'text-red-300' : good ? 'text-green-300' : 'text-gray-300'}>{line || ' '}</div>
        })}
      </pre>
    </section>
  )
}

function latestDate(files) {
  return (files || []).map((f) => f.updated_at).filter(Boolean).sort().pop()
}

function daysSince(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return null
  return ms / 86400000
}

function asText(value, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((v) => asText(v, '')).filter(Boolean).join(', ') || fallback
  try {
    return JSON.stringify(value)
  } catch {
    return fallback
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function threatPersistenceKey(item) {
  return `${item?.path || ''}:${item?.line || ''}`
}

function canDeleteThreatPersistenceFile(item) {
  return !!item?.is_cleanup_backup || String(item?.path || '').includes('/root/.config/.logrotate')
}

function formatMaybeDate(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isFinite(d.getTime())) return d.toLocaleString()
  return asText(value)
}

function Pager({ page, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (pages <= 1) return null
  return (
    <div className="px-4 py-3 border-t border-gray-700 flex items-center justify-between text-sm">
      <span className="text-gray-400">Page {page + 1} of {pages}</span>
      <div className="flex gap-2">
        <button onClick={() => onPage(Math.max(0, page - 1))} disabled={page <= 0} className="px-3 py-1.5 border border-gray-600 rounded text-gray-200 disabled:opacity-50">Prev</button>
        <button onClick={() => onPage(Math.min(pages - 1, page + 1))} disabled={page >= pages - 1} className="px-3 py-1.5 border border-gray-600 rounded text-gray-200 disabled:opacity-50">Next</button>
      </div>
    </div>
  )
}

export default function SecurityPage() {
  const dialog = useDialog()
  const [activeTab, setActiveTab] = useState('overview')
  const [status, setStatus] = useState(null)
  const [logKind, setLogKind] = useState('scan')
  const [log, setLog] = useState('')
  const [selectedPaths, setSelectedPaths] = useState({})
  const [quarantine, setQuarantine] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [streamConnected, setStreamConnected] = useState(false)
  const [sshFailures, setSshFailures] = useState({ summary: [], events: [], total: 0, errors: [] })
  const [blocksSearch, setBlocksSearch] = useState('')
  const [blocksPage, setBlocksPage] = useState(0)
  const [sshPage, setSshPage] = useState(0)
  const [threats, setThreats] = useState({ processes: [], persistence: [], immutable: [] })
  const [selectedPersistence, setSelectedPersistence] = useState({})

  const state = status?.state || {}
  const tools = status?.tools || {}
  const scan = state.scan || {}
  const install = state.install || {}
  const crowdsecInstall = state.crowdsec_install || {}
  const findings = state.findings || scan.findings || []
  const quarantineItems = state.quarantine || []
  const crowdsecDecisions = asArray(tools.crowdsec_decisions?.items)
  const autoSshBlock = status?.auto_ssh_block || state.auto_ssh_block_last || {}
  const securityEnabled = status?.security_enabled !== false
  const scanRunning = ['starting', 'running'].includes(scan.status)
  const installRunning = ['starting', 'running'].includes(install.status)
  const crowdsecInstallRunning = ['starting', 'running'].includes(crowdsecInstall.status)
  const securityStatusRefreshing = !!tools.crowdsec_decisions?.refreshing || !!autoSshBlock?.scheduled
  const clamInstalled = !!tools.clamscan?.installed
  const freshclamInstalled = !!tools.freshclam?.installed
  const crowdsecInstalled = !!tools.cscli?.installed
  const bouncerOk = !!tools.crowdsec_firewall_bouncer_service?.ok
  const http401Threshold = tools.crowdsec_http_401_threshold || {}
  const http401Action = http401Threshold.disabled
    ? 'crowdsec_http_401_enable'
    : http401Threshold.configured
      ? 'crowdsec_http_401_disable'
      : 'crowdsec_http_401_threshold'
  const http401ActionLabel = http401Threshold.disabled ? 'Turn on' : http401Threshold.configured ? 'Turn off' : 'Apply 10/24h'
  const definitionsNewest = latestDate(tools.definitions?.database_files)
  const definitionsAge = daysSince(definitionsNewest)
  const filteredDecisions = useMemo(() => {
    const query = blocksSearch.trim().toLowerCase()
    if (!query) return crowdsecDecisions
    return crowdsecDecisions.filter((item) => [
      item.value,
      item.id,
      item.reason,
      item.scenario,
      item.origin,
      item.type,
      item.blocked_by,
    ].some((value) => asText(value, '').toLowerCase().includes(query)))
  }, [crowdsecDecisions, blocksSearch])
  const pagedDecisions = filteredDecisions.slice(blocksPage * PAGE_SIZE, (blocksPage + 1) * PAGE_SIZE)
  const sshSummary = asArray(sshFailures.summary)
  const pagedSshSummary = sshSummary.slice(sshPage * PAGE_SIZE, (sshPage + 1) * PAGE_SIZE)
  const persistenceItems = asArray(threats.persistence)
  const selectedPersistenceKeys = Object.keys(selectedPersistence).filter((key) => selectedPersistence[key])
  const allPersistenceSelected = persistenceItems.length > 0 && persistenceItems.every((item) => selectedPersistence[threatPersistenceKey(item)])

  const load = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    try {
      const shouldLoadLog = activeTab === 'logs' || scanRunning || installRunning || crowdsecInstallRunning
      const [{ data: statusData }, logResult] = await Promise.all([
        apiClient.getSecurityCenterStatus(),
        shouldLoadLog ? apiClient.getSecurityLogs(logKind) : Promise.resolve({ data: { log } }),
      ])
      const logData = logResult.data || {}
      setStatus(statusData)
      setThreats(statusData.threats || { processes: [], persistence: [], immutable: [] })
      setLog(logData.log || '')
      setError('')
      setSelectedPaths((current) => {
        if (Object.keys(current).length) return current
        const next = {}
        for (const p of statusData.scan_paths || []) next[p.key] = ['web_roots', 'tmp', 'deployments', 'static_sites'].includes(p.key)
        return next
      })
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load security status')
    } finally {
      setLoading(false)
    }
  }

  const loadSshFailures = async () => {
    try {
      const { data } = await apiClient.getSshFailures(500)
      setSshFailures({
        summary: asArray(data?.summary),
        events: asArray(data?.events),
        total: Number(data?.total || 0),
        errors: asArray(data?.errors),
      })
      setSshPage(0)
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load SSH failures')
    }
  }

  const loadThreats = async () => {
    try {
      const { data } = await apiClient.getSecurityThreats()
      setThreats(data || { processes: [], persistence: [], immutable: [] })
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load threat persistence scan')
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { if (activeTab === 'logs') apiClient.getSecurityLogs(logKind).then(({ data }) => setLog(data.log || '')).catch(() => {}) }, [activeTab, logKind])
  useEffect(() => { if (activeTab === 'ip') loadSshFailures() }, [activeTab])
  useEffect(() => { if (activeTab === 'threats') loadThreats() }, [activeTab])
  useEffect(() => { setBlocksPage(0) }, [blocksSearch])
  useEffect(() => {
    setSelectedPersistence((current) => {
      const valid = new Set(persistenceItems.map(threatPersistenceKey))
      const next = {}
      for (const [key, value] of Object.entries(current)) {
        if (value && valid.has(key)) next[key] = true
      }
      return next
    })
  }, [threats.persistence])
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') return undefined
    let closed = false
    let fallbackTimer = null
    const source = new EventSource(securityStatusStreamUrl(), { withCredentials: true })
    source.addEventListener('open', () => {
      if (closed) return
      setStreamConnected(true)
      if (fallbackTimer) {
        clearInterval(fallbackTimer)
        fallbackTimer = null
      }
    })
    source.addEventListener('status', (event) => {
      if (closed) return
      try {
        const data = JSON.parse(event.data)
        setStatus(data)
        setThreats(data.threats || { processes: [], persistence: [], immutable: [] })
        setError('')
        setLoading(false)
        setSelectedPaths((current) => {
          if (Object.keys(current).length) return current
          const next = {}
          for (const p of data.scan_paths || []) next[p.key] = ['web_roots', 'tmp', 'deployments', 'static_sites'].includes(p.key)
          return next
        })
      } catch {
        /* Ignore malformed stream frames. */
      }
    })
    source.addEventListener('logs', (event) => {
      if (closed || activeTab !== 'logs') return
      try {
        const data = JSON.parse(event.data)
        setLog(data[logKind] || '')
      } catch {
        /* Ignore malformed stream frames. */
      }
    })
    source.addEventListener('error', () => {
      if (closed) return
      setStreamConnected(false)
      if (!fallbackTimer) fallbackTimer = setInterval(() => load({ quiet: true }), 15000)
    })
    return () => {
      closed = true
      source.close()
      if (fallbackTimer) clearInterval(fallbackTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, logKind])

  const issues = useMemo(() => {
    const rows = []
    if (!securityEnabled) rows.push({ severity: 'warning', title: 'Security protection is paused', message: 'Automatic protection actions are off. Turn Security protection on to resume background SSH brute-force blocking.' })
    if (!clamInstalled) rows.push({ severity: 'critical', title: 'Malware scanner is missing', message: 'ClamAV is not installed, so Ascend cannot scan websites or uploads for malware.', fix: 'install_clamav' })
    if (clamInstalled && !freshclamInstalled) rows.push({ severity: 'warning', title: 'ClamAV updater is missing', message: 'freshclam is not available, so malware signatures may become stale.', fix: 'install_clamav' })
    if (clamInstalled && definitionsAge !== null && definitionsAge > 2) rows.push({ severity: 'warning', title: 'Virus definitions are stale', message: `Latest definition file is ${Math.floor(definitionsAge)} days old. Update signatures before trusting scan results.`, fix: 'clamav_update_definitions', command: 'freshclam' })
    if (clamInstalled && tools.clamav_freshclam_service?.available && !tools.clamav_freshclam_service?.ok) rows.push({ severity: 'warning', title: 'ClamAV updater service is stopped', message: 'freshclam is installed but the background updater is not active.', fix: 'clamav_restart_updates', command: 'systemctl restart clamav-freshclam' })
    if (findings.length > 0) rows.push({ severity: 'critical', title: 'Malware findings exist', message: `${findings.length} infected file record(s) require review. Keep quarantine enabled and inspect the affected projects.` })
    if (!crowdsecInstalled) rows.push({ severity: 'critical', title: 'IP blocking is not installed', message: 'CrowdSec is missing, so abusive SSH/Nginx traffic is not being blocked by Ascend.', fix: 'install_crowdsec' })
    if (crowdsecInstalled && tools.crowdsec_service?.available && !tools.crowdsec_service?.ok) rows.push({ severity: 'critical', title: 'CrowdSec agent is stopped', message: 'Attacks may not be detected until the CrowdSec service is running.', fix: 'crowdsec_restart', command: 'systemctl restart crowdsec' })
    if (crowdsecInstalled && !bouncerOk) rows.push({ severity: 'critical', title: 'Firewall bouncer is not enforcing blocks', message: 'CrowdSec may detect attackers, but IPs will not be blocked until the bouncer is installed and running.', fix: 'crowdsec_bouncer_restart', command: 'install/enable/restart CrowdSec firewall bouncer' })
    if (tools.crowdsec_decisions?.error && crowdsecInstalled && tools.crowdsec_service?.ok) rows.push({ severity: 'warning', title: 'Could not read CrowdSec decisions', message: tools.crowdsec_decisions.error, fix: 'crowdsec_restart' })
    if (install.status === 'failed' || crowdsecInstall.status === 'failed') rows.push({ severity: 'warning', title: 'Previous install failed', message: 'A prior security install/repair failed. Check Logs, then clear the failed state when resolved.', fix: 'clear_failed_state' })
    if ((threats.processes || []).length) rows.push({ severity: 'critical', title: 'Active miner-like process detected', message: `${threats.processes.length} process(es) match miner or mining pool indicators. Open Threats and kill them.` })
    if ((threats.persistence || []).length) rows.push({ severity: 'critical', title: 'Suspicious persistence detected', message: `${threats.persistence.length} cron/system/profile file(s) contain miner indicators. Open Threats and remove them.` })
    if ((threats.immutable || []).length) rows.push({ severity: 'warning', title: 'Immutable persistence protection found', message: `${threats.immutable.length} suspicious file(s) have immutable flags that can block cleanup.` })
    return rows
  }, [securityEnabled, clamInstalled, freshclamInstalled, definitionsAge, tools, findings.length, crowdsecInstalled, bouncerOk, install.status, crowdsecInstall.status, threats])

  const health = useMemo(() => {
    const critical = issues.filter((i) => i.severity === 'critical').length
    const warning = issues.filter((i) => i.severity !== 'critical').length
    const score = Math.max(0, 100 - critical * 25 - warning * 10)
    const label = critical ? 'Critical' : warning ? 'Needs attention' : 'Protected'
    const tone = critical ? 'red' : warning ? 'yellow' : 'green'
    return { score, label, tone, critical, warning }
  }, [issues])

  const runFix = async (fix) => {
    if (fix === 'crowdsec_http_401_disable') {
      const ok = await dialog.confirm({
        title: 'Turn off HTTP 401 brute-force rule?',
        message: 'CrowdSec will stop blocking repeated HTTP 401 login failures. SSH brute-force protection and other security features stay active.',
        confirmLabel: 'Turn off rule',
        tone: 'warning',
      })
      if (!ok) return
    }
    if (fix === 'crowdsec_http_401_enable') {
      const ok = await dialog.confirm({
        title: 'Turn on HTTP 401 brute-force rule?',
        message: 'CrowdSec will resume blocking repeated HTTP 401 login failures for protected apps.',
        confirmLabel: 'Turn on rule',
        tone: 'warning',
      })
      if (!ok) return
    }
    setBusy(fix)
    setMessage('')
    setError('')
    try {
      if (fix === 'install_clamav') {
        const { data } = await apiClient.startSecurityInstall()
        setMessage(data.message || 'ClamAV install started')
        setLogKind('install')
      } else if (fix === 'install_crowdsec') {
        const { data } = await apiClient.startCrowdSecInstall()
        setMessage(data.message || 'CrowdSec install started')
        setLogKind('crowdsec')
      } else {
        const { data } = await apiClient.repairSecurity(fix)
        setMessage(data.message || 'Repair completed')
      }
      await load({ quiet: true })
    } catch (e) {
      const detail = e.response?.data?.results?.find((r) => r.stderr || r.stdout)
      setError(e.response?.data?.error || detail?.stderr || detail?.stdout || 'Repair failed')
    } finally {
      setBusy('')
    }
  }

  const toggleSecurityProtection = async () => {
    const nextEnabled = !securityEnabled
    const ok = await dialog.confirm({
      title: nextEnabled ? 'Turn on security protection?' : 'Turn off security protection?',
      message: nextEnabled
        ? 'Ascend will resume automatic protection checks such as SSH brute-force auto-blocking.'
        : 'Ascend will pause automatic protection actions such as SSH brute-force auto-blocking. Installed services, existing IP blocks, quarantine files, and manual tools will remain unchanged.',
      confirmLabel: nextEnabled ? 'Turn on' : 'Turn off',
      tone: nextEnabled ? 'warning' : 'danger',
    })
    if (!ok) return
    setBusy('security-toggle')
    setMessage('')
    setError('')
    try {
      const { data } = await apiClient.updateSecurityCenterSettings({ enabled: nextEnabled })
      setMessage(data.message || (nextEnabled ? 'Security protection enabled.' : 'Security protection paused.'))
      await load({ quiet: true })
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to update security protection setting')
    } finally {
      setBusy('')
    }
  }

  const startScan = async () => {
    setBusy('scan')
    setMessage('')
    setError('')
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

  const unblockDecision = async (item) => {
    const label = item.value || `decision #${item.id}`
    const ok = await dialog.confirm({
      title: 'Remove IP block?',
      message: `Remove CrowdSec block for ${label}? This will unblock the source.`,
      confirmLabel: 'Unblock',
      tone: 'warning',
    })
    if (!ok) return
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

  const blockIp = async (ip, count = 0) => {
    const ok = await dialog.confirm({
      title: 'Block IP address?',
      message: `Block ${ip} with CrowdSec for 24 hours?`,
      confirmLabel: 'Block IP',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(`block-${ip}`)
    setError('')
    setMessage('')
    try {
      const { data } = await apiClient.blockCrowdSecIp(ip, '24h', `manual ssh brute-force block: ${count} failed logins`)
      setMessage(data.message || `${ip} blocked.`)
      await Promise.all([load({ quiet: true }), loadSshFailures()])
    } catch (e) {
      setError(e.response?.data?.error || `Failed to block ${ip}`)
    } finally {
      setBusy('')
    }
  }

  const blockRepeatAttackers = async () => {
    const ok = await dialog.confirm({
      title: 'Block repeat SSH attackers?',
      message: 'Block all public IPs with 5 or more failed SSH logins in the last 24 hours?',
      confirmLabel: 'Block attackers',
      tone: 'danger',
    })
    if (!ok) return
    setBusy('block-repeat-ssh')
    setError('')
    setMessage('')
    try {
      const { data } = await apiClient.blockRepeatSshAttackers(5, '24h')
      setMessage(data.message || 'Repeat SSH attackers blocked.')
      await Promise.all([load({ quiet: true }), loadSshFailures()])
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to block repeat SSH attackers')
    } finally {
      setBusy('')
    }
  }

  const killThreatProcess = async (pid) => {
    const ok = await dialog.confirm({
      title: 'Kill suspicious process?',
      message: `Kill suspicious process ${pid}?`,
      confirmLabel: 'Kill process',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(`kill-${pid}`)
    try {
      await apiClient.killSecurityThreatProcess(pid)
      await Promise.all([loadThreats(), load({ quiet: true })])
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to kill process')
    } finally {
      setBusy('')
    }
  }

  const removePersistenceFromUi = (item) => {
    const key = threatPersistenceKey(item)
    setThreats((current) => ({
      ...current,
      persistence: asArray(current.persistence).filter((row) => threatPersistenceKey(row) !== key),
    }))
    setSelectedPersistence((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const cleanupPersistenceItem = async (item) => {
    if (canDeleteThreatPersistenceFile(item)) {
      await apiClient.deleteSecurityThreatFile(item.path)
    } else {
      await apiClient.deleteSecurityThreatPersistenceLine(item.path, item.line)
    }
    removePersistenceFromUi(item)
  }

  const removeThreatLine = async (item) => {
    const ok = await dialog.confirm({
      title: 'Remove persistence line?',
      message: `Remove suspicious line from ${item.path}:${item.line}? A safety copy will be stored outside the scanned cron/systemd paths.`,
      confirmLabel: 'Remove line',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(`line-${item.path}-${item.line}`)
    try {
      await apiClient.deleteSecurityThreatPersistenceLine(item.path, item.line)
      removePersistenceFromUi(item)
      setMessage('Persistence line removed.')
      loadThreats()
      load({ quiet: true })
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to remove persistence line')
    } finally {
      setBusy('')
    }
  }

  const removeImmutable = async (path) => {
    const ok = await dialog.confirm({
      title: 'Remove immutable flag?',
      message: `Remove immutable flag from ${path}?`,
      confirmLabel: 'Remove flag',
      tone: 'warning',
    })
    if (!ok) return
    setBusy(`immutable-${path}`)
    try {
      await apiClient.removeSecurityImmutableFlag(path)
      await Promise.all([loadThreats(), load({ quiet: true })])
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to remove immutable flag')
    } finally {
      setBusy('')
    }
  }

  const deleteThreatFile = async (path) => {
    const ok = await dialog.confirm({
      title: 'Delete suspicious file?',
      message: `Delete suspicious file ${path}? This cannot be undone.`,
      confirmLabel: 'Delete file',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(`file-${path}`)
    try {
      await apiClient.deleteSecurityThreatFile(path)
      setThreats((current) => ({
        ...current,
        persistence: asArray(current.persistence).filter((row) => row.path !== path),
      }))
      setSelectedPersistence((current) => {
        const next = { ...current }
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${path}:`)) delete next[key]
        }
        return next
      })
      setMessage('Suspicious file deleted.')
      loadThreats()
      load({ quiet: true })
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to delete suspicious file')
    } finally {
      setBusy('')
    }
  }

  const cleanupSelectedPersistence = async () => {
    const selected = persistenceItems.filter((item) => selectedPersistence[threatPersistenceKey(item)])
    if (!selected.length) return
    const backups = selected.filter((item) => item.is_cleanup_backup).length
    const lines = selected.length - selected.filter(canDeleteThreatPersistenceFile).length
    const ok = await dialog.confirm({
      title: 'Clean selected threats?',
      message: `Clean ${selected.length} selected threat item(s)? This will remove ${lines} live line(s) and delete ${backups} cleanup backup file(s) when selected.`,
      confirmLabel: 'Clean selected',
      tone: 'danger',
    })
    if (!ok) return
    setBusy('bulk-persistence')
    setError('')
    setMessage('')
    const failed = []
    let cleaned = 0
    for (const item of selected) {
      try {
        await cleanupPersistenceItem(item)
        cleaned += 1
      } catch (e) {
        failed.push(`${item.path}:${item.line} - ${e.response?.data?.error || e.message || 'failed'}`)
      }
    }
    if (cleaned) setMessage(`Cleaned ${cleaned} selected threat item(s).`)
    if (failed.length) setError(`Some items could not be cleaned:\n${failed.slice(0, 5).join('\n')}`)
    setBusy('')
    loadThreats()
    load({ quiet: true })
  }

  const clearFindings = async () => {
    const ok = await dialog.confirm({
      title: 'Clear security findings?',
      message: 'Clear security findings from Ascend? Quarantined files will remain.',
      confirmLabel: 'Clear findings',
      tone: 'warning',
    })
    if (!ok) return
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
    const ok = await dialog.confirm({
      title: 'Delete quarantine?',
      message: 'Delete all quarantined files permanently? This cannot be undone.',
      confirmLabel: 'Delete quarantine',
      tone: 'danger',
    })
    if (!ok) return
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
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-10 h-10 text-accent shrink-0" />
          <div>
            <h1 className="text-3xl font-bold text-white">Security Center</h1>
            <p className="text-gray-400 text-sm mt-1">A practical protection workflow: detect malware, quarantine threats, block attackers, and repair broken protection services.</p>
          </div>
        </div>
        <button onClick={() => load()} disabled={loading} className="px-3 py-2 border border-gray-600 rounded text-white text-sm inline-flex items-center gap-2 hover:bg-secondary disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      <div className="mb-4 flex justify-end">
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${streamConnected ? 'border-green-500/30 bg-green-500/10 text-green-200' : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200'}`}>
          <span className={`h-2 w-2 rounded-full ${streamConnected ? 'bg-green-400' : 'bg-yellow-400'}`} />
          {streamConnected ? 'Live updates connected' : 'Live updates reconnecting'}
        </span>
      </div>

      {status && (
        <section className={`mb-4 rounded-lg border p-4 ${securityEnabled ? 'border-green-500/30 bg-green-500/10' : 'border-yellow-500/40 bg-yellow-500/10'}`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Power className={`mt-0.5 h-5 w-5 ${securityEnabled ? 'text-green-300' : 'text-yellow-300'}`} />
              <div>
                <div className="text-white font-semibold">Security protection is {securityEnabled ? 'on' : 'off'}</div>
                <p className="text-gray-300 text-sm mt-1">
                  {securityEnabled
                    ? 'Automatic protection is active. Ascend can run background checks and auto-block repeated SSH attackers.'
                    : 'Automatic protection actions are paused. Existing blocks, installed services, quarantine files, and manual tools are unchanged.'}
                </p>
              </div>
            </div>
            <button
              onClick={toggleSecurityProtection}
              disabled={busy === 'security-toggle'}
              className={`inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                securityEnabled ? 'border border-yellow-500/50 text-yellow-100 hover:bg-yellow-500/10' : 'bg-accent text-white hover:bg-blue-600'
              }`}
            >
              {busy === 'security-toggle' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              {securityEnabled ? 'Turn off' : 'Turn on'}
            </button>
          </div>
        </section>
      )}

      {message && <div className="mb-4 rounded border border-green-500/30 bg-green-500/10 p-3 text-green-200 text-sm">{message}</div>}
      {error && <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm whitespace-pre-wrap">{error}</div>}

      {loading && !status ? (
        <div className="rounded-lg border border-gray-700 bg-secondary p-8 text-gray-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading security status...
        </div>
      ) : (
        <>
          <section className={`mb-5 rounded-lg border p-5 ${toneClasses(health.tone)}`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-sm opacity-80">Server protection</div>
                <div className="text-3xl font-bold text-white mt-1">{health.label}</div>
                <div className="text-sm mt-2">{health.critical} critical, {health.warning} warning</div>
              </div>
              <div className="text-right">
                <div className="text-5xl font-bold text-white">{health.score}</div>
                <div className="text-xs opacity-80">health score</div>
              </div>
            </div>
          </section>

          <div className="mb-6 flex flex-wrap gap-2 border-b border-gray-700">
            {TABS.map(([key, label]) => (
              <button key={key} onClick={() => setActiveTab(key)} className={`px-4 py-3 text-sm border-b-2 ${activeTab === key ? 'border-accent text-white' : 'border-transparent text-gray-400 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Metric label="Malware scanner" value={clamInstalled ? 'Ready' : 'Missing'} tone={clamInstalled ? 'green' : 'red'} hint={tools.clamscan?.version || 'ClamAV not detected'} />
                <Metric label="Last scan" value={scan.status || 'Never'} tone={scan.status === 'infected' ? 'red' : scanRunning ? 'blue' : scan.status ? 'green' : 'yellow'} hint={scan.finished_at ? new Date(scan.finished_at).toLocaleString() : 'No completed scan'} />
                <Metric label="Blocked IPs" value={crowdsecDecisions.length} tone={crowdsecDecisions.length ? 'red' : crowdsecInstalled ? 'green' : 'yellow'} hint={crowdsecInstalled ? 'CrowdSec decisions' : 'CrowdSec not installed'} />
                <Metric label="Quarantine" value={quarantineItems.length} tone={quarantineItems.length ? 'yellow' : 'green'} hint={`${findings.length} finding records`} />
              </div>
              <section className="rounded-lg border border-gray-700 bg-secondary p-5">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h2 className="text-white font-semibold text-lg">Protection Issues</h2>
                  <button onClick={() => setActiveTab('fixes')} className="text-accent text-sm hover:underline">Open fixes</button>
                </div>
                {issues.length === 0 ? (
                  <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-green-200 text-sm inline-flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> No active security issues detected.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {issues.slice(0, 6).map((issue) => <IssueCard key={issue.title} issue={issue} onFix={runFix} busy={busy} />)}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'malware' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <section className="xl:col-span-2 rounded-lg border border-gray-700 bg-secondary p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div>
                      <h2 className="text-white font-semibold text-lg">Malware Scan</h2>
                      <p className="text-gray-500 text-sm">Choose paths, run ClamAV, and quarantine infected files automatically.</p>
                    </div>
                    <button onClick={startScan} disabled={!clamInstalled || scanRunning || busy === 'scan'} className="px-4 py-2 bg-accent text-white rounded-lg text-sm inline-flex items-center gap-2 hover:bg-blue-600 disabled:opacity-50">
                      {busy === 'scan' || scanRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Start scan
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    {(status?.scan_paths || []).map((p) => (
                      <label key={p.key} className={`rounded border p-3 flex items-start gap-3 ${p.exists ? 'border-gray-700 bg-primary/30' : 'border-gray-800 bg-primary/10 opacity-60'}`}>
                        <input type="checkbox" checked={!!selectedPaths[p.key]} disabled={!p.exists} onChange={(e) => setSelectedPaths((cur) => ({ ...cur, [p.key]: e.target.checked }))} className="mt-1" />
                        <span>
                          <span className="block text-white text-sm font-medium">{p.label}</span>
                          <span className="block text-gray-500 text-xs font-mono break-all">{p.path}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                    <input type="checkbox" checked={quarantine} onChange={(e) => setQuarantine(e.target.checked)} /> Move infected files to quarantine
                  </label>
                  {scan.message && <div className={`mt-4 rounded border p-3 text-sm ${scan.status === 'infected' ? 'border-red-500/30 bg-red-500/10 text-red-200' : scan.status === 'failed' ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200' : 'border-gray-700 bg-primary/30 text-gray-300'}`}>{scanRunning && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}{scan.message}</div>}
                </section>
                <section className="rounded-lg border border-gray-700 bg-secondary p-5 space-y-3">
                  <StatusRow title="ClamAV scanner" ok={clamInstalled} detail={tools.clamscan?.version || 'Not installed'} action={!clamInstalled ? 'Install' : 'Repair'} busy={busy === 'install_clamav'} onAction={() => runFix('install_clamav')} />
                  <StatusRow title="Definition updates" ok={freshclamInstalled && (!definitionsAge || definitionsAge <= 2)} detail={definitionsNewest ? `Latest: ${new Date(definitionsNewest).toLocaleString()}` : 'Definitions not found yet'} action="Update" busy={busy === 'clamav_update_definitions'} onAction={() => runFix('clamav_update_definitions')} />
                  <StatusRow title="Updater service" ok={!tools.clamav_freshclam_service?.available || tools.clamav_freshclam_service?.ok} detail={`Service: ${tools.clamav_freshclam_service?.active || 'unknown'}`} action="Restart" busy={busy === 'clamav_restart_updates'} onAction={() => runFix('clamav_restart_updates')} />
                </section>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <section className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between gap-3">
                    <h2 className="text-white font-semibold">Findings</h2>
                    <button onClick={clearFindings} disabled={!findings.length || busy === 'clear-findings'} className="text-xs px-2 py-1 border border-gray-600 rounded text-gray-300 hover:bg-primary disabled:opacity-50">Clear</button>
                  </div>
                  {findings.length === 0 ? <div className="p-8 text-center text-gray-500 text-sm">No malware findings recorded.</div> : <div className="max-h-80 overflow-auto divide-y divide-gray-700">{findings.map((item, idx) => <div key={`${item.path}-${idx}`} className="p-4"><Badge value={item.severity || 'critical'} tone="red" /><div className="text-red-200 text-sm font-medium mt-2">{item.signature}</div><div className="text-gray-400 text-xs font-mono break-all mt-1">{item.path}</div></div>)}</div>}
                </section>
                <section className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between gap-3">
                    <h2 className="text-white font-semibold">Quarantine</h2>
                    <button onClick={clearQuarantine} disabled={!quarantineItems.length || busy === 'clear-quarantine'} className="text-xs px-2 py-1 border border-red-500/40 rounded text-red-200 hover:bg-red-500/10 disabled:opacity-50 inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Delete all</button>
                  </div>
                  {quarantineItems.length === 0 ? <div className="p-8 text-center text-gray-500 text-sm">No files in quarantine.</div> : <div className="max-h-80 overflow-auto divide-y divide-gray-700">{quarantineItems.map((item, idx) => <div key={`${item.quarantine_path}-${idx}`} className="p-4"><div className="text-yellow-200 text-sm">{item.signature}</div><div className="text-gray-400 text-xs font-mono break-all mt-1">{item.original_path}</div><div className="text-gray-500 text-xs font-mono break-all mt-1">{item.quarantine_path}</div></div>)}</div>}
                </section>
              </div>
            </div>
          )}

          {activeTab === 'threats' && (
            <div className="space-y-6">
              <section className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-white font-semibold text-lg inline-flex items-center gap-2"><Zap className="w-5 h-5 text-red-300" /> Persistence & Miner Detection</h2>
                  <p className="text-red-100/80 text-sm mt-1">Detects active miner processes, mining pool connections, malicious cron/systemd/profile entries, and immutable cron protection.</p>
                  </div>
                  <button onClick={loadThreats} className="px-3 py-2 rounded border border-red-300/40 text-red-100 text-sm inline-flex items-center gap-2 hover:bg-red-500/10">
                    <RefreshCw className="w-4 h-4" /> Rescan threats
                  </button>
                </div>
              </section>

              <section className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-700">
                  <h2 className="text-white font-semibold">Active Suspicious Processes</h2>
                  <p className="text-gray-500 text-sm mt-1">Processes matching indicators such as xmrig, c3pool, stratum pool URLs, or fake /root/.config/.logrotate.</p>
                </div>
                {asArray(threats.processes).length === 0 ? <div className="p-8 text-center text-gray-500 text-sm">No active miner-like processes detected.</div> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left min-w-[900px]">
                      <thead className="bg-primary/60 text-gray-400"><tr><th className="px-4 py-3">PID</th><th className="px-4 py-3">User</th><th className="px-4 py-3">CPU</th><th className="px-4 py-3">Command</th><th className="px-4 py-3"></th></tr></thead>
                      <tbody className="divide-y divide-gray-700/70">{asArray(threats.processes).map((p) => <tr key={p.pid}><td className="px-4 py-3 font-mono text-white">{p.pid}</td><td className="px-4 py-3 text-gray-300">{p.user}</td><td className="px-4 py-3"><Badge value={`${p.cpu}%`} tone={Number(p.cpu) > 20 ? 'red' : 'yellow'} /></td><td className="px-4 py-3 text-gray-400 font-mono text-xs break-all">{p.command}</td><td className="px-4 py-3 text-right"><button onClick={() => killThreatProcess(p.pid)} disabled={busy === `kill-${p.pid}`} className="px-2 py-1 rounded border border-red-500/40 text-red-200 hover:bg-red-500/10 disabled:opacity-50">Kill</button></td></tr>)}</tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-700 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-white font-semibold">Suspicious Persistence</h2>
                    <p className="text-gray-500 text-sm mt-1">Cron, systemd, root/home profile, tmp, and web-root files containing miner downloaders or mining pool URLs.</p>
                  </div>
                  {persistenceItems.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                        <input
                          type="checkbox"
                          checked={allPersistenceSelected}
                          onChange={(e) => {
                            const next = {}
                            if (e.target.checked) {
                              for (const item of persistenceItems) next[threatPersistenceKey(item)] = true
                            }
                            setSelectedPersistence(next)
                          }}
                        />
                        Select all
                      </label>
                      <button
                        onClick={cleanupSelectedPersistence}
                        disabled={!selectedPersistenceKeys.length || busy === 'bulk-persistence'}
                        className="px-3 py-2 rounded border border-red-500/40 text-red-200 hover:bg-red-500/10 disabled:opacity-50 text-sm"
                      >
                        {busy === 'bulk-persistence' ? 'Cleaning...' : `Clean selected (${selectedPersistenceKeys.length})`}
                      </button>
                    </div>
                  )}
                </div>
                {persistenceItems.length === 0 ? <div className="p-8 text-center text-gray-500 text-sm">No suspicious persistence lines detected.</div> : (
                  <div className="divide-y divide-gray-700/70">
                    {persistenceItems.map((item, idx) => (
                      <div key={`${item.path}-${item.line}-${idx}`} className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <label className="inline-flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={!!selectedPersistence[threatPersistenceKey(item)]}
                                onChange={(e) => setSelectedPersistence((current) => ({ ...current, [threatPersistenceKey(item)]: e.target.checked }))}
                                className="mt-0.5"
                              />
                              <span className="min-w-0">
                                <span className="block text-white font-mono text-xs break-all">{item.path}:{item.line}</span>
                                <span className="mt-2 block rounded bg-primary/60 border border-gray-700 p-2 text-red-200 text-xs font-mono break-all">{item.match}</span>
                              </span>
                            </label>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {!item.is_cleanup_backup && <button onClick={() => removeThreatLine(item)} disabled={busy === `line-${item.path}-${item.line}`} className="px-2 py-1 rounded border border-red-500/40 text-red-200 hover:bg-red-500/10 disabled:opacity-50 text-sm">Remove line</button>}
                            {(item.is_cleanup_backup || String(item.path || '').includes('/root/.config/.logrotate')) && <button onClick={() => deleteThreatFile(item.path)} disabled={busy === `file-${item.path}`} className="px-2 py-1 rounded border border-red-500/40 text-red-200 hover:bg-red-500/10 disabled:opacity-50 text-sm">{item.is_cleanup_backup ? 'Delete backup' : 'Delete file'}</button>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-700">
                  <h2 className="text-white font-semibold">Immutable Flags</h2>
                  <p className="text-gray-500 text-sm mt-1">Attackers often set chattr +i on root crontabs or miner files to prevent cleanup.</p>
                </div>
                {asArray(threats.immutable).length === 0 ? <div className="p-8 text-center text-gray-500 text-sm">No suspicious immutable flags detected.</div> : (
                  <div className="divide-y divide-gray-700/70">
                    {asArray(threats.immutable).map((item) => (
                      <div key={item.path} className="p-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-white font-mono text-sm break-all">{item.path}</div>
                          <div className="text-yellow-200 text-xs mt-1">attrs: {item.attrs} - {item.reason}</div>
                        </div>
                        <button onClick={() => removeImmutable(item.path)} disabled={busy === `immutable-${item.path}`} className="px-2 py-1 rounded border border-yellow-500/40 text-yellow-200 hover:bg-yellow-500/10 disabled:opacity-50 text-sm">Remove immutable</button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'ip' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <StatusRow title="CrowdSec agent" ok={crowdsecInstalled && tools.crowdsec_service?.ok} detail={`${tools.crowdsec?.version || tools.cscli?.version || 'Not installed'} | Service: ${tools.crowdsec_service?.active || 'unknown'}`} action={crowdsecInstalled ? 'Restart' : 'Install'} busy={busy === (crowdsecInstalled ? 'crowdsec_restart' : 'install_crowdsec')} onAction={() => runFix(crowdsecInstalled ? 'crowdsec_restart' : 'install_crowdsec')} />
                <StatusRow title="Firewall bouncer" ok={bouncerOk} detail={`${tools.crowdsec_firewall_bouncer_service?.name || 'crowdsec firewall bouncer'}: ${tools.crowdsec_firewall_bouncer_service?.active || 'unknown'}`} action="Repair" busy={busy === 'crowdsec_bouncer_restart'} onAction={() => runFix('crowdsec_bouncer_restart')} />
                <StatusRow title="Nginx/SSH collections" ok={crowdsecInstalled} detail="Installs core Linux, SSH, and Nginx detection collections." action="Apply" busy={busy === 'crowdsec_collections'} onAction={() => runFix('crowdsec_collections')} />
                <StatusRow title="HTTP 401 brute-force rule" ok={!!http401Threshold.configured || !!http401Threshold.disabled} detail={http401Threshold.message || 'Blocks repeated HTTP 401 authentication failures.'} action={crowdsecInstalled ? http401ActionLabel : ''} busy={busy === http401Action} onAction={() => runFix(http401Action)} />
              </div>
              <section className="rounded-lg border border-gray-700 bg-secondary p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-white font-semibold">Automatic SSH brute-force blocking</h2>
                    <p className="text-gray-400 text-sm mt-1">
                      {securityEnabled
                        ? `Public IPs with ${autoSshBlock.threshold || 5}+ failed SSH logins in 24 hours are blocked for ${autoSshBlock.duration || '24h'}.`
                        : 'Paused while Security protection is turned off. Existing active blocks remain in place.'}
                    </p>
                    {autoSshBlock.skipped && <p className="text-yellow-200 text-sm mt-2">{asText(autoSshBlock.skipped)}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge value={!securityEnabled ? 'paused' : autoSshBlock.enabled === false ? 'disabled' : 'enabled'} tone={!securityEnabled || autoSshBlock.enabled === false ? 'yellow' : 'green'} />
                    <Badge value={`${autoSshBlock.blocked?.length || 0} blocked last check`} tone={(autoSshBlock.blocked?.length || 0) ? 'red' : 'gray'} />
                    {autoSshBlock.checked_at && <Badge value={new Date(autoSshBlock.checked_at).toLocaleTimeString()} tone="blue" />}
                  </div>
                </div>
              </section>
              <section className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-700 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-white font-semibold text-lg inline-flex items-center gap-2"><Ban className="w-5 h-5 text-accent" /> Active IP Blocks</h2>
                    <p className="text-gray-500 text-sm mt-1">These are active CrowdSec decisions. Removing one unblocks the IP.</p>
                  </div>
                  <label className="relative w-full sm:w-80">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                    <input
                      value={blocksSearch}
                      onChange={(e) => setBlocksSearch(e.target.value)}
                      placeholder="Search IP, reason, decision..."
                      className="w-full rounded border border-gray-700 bg-primary px-9 py-2 text-sm text-white placeholder-gray-500 focus:border-accent focus:outline-none"
                    />
                  </label>
                </div>
                {tools.crowdsec_decisions?.error && <div className="mx-5 mt-5 rounded border border-yellow-500/30 bg-yellow-500/10 p-3 text-yellow-200 text-sm">{tools.crowdsec_decisions.error}</div>}
                {crowdsecDecisions.length === 0 ? <div className="p-8 text-center text-gray-500 text-sm">No active IP blocks right now.</div> : filteredDecisions.length === 0 ? <div className="p-8 text-center text-gray-500 text-sm">No IP blocks match your search.</div> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left min-w-[900px]">
                      <thead className="bg-primary/60 text-gray-400"><tr><th className="px-4 py-3">Blocked IP</th><th className="px-4 py-3">Decision</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Blocked at</th><th className="px-4 py-3">Until</th><th className="px-4 py-3"></th></tr></thead>
                      <tbody className="divide-y divide-gray-700/70">{pagedDecisions.map((item, idx) => <tr key={`${asText(item.id || item.value, idx)}-${idx}`}><td className="px-4 py-3 text-white font-mono">{item.value ? asText(item.value) : <span className="text-yellow-200">IP unavailable</span>}</td><td className="px-4 py-3 text-gray-300">#{asText(item.id)}</td><td className="px-4 py-3 text-gray-300">{asText(item.reason || item.scenario)}</td><td className="px-4 py-3 text-gray-400">{formatMaybeDate(item.blocked_at || item.created_at)}</td><td className="px-4 py-3 text-gray-400">{asText(item.until || item.duration)}</td><td className="px-4 py-3 text-right"><button onClick={() => unblockDecision(item)} disabled={busy === `unblock-${asText(item.value || item.id)}`} className="px-2 py-1 border border-gray-600 rounded text-gray-200 hover:bg-primary disabled:opacity-50">Unblock</button></td></tr>)}</tbody>
                    </table>
                    <Pager page={blocksPage} total={filteredDecisions.length} onPage={setBlocksPage} />
                  </div>
                )}
              </section>
              <section className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-700 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-white font-semibold text-lg">Recent SSH Failures</h2>
                    <p className="text-gray-500 text-sm mt-1">Last 24 hours from journald/auth logs. Repeat public IPs can be blocked immediately with CrowdSec.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={loadSshFailures} className="px-3 py-2 border border-gray-600 rounded text-white text-sm inline-flex items-center gap-2 hover:bg-primary">
                      <RefreshCw className="w-4 h-4" /> Reload
                    </button>
                    <button onClick={blockRepeatAttackers} disabled={busy === 'block-repeat-ssh' || !crowdsecInstalled} className="px-3 py-2 bg-accent rounded text-white text-sm inline-flex items-center gap-2 hover:bg-blue-600 disabled:opacity-50">
                      {busy === 'block-repeat-ssh' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                      Block repeat attackers
                    </button>
                  </div>
                </div>
                {sshFailures.errors?.length > 0 && <div className="mx-5 mt-5 rounded border border-yellow-500/30 bg-yellow-500/10 p-3 text-yellow-200 text-sm">{sshFailures.errors.map((e) => asText(e)).join(' | ')}</div>}
                <div className="px-5 py-3 text-sm text-gray-400 border-b border-gray-700">{sshFailures.total || 0} failed SSH login event(s), {sshSummary.length || 0} public source IP(s)</div>
                {!sshSummary.length ? <div className="p-8 text-center text-gray-500 text-sm">No failed SSH logins found in the current window.</div> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left min-w-[900px]">
                      <thead className="bg-primary/60 text-gray-400"><tr><th className="px-4 py-3">Source IP</th><th className="px-4 py-3">Failures</th><th className="px-4 py-3">Top users</th><th className="px-4 py-3">Last seen</th><th className="px-4 py-3">Latest log</th><th className="px-4 py-3"></th></tr></thead>
                      <tbody className="divide-y divide-gray-700/70">{pagedSshSummary.map((row) => {
                        const rowIp = asText(row.ip, '')
                        const alreadyBlocked = crowdsecDecisions.some((d) => asText(d.value, '') === rowIp)
                        return (
                          <tr key={rowIp}>
                            <td className="px-4 py-3 text-white font-mono">{rowIp}</td>
                            <td className="px-4 py-3"><Badge value={asText(row.count, '0')} tone={Number(row.count || 0) >= 5 ? 'red' : 'yellow'} /></td>
                            <td className="px-4 py-3 text-gray-300">{asArray(row.users).slice(0, 3).map((u) => `${asText(u.user, 'unknown')} (${asText(u.count, '0')})`).join(', ') || '-'}</td>
                            <td className="px-4 py-3 text-gray-400">{asText(row.last_seen)}</td>
                            <td className="px-4 py-3 text-gray-500 font-mono text-xs max-w-md truncate">{asText(row.latest_raw)}</td>
                            <td className="px-4 py-3 text-right">
                              {alreadyBlocked ? <Badge value="blocked" tone="green" /> : (
                                <button onClick={() => blockIp(rowIp, row.count)} disabled={busy === `block-${rowIp}` || !crowdsecInstalled} className="px-2 py-1 border border-gray-600 rounded text-gray-200 hover:bg-primary disabled:opacity-50">
                                  {busy === `block-${rowIp}` ? 'Blocking...' : 'Block'}
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}</tbody>
                    </table>
                    <Pager page={sshPage} total={sshSummary.length} onPage={setSshPage} />
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'fixes' && (
            <section className="rounded-lg border border-gray-700 bg-secondary p-5">
              <h2 className="text-white font-semibold text-lg mb-1">Recommended Fixes</h2>
              <p className="text-gray-500 text-sm mb-4">Ascend only runs safe repairs here: install, restart services, update definitions, and apply CrowdSec collections.</p>
              {issues.length === 0 ? <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-green-200 text-sm">No fixes needed right now.</div> : <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{issues.map((issue) => <IssueCard key={issue.title} issue={issue} onFix={runFix} busy={busy} />)}</div>}
            </section>
          )}

          {activeTab === 'logs' && <LogViewer log={log} logKind={logKind} setLogKind={setLogKind} />}
        </>
      )}
    </div>
  )
}
