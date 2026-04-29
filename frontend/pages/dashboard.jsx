import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAuth, useProjects, useCertificates } from '@/lib/hooks/useAuth'
import { apiClient } from '@/lib/api'
import StatCard from '@/components/StatCard'
import ProjectCard from '@/components/ProjectCard'
import ServerStats from '@/components/ServerStats'
import DomainLink from '@/components/DomainLink'
import { Activity, AlertCircle, CheckCircle, Boxes, Database, ShieldCheck } from 'lucide-react'
import { absoluteLocalTime, localDate, parseApiTime } from '@/lib/time'

function certStatusClass(status) {
  if (status === 'ok') return 'bg-green-500/20 text-green-400'
  if (status === 'warning') return 'bg-yellow-500/20 text-yellow-400'
  if (status === 'critical' || status === 'expired') return 'bg-red-500/20 text-red-400'
  return 'bg-gray-500/20 text-gray-400'
}

export default function Dashboard() {
  const { user } = useAuth()
  const { projects, isLoading } = useProjects()
  const { certificates, scheduler } = useCertificates()
  const [systemAlerts, setSystemAlerts] = useState([])
  const [backupHealth, setBackupHealth] = useState([])

  useEffect(() => {
    apiClient.getSystemAlerts().then((res) => setSystemAlerts(res.data.alerts || [])).catch(() => setSystemAlerts([]))
    apiClient.getBackupHealth().then((res) => setBackupHealth(res.data.items || [])).catch(() => setBackupHealth([]))
  }, [])

  const allApps = projects.flatMap((p) => p.apps || [])
  const riskyCertificates = certificates
    .filter((c) => c.status === 'expired' || c.status === 'critical' || c.status === 'warning')
    .slice(0, 6)
  const stats = {
    projects: projects.length,
    apps: allApps.length,
    deployed: allApps.filter((a) => a.status === 'deployed').length,
    errors: allApps.filter((a) => a.status === 'error').length,
    riskyCerts: certificates.filter((c) => c.status === 'expired' || c.status === 'critical' || c.status === 'warning').length,
  }
  const backupCounts = {
    total: backupHealth.length,
    healthy: backupHealth.filter((b) => b.status === 'healthy').length,
    attention: backupHealth.filter((b) => ['failed', 'stale', 'warning'].includes(b.status)).length,
  }

  const recentApps = allApps
    .filter((a) => a.last_deployment)
    .sort((a, b) => parseApiTime(b.last_deployment) - parseApiTime(a.last_deployment))
    .slice(0, 5)

  if (!user) return <div>Loading...</div>

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-gray-400">Welcome back, {user.username}.</p>
      </div>

      {systemAlerts.length > 0 && (
        <div className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/10 overflow-hidden">
          <div className="px-5 py-3 border-b border-amber-500/20 flex items-center justify-between gap-3">
            <h2 className="text-amber-100 font-semibold flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Critical notifications
            </h2>
            <Link href="/update-center" className="text-amber-100 hover:underline text-sm font-semibold">
              View Update Center
            </Link>
          </div>
          <div className="divide-y divide-amber-500/15">
            {systemAlerts.slice(0, 5).map((alert, idx) => (
              <div key={`${alert.title}-${idx}`} className="px-5 py-3">
                <div className={alert.severity === 'critical' ? 'text-red-200 font-semibold' : 'text-amber-100 font-semibold'}>
                  {alert.title}
                </div>
                <div className="text-sm text-gray-300 mt-1">{alert.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ServerStats />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard title="Projects" value={stats.projects} icon={<Activity className="w-6 h-6" />}
          color="bg-blue-500/10 text-blue-400" />
        <StatCard title="Apps" value={stats.apps} icon={<Boxes className="w-6 h-6" />}
          color="bg-purple-500/10 text-purple-400" />
        <StatCard title="Deployed" value={stats.deployed} icon={<CheckCircle className="w-6 h-6" />}
          color="bg-green-500/10 text-green-400" />
        <StatCard title="Errors" value={stats.errors} icon={<AlertCircle className="w-6 h-6" />}
          color="bg-red-500/10 text-red-400" />
      </div>

      <div className="mb-8 bg-secondary rounded-lg border border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Database className="w-5 h-5 text-accent" />
              Backup Health
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {backupCounts.total} connection{backupCounts.total === 1 ? '' : 's'} tracked.
              {' '}{backupCounts.healthy} healthy, {backupCounts.attention} need attention.
            </p>
          </div>
          <Link href="/databases" className="text-accent hover:underline text-sm font-semibold">
            Manage backups
          </Link>
        </div>
        {backupHealth.length === 0 ? (
          <div className="px-6 py-5 text-gray-400 text-sm">No database connections yet.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 p-4">
            {backupHealth.slice(0, 6).map((row) => {
              const statusClass =
                row.status === 'healthy' ? 'border-green-500/40 bg-green-500/10 text-green-200'
                : row.status === 'running' ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
                : row.status === 'failed' ? 'border-red-500/40 bg-red-500/10 text-red-200'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
              const backupNote = row.last_backup?.error_message || row.last_schedule_error || ''
              const noteIsError = row.last_backup?.status === 'failed' || row.last_schedule_status === 'failed' || /^Backup succeeded; remote upload failed:/i.test(backupNote)
              const noteClass = noteIsError
                ? 'border-red-500/30 bg-red-500/10 text-red-200'
                : 'border-green-500/30 bg-green-500/10 text-green-200'
              return (
                <div key={row.connection.id} className="rounded border border-gray-700 bg-primary/50 p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="text-white font-semibold truncate">{row.connection.name}</div>
                      <div className="text-xs text-gray-500 truncate">{row.connection.host}:{row.connection.port}</div>
                    </div>
                    <span className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded border ${statusClass}`}>{row.status}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-gray-500">Last backup</div>
                      <div className="text-gray-200 mt-1">{row.last_backup?.completed_at ? localDate(row.last_backup.completed_at) : 'Never'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Schedules</div>
                      <div className="text-gray-200 mt-1">{row.enabled_schedule_count}/{row.schedule_count} enabled</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Recent failures</div>
                      <div className={row.recent_failed_count ? 'text-red-300 mt-1' : 'text-gray-200 mt-1'}>{row.recent_failed_count}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Last status</div>
                      <div className="text-gray-200 mt-1">{row.last_backup?.status || '-'}</div>
                    </div>
                  </div>
                  {backupNote && (
                    <div className={`mt-3 rounded border p-2 text-xs break-words ${noteClass}`}>
                      {backupNote}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="mb-8 bg-secondary rounded-lg border border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-accent" />
              SSL Report
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {certificates.length} certificate{certificates.length === 1 ? '' : 's'} found on this server.
              {' '}
              Auto renewal scheduler: {scheduler.scheduled ? 'detected' : 'not detected'}.
            </p>
          </div>
          <Link href="/system" className="text-accent hover:underline text-sm font-semibold">
            View all
          </Link>
        </div>
        {certificates.length === 0 ? (
          <div className="px-6 py-5 text-gray-400 text-sm">No Let&apos;s Encrypt certificates found yet.</div>
        ) : riskyCertificates.length === 0 ? (
          <div className="px-6 py-5 text-green-400 text-sm">
            All detected certificates are outside the 30-day warning window.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-primary text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-6 py-3 text-left">Domain</th>
                <th className="px-6 py-3 text-left">Expires</th>
                <th className="px-6 py-3 text-left">Auto renew</th>
                <th className="px-6 py-3 text-left">Owner</th>
              </tr>
            </thead>
            <tbody>
              {riskyCertificates.map((cert) => (
                <tr key={cert.name} className="border-t border-gray-700">
                  <td className="px-6 py-3">
                    <div className="font-medium">
                      <DomainLink domain={cert.primary_domain} className="text-white hover:text-accent" />
                    </div>
                    <div className="text-xs text-gray-500">{cert.name}</div>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${certStatusClass(cert.status)}`}>
                      {cert.days_remaining == null
                        ? 'unknown'
                        : cert.days_remaining < 0
                        ? 'expired'
                        : `${cert.days_remaining}d left`}
                    </span>
                    <div className="text-xs text-gray-500 mt-1">{absoluteLocalTime(cert.expires_at)}</div>
                  </td>
                  <td className="px-6 py-3 text-sm">
                    {cert.auto_renewable ? (
                      <span className="text-green-400">yes</span>
                    ) : (
                      <span className="text-yellow-400">check needed</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-gray-300 text-sm">
                    {cert.managed_by_ascend ? 'Ascend app' : 'Server-level'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mb-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">Projects</h2>
          <Link
            href="/projects/new"
            className="px-4 py-2 bg-accent hover:bg-blue-600 text-white rounded-lg font-semibold transition"
          >
            + New Project
          </Link>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full spinner mx-auto mb-4"></div>
            <p className="text-gray-400">Loading projects…</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="bg-secondary rounded-lg p-12 text-center border border-gray-700">
            <p className="text-gray-400 mb-4">No projects yet</p>
            <Link
              href="/projects/new"
              className="inline-block px-6 py-2 bg-accent hover:bg-blue-600 text-white rounded-lg font-semibold transition"
            >
              Create Your First Project
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>

      {recentApps.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold text-white mb-6">Recent Deployments</h2>
          <div className="bg-secondary rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700 bg-primary/50">
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">App</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentApps.map((a) => (
                  <tr key={a.id} className="border-b border-gray-700 hover:bg-primary/50 transition">
                    <td className="px-6 py-3">
                      <Link href={`/app/${a.id}`} className="text-accent hover:underline font-medium">
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          a.status === 'deployed'
                            ? 'bg-green-500/20 text-green-400'
                            : a.status === 'deploying'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-400 text-sm">
                      {localDate(a.last_deployment)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
