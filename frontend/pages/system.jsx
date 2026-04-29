import { useEffect, useMemo, useState } from 'react'
import { useSystem, useProjects } from '@/lib/hooks/useAuth'
import { apiClient } from '@/lib/api'
import { absoluteLocalTime } from '@/lib/time'

function formatUptime(ms) {
  if (!ms || ms <= 0) return '-'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m`
  return `${s}s`
}

function formatBytes(bytes) {
  const value = Number(bytes || 0)
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let idx = 0
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024
    idx += 1
  }
  return `${size >= 10 || idx === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[idx]}`
}

function formatRuntime(seconds) {
  return formatUptime(Number(seconds || 0) * 1000)
}

function CpuBars({ values = [] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
      {values.map((value, idx) => {
        const pct = Math.max(0, Math.min(100, Number(value || 0)))
        const color = pct > 85 ? 'bg-red-400' : pct > 60 ? 'bg-yellow-400' : 'bg-accent'
        return (
          <div key={idx} className="flex items-center gap-2 text-xs">
            <span className="w-7 text-gray-500 font-mono">{idx}</span>
            <div className="h-2 flex-1 rounded bg-primary overflow-hidden">
              <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="w-12 text-right text-gray-300 font-mono">{pct.toFixed(1)}%</span>
          </div>
        )
      })}
    </div>
  )
}

function ProcessesTab() {
  const [monitor, setMonitor] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [paused, setPaused] = useState(false)

  const load = async () => {
    try {
      const { data } = await apiClient.getProcessMonitor(120)
      setMonitor(data)
      setError('')
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load process monitor')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (paused) return undefined
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [paused])

  const summary = monitor?.summary || {}
  const cpu = summary.cpu || {}
  const memory = summary.memory || {}
  const swap = summary.swap || {}
  const loadAverage = summary.load_average || {}
  const processes = (monitor?.processes || []).filter((p) => {
    const q = filter.trim().toLowerCase()
    if (!q) return true
    return [p.pid, p.user, p.status, p.name, p.command].some((value) => String(value || '').toLowerCase().includes(q))
  })

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <section className="xl:col-span-2 bg-secondary border border-gray-700 rounded-lg p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-xl font-bold text-white">Live Process Monitor</h2>
              <p className="text-sm text-gray-400 mt-1">htop-style view refreshed every 2 seconds.</p>
            </div>
            <button onClick={() => setPaused((v) => !v)} className="px-3 py-2 rounded border border-gray-600 text-gray-200 text-sm hover:bg-primary">
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
          <CpuBars values={cpu.per_cpu || []} />
        </section>
        <section className="bg-secondary border border-gray-700 rounded-lg p-5">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-gray-500">Load</div>
              <div className="text-white font-mono mt-1">{[loadAverage['1m'], loadAverage['5m'], loadAverage['15m']].filter((v) => v !== undefined).map((v) => Number(v).toFixed(2)).join('  ') || '-'}</div>
            </div>
            <div>
              <div className="text-gray-500">Uptime</div>
              <div className="text-white font-mono mt-1">{formatRuntime(summary.uptime_seconds)}</div>
            </div>
            <div>
              <div className="text-gray-500">Memory</div>
              <div className="text-white font-mono mt-1">{formatBytes(memory.used)} / {formatBytes(memory.total)}</div>
            </div>
            <div>
              <div className="text-gray-500">Swap</div>
              <div className="text-white font-mono mt-1">{formatBytes(swap.used)} / {formatBytes(swap.total)}</div>
            </div>
            <div>
              <div className="text-gray-500">Tasks</div>
              <div className="text-white font-mono mt-1">{monitor?.total_processes ?? summary.process_count ?? '-'}</div>
            </div>
            <div>
              <div className="text-gray-500">CPU</div>
              <div className="text-white font-mono mt-1">{Number(cpu.percent || 0).toFixed(1)}%</div>
            </div>
          </div>
        </section>
      </div>

      <section className="bg-secondary border border-gray-700 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-white font-semibold">Processes</h2>
            <p className="text-gray-500 text-xs mt-1">{loading ? 'Loading...' : `Showing ${processes.length} of ${monitor?.total_processes || 0}`}</p>
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter PID, user, command..."
            className="w-full sm:w-80 px-3 py-2 rounded border border-gray-600 bg-primary text-sm text-white"
          />
        </div>
        {error && <div className="m-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-primary text-gray-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">PID</th>
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">State</th>
                <th className="text-left px-4 py-3">CPU</th>
                <th className="text-left px-4 py-3">Mem</th>
                <th className="text-left px-4 py-3">RSS</th>
                <th className="text-left px-4 py-3">Threads</th>
                <th className="text-left px-4 py-3">Time</th>
                <th className="text-left px-4 py-3">Command</th>
              </tr>
            </thead>
            <tbody>
              {processes.map((p) => (
                <tr key={p.pid} className="border-t border-gray-700 hover:bg-primary/40">
                  <td className="px-4 py-3 text-white font-mono">{p.pid}</td>
                  <td className="px-4 py-3 text-gray-300 font-mono">{p.user || '-'}</td>
                  <td className="px-4 py-3 text-gray-300">{p.status || '-'}</td>
                  <td className={Number(p.cpu_percent || 0) > 50 ? 'px-4 py-3 text-red-300 font-mono' : 'px-4 py-3 text-gray-300 font-mono'}>{Number(p.cpu_percent || 0).toFixed(1)}%</td>
                  <td className="px-4 py-3 text-gray-300 font-mono">{Number(p.memory_percent || 0).toFixed(2)}%</td>
                  <td className="px-4 py-3 text-gray-300 font-mono">{formatBytes(p.rss_bytes)}</td>
                  <td className="px-4 py-3 text-gray-300 font-mono">{p.threads ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-300 font-mono">{formatRuntime(p.runtime_seconds)}</td>
                  <td className="px-4 py-3 text-gray-300 font-mono text-xs break-all">{p.command || p.name || '-'}</td>
                </tr>
              ))}
              {!loading && processes.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">No processes match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function StatusBadge({ status }) {
  const cls =
    status === 'online'
      ? 'bg-green-500/20 text-green-400'
      : status === 'stopped' || status === 'stopping'
      ? 'bg-gray-500/20 text-gray-400'
      : status === 'errored'
      ? 'bg-red-500/20 text-red-400'
      : 'bg-yellow-500/20 text-yellow-400'
  return <span className={`px-2 py-1 rounded text-xs font-semibold ${cls}`}>{status || 'unknown'}</span>
}

function CertBadge({ status }) {
  const cls =
    status === 'ok'
      ? 'bg-green-500/20 text-green-400'
      : status === 'warning'
      ? 'bg-yellow-500/20 text-yellow-400'
      : status === 'critical' || status === 'expired'
      ? 'bg-red-500/20 text-red-400'
      : 'bg-gray-500/20 text-gray-400'
  return <span className={`px-2 py-1 rounded text-xs font-semibold ${cls}`}>{status || 'unknown'}</span>
}

function KpiCard({ title, value, subtitle, accent, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-secondary border border-gray-700 rounded-lg p-5 hover:border-gray-500 hover:bg-primary/40 transition"
    >
      <div className="text-sm text-gray-400 mb-2">{title}</div>
      <div className={`text-3xl font-bold ${accent}`}>{value}</div>
      <div className="text-sm text-gray-500 mt-2">{subtitle}</div>
    </button>
  )
}

export default function System() {
  const { pm2, ports, nginxSites, certificates, certificateScheduler, isLoading } = useSystem()
  const { projects } = useProjects()
  const [activeTab, setActiveTab] = useState('overview')

  const allApps = useMemo(() => projects.flatMap((p) => p.apps || []), [projects])
  const managed = useMemo(
    () => new Set(allApps.filter((a) => a.pm2_name).map((a) => a.pm2_name)),
    [allApps]
  )
  const ascendPorts = useMemo(
    () => new Set(allApps.filter((a) => a.app_port).map((a) => a.app_port)),
    [allApps]
  )

  const stats = useMemo(() => ({
    pm2: pm2.length,
    unmanagedPm2: pm2.filter((p) => !managed.has(p.name)).length,
    ports: ports.length,
    ascendPortsCount: ports.filter((p) => ascendPorts.has(p.port)).length,
    certificates: certificates.length,
    expiringCertificates: certificates.filter((c) => ['warning', 'critical', 'expired'].includes(c.status)).length,
    nginxSites: nginxSites.length,
    sslSites: nginxSites.filter((s) => s.ssl).length,
  }), [pm2, managed, ports, ascendPorts, certificates, nginxSites])

  const jumpTo = (id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">System</h1>
        <p className="text-gray-400">
          Read-only view of everything running on this server: PM2 processes, listening ports, SSL certificates, and Nginx sites.
        </p>
      </div>

      <div className="mb-8 border-b border-gray-700 flex flex-wrap gap-6">
        {[
          ['overview', 'Overview'],
          ['processes', 'Processes'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`pb-3 text-sm font-medium border-b-2 transition ${activeTab === key ? 'border-accent text-white' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'processes' ? (
        <ProcessesTab />
      ) : (
        <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <KpiCard
          title="PM2"
          value={stats.pm2}
          subtitle={`${stats.unmanagedPm2} unmanaged`}
          accent="text-green-400"
          onClick={() => jumpTo('system-pm2')}
        />
        <KpiCard
          title="Ports"
          value={stats.ports}
          subtitle={`${stats.ascendPortsCount} mapped to Ascend`}
          accent="text-blue-400"
          onClick={() => jumpTo('system-ports')}
        />
        <KpiCard
          title="SSL"
          value={stats.certificates}
          subtitle={`${stats.expiringCertificates} need attention`}
          accent={stats.expiringCertificates > 0 ? 'text-yellow-400' : 'text-emerald-400'}
          onClick={() => jumpTo('system-ssl')}
        />
        <KpiCard
          title="Nginx"
          value={stats.nginxSites}
          subtitle={`${stats.sslSites} with SSL`}
          accent="text-cyan-400"
          onClick={() => jumpTo('system-nginx')}
        />
      </div>

      <section id="system-pm2" className="mb-10 scroll-mt-6">
        <h2 className="text-xl font-bold text-white mb-4">
          PM2 Processes <span className="text-gray-500 text-sm font-normal">({pm2.length})</span>
        </h2>
        <div className="bg-secondary rounded-lg border border-gray-700 overflow-hidden">
          {isLoading && pm2.length === 0 ? (
            <div className="p-6 text-gray-400">Loading...</div>
          ) : pm2.length === 0 ? (
            <div className="p-6 text-gray-400">No PM2 processes found. Is PM2 installed and running as root?</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-primary text-gray-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Port</th>
                  <th className="text-left px-4 py-3">CPU</th>
                  <th className="text-left px-4 py-3">Memory</th>
                  <th className="text-left px-4 py-3">Uptime</th>
                  <th className="text-left px-4 py-3">Restarts</th>
                  <th className="text-left px-4 py-3">Managed by</th>
                </tr>
              </thead>
              <tbody>
                {pm2.map((p) => (
                  <tr key={p.name} className="border-t border-gray-700">
                    <td className="px-4 py-3 text-white font-mono">{p.name}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3 text-gray-300">{p.port || '-'}</td>
                    <td className="px-4 py-3 text-gray-300">{p.cpu}%</td>
                    <td className="px-4 py-3 text-gray-300">{p.memory_mb} MB</td>
                    <td className="px-4 py-3 text-gray-300">{formatUptime(p.uptime_ms)}</td>
                    <td className="px-4 py-3 text-gray-300">{p.restarts}</td>
                    <td className="px-4 py-3">
                      {managed.has(p.name) ? (
                        <span className="text-green-400 text-xs">Ascend</span>
                      ) : (
                        <span className="text-yellow-400 text-xs">Unmanaged</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section id="system-ports" className="mb-10 scroll-mt-6">
        <h2 className="text-xl font-bold text-white mb-4">
          Listening Ports <span className="text-gray-500 text-sm font-normal">({ports.length})</span>
        </h2>
        <div className="bg-secondary rounded-lg border border-gray-700 overflow-hidden">
          {ports.length === 0 ? (
            <div className="p-6 text-gray-400">No TCP listeners detected.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-primary text-gray-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Port</th>
                  <th className="text-left px-4 py-3">Bound to</th>
                  <th className="text-left px-4 py-3">Process</th>
                  <th className="text-left px-4 py-3">PID</th>
                  <th className="text-left px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {ports.map((p) => (
                  <tr key={p.port} className="border-t border-gray-700">
                    <td className="px-4 py-3 text-white font-mono">{p.port}</td>
                    <td className="px-4 py-3 text-gray-300 font-mono">{p.address}</td>
                    <td className="px-4 py-3 text-gray-300">{p.process || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono">{p.pid ?? '-'}</td>
                    <td className="px-4 py-3 text-xs">
                      {ascendPorts.has(p.port) && <span className="text-green-400">Ascend project</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section id="system-ssl" className="mb-10 scroll-mt-6">
        <h2 className="text-xl font-bold text-white mb-4">
          SSL Certificates <span className="text-gray-500 text-sm font-normal">({certificates.length})</span>
        </h2>
        <div className="bg-secondary rounded-lg border border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 text-sm text-gray-400">
            Certbot auto-renewal scheduler:{' '}
            {certificateScheduler.scheduled ? (
              <span className="text-green-400">detected</span>
            ) : (
              <span className="text-yellow-400">not detected</span>
            )}
            {certificateScheduler.methods?.length > 0 && (
              <span className="text-gray-500"> ({certificateScheduler.methods.map((m) => m.name).join(', ')})</span>
            )}
          </div>
          {certificates.length === 0 ? (
            <div className="p-6 text-gray-400">No Let&apos;s Encrypt certificates found in /etc/letsencrypt/live.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-primary text-gray-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Certificate</th>
                  <th className="text-left px-4 py-3">Domains</th>
                  <th className="text-left px-4 py-3">Expires</th>
                  <th className="text-left px-4 py-3">Renewal</th>
                  <th className="text-left px-4 py-3">Used by</th>
                </tr>
              </thead>
              <tbody>
                {certificates.map((cert) => (
                  <tr key={cert.name} className="border-t border-gray-700 align-top">
                    <td className="px-4 py-3">
                      <div className="text-white font-mono">{cert.name}</div>
                      <div className="mt-2"><CertBadge status={cert.status} /></div>
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      {cert.domains?.length ? cert.domains.join(', ') : cert.primary_domain}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-200">{absoluteLocalTime(cert.expires_at)}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {cert.days_remaining == null
                          ? 'unknown'
                          : cert.days_remaining < 0
                          ? `${Math.abs(cert.days_remaining)}d expired`
                          : `${cert.days_remaining}d remaining`}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {cert.auto_renewable ? (
                        <span className="text-green-400 text-xs font-semibold">auto-renewable</span>
                      ) : cert.certbot_managed ? (
                        <span className="text-yellow-400 text-xs font-semibold">config exists, scheduler missing</span>
                      ) : (
                        <span className="text-red-400 text-xs font-semibold">not certbot-managed</span>
                      )}
                      <div className="text-xs text-gray-500 mt-1">
                        {cert.renewal_config?.authenticator || 'unknown authenticator'}
                        {cert.renewal_config?.installer ? ` / ${cert.renewal_config.installer}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {cert.managed_by_ascend ? (
                        <div className="text-green-400">
                          {cert.apps.map((a) => `${a.project_name} / ${a.app_name}`).join(', ')}
                        </div>
                      ) : (
                        <div className="text-yellow-400">Unmanaged by Ascend</div>
                      )}
                      {cert.nginx_sites?.length > 0 && (
                        <div className="text-gray-500 mt-1">Nginx: {cert.nginx_sites.join(', ')}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section id="system-nginx" className="mb-10 scroll-mt-6">
        <h2 className="text-xl font-bold text-white mb-4">
          Nginx Sites <span className="text-gray-500 text-sm font-normal">({nginxSites.length})</span>
        </h2>
        <div className="bg-secondary rounded-lg border border-gray-700 overflow-hidden">
          {nginxSites.length === 0 ? (
            <div className="p-6 text-gray-400">No sites enabled in /etc/nginx/sites-enabled.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-primary text-gray-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Server names</th>
                  <th className="text-left px-4 py-3">Listens</th>
                  <th className="text-left px-4 py-3">Proxies to</th>
                  <th className="text-left px-4 py-3">SSL</th>
                </tr>
              </thead>
              <tbody>
                {nginxSites.map((s) => (
                  <tr key={s.name} className="border-t border-gray-700">
                    <td className="px-4 py-3 text-white font-mono">{s.name}</td>
                    <td className="px-4 py-3 text-gray-300">
                      {s.server_names.length ? s.server_names.join(', ') : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-300 font-mono">{s.listen_ports.join(', ') || '-'}</td>
                    <td className="px-4 py-3 text-gray-300 font-mono text-xs">
                      {s.proxy_targets.length ? s.proxy_targets.join(', ') : '-'}
                    </td>
                    <td className="px-4 py-3">
                      {s.ssl ? (
                        <span className="text-green-400 text-xs font-semibold">YES</span>
                      ) : (
                        <span className="text-gray-500 text-xs">no</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <p className="text-gray-500 text-sm">
        Data refreshes automatically: PM2 every 5s, ports every 10s, Nginx every 30s, SSL certificates every 60s.
      </p>
        </>
      )}
    </div>
  )
}
