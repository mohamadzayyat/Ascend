import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { ArrowLeft, Play } from 'lucide-react'
import { apiClient } from '@/lib/api'
import { useApp, useProject } from '@/lib/hooks/useAuth'
import AppRuntime from '@/components/AppRuntime'
import AppSettings from '@/components/AppSettings'
import DeploymentLogs from '@/components/DeploymentLogs'

const STATUS_CLASS = {
  deployed: 'bg-green-500/20 text-green-400',
  deploying: 'bg-yellow-500/20 text-yellow-400',
  error: 'bg-red-500/20 text-red-400',
  created: 'bg-blue-500/20 text-blue-400',
}

export default function AppDetail() {
  const router = useRouter()
  const { id, tab } = router.query
  const { app, isLoading, mutate } = useApp(id)
  const { project } = useProject(app?.project_id)

  const [activeTab, setActiveTab] = useState('overview')
  const [deploying, setDeploying] = useState(false)
  const [deployError, setDeployError] = useState('')

  useEffect(() => {
    if (tab && ['overview', 'deployments', 'settings'].includes(tab)) {
      setActiveTab(tab)
    }
  }, [tab])

  if (!id) return null
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full spinner mx-auto mb-4" />
          <p className="text-gray-400">Loading app…</p>
        </div>
      </div>
    )
  }
  if (!app) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-400">App not found</p>
      </div>
    )
  }

  const statusClass = STATUS_CLASS[app.status] || 'bg-gray-500/20 text-gray-400'

  const deploy = async () => {
    setDeploying(true)
    setDeployError('')
    try {
      await apiClient.deployApp(app.id)
      mutate()
      setActiveTab('deployments')
    } catch (err) {
      setDeployError(err.response?.data?.error || 'Failed to start deployment')
    } finally {
      setDeploying(false)
    }
  }

  return (
    <div className="p-8">
      <Link
        href={`/projects/${app.project_id}`}
        className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-6 text-sm"
      >
        <ArrowLeft className="w-4 h-4" /> Back to {project?.name || 'project'}
      </Link>

      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-4xl font-bold text-white">{app.name}</h1>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusClass}`}>
                {app.status}
              </span>
            </div>
            <p className="text-gray-400 capitalize">
              {app.app_type}{app.subdirectory ? ` · ${app.subdirectory}` : ''}
              {app.app_port ? ` · port ${app.app_port}` : ''}
            </p>
          </div>
          <button
            onClick={deploy}
            disabled={deploying || app.status === 'deploying'}
            className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-blue-600 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="w-4 h-4" />
            {app.status === 'deploying' ? 'Deploying…' : deploying ? 'Starting…' : 'Deploy'}
          </button>
        </div>
        {deployError && <p className="text-red-400 text-sm mt-3">{deployError}</p>}
      </div>

      <div className="flex gap-4 mb-8 border-b border-gray-700">
        {['overview', 'deployments', 'settings'].map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 font-semibold transition ${
              activeTab === t
                ? 'text-accent border-b-2 border-accent'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <AppRuntime appId={app.id} />
          <div className="bg-secondary rounded-lg border border-gray-700 p-6">
            <h2 className="text-xl font-bold text-white mb-4">Build Config</h2>
            <dl className="space-y-3 text-sm">
              <Row label="Package manager" value={app.package_manager} />
              <Row label="Build command" value={app.build_command} mono />
              <Row label="Start command" value={app.start_command} mono />
              <Row label="PM2 name" value={app.pm2_name} mono />
              <Row label="Subdirectory" value={app.subdirectory || '— (repo root)'} mono />
            </dl>
          </div>
        </div>
      )}

      {activeTab === 'deployments' && (
        <DeploymentLogs appId={app.id} />
      )}

      {activeTab === 'settings' && (
        <AppSettings app={app} onUpdate={() => mutate()} />
      )}
    </div>
  )
}

function Row({ label, value, mono }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-400 shrink-0">{label}</dt>
      <dd className={`text-right text-gray-200 truncate ${mono ? 'font-mono text-xs' : ''}`}>
        {value || '—'}
      </dd>
    </div>
  )
}
