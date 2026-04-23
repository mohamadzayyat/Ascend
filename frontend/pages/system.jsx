import { useMemo } from 'react'
import { useSystem, useProjects } from '@/lib/hooks/useAuth'
import { absoluteLocalTime } from '@/lib/time'

function formatUptime(ms) {
  if (!ms || ms <= 0) return '—'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m`
  return `${s}s`
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
  return (
    <span className={`px-2 py-1 rounded text-xs font-semibold ${cls}`}>{status || 'unknown'}</span>
  )
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

export default function System() {
  const { pm2, ports, nginxSites, certificates, certificateScheduler, isLoading } = useSystem()
  const { projects } = useProjects()

  // Set of pm2 process names / ports already managed by an Ascend app
  const allApps = useMemo(() => projects.flatMap((p) => p.apps || []), [projects])
  const managed = useMemo(
    () => new Set(allApps.filter((a) => a.pm2_name).map((a) => a.pm2_name)),
    [allApps]
  )
  const ascendPorts = useMemo(
    () => new Set(allApps.filter((a) => a.app_port).map((a) => a.app_port)),
    [allApps]
  )

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">System</h1>
        <p className="text-gray-400">
          Read-only view of everything running on this server — PM2 processes, listening ports, and Nginx sites.
        </p>
      </div>

      {/* PM2 Processes */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-white mb-4">
          PM2 Processes <span className="text-gray-500 text-sm font-normal">({pm2.length})</span>
        </h2>
        <div className="bg-secondary rounded-lg border border-gray-700 overflow-hidden">
          {isLoading && pm2.length === 0 ? (
            <div className="p-6 text-gray-400">Loading…</div>
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
                    <td className="px-4 py-3 text-gray-300">{p.port || '—'}</td>
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

      {/* Listening Ports */}
      <section className="mb-10">
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
                    <td className="px-4 py-3 text-gray-300">{p.process || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono">{p.pid ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      {ascendPorts.has(p.port) && (
                        <span className="text-green-400">Ascend project</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* SSL Certificates */}
      <section className="mb-10">
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
              <span className="text-gray-500">
                {' '}({certificateScheduler.methods.map((m) => m.name).join(', ')})
              </span>
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

      {/* Nginx Sites */}
      <section className="mb-10">
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
                      {s.server_names.length ? s.server_names.join(', ') : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-300 font-mono">{s.listen_ports.join(', ') || '—'}</td>
                    <td className="px-4 py-3 text-gray-300 font-mono text-xs">
                      {s.proxy_targets.length ? s.proxy_targets.join(', ') : '—'}
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
    </div>
  )
}
