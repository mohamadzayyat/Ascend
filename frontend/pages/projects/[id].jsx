import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { Plus, Play } from 'lucide-react'
import { apiClient, projectFileApi } from '@/lib/api'
import { useProject, useProjects } from '@/lib/hooks/useAuth'
import AppCard from '@/components/AppCard'
import AppFileManager from '@/components/AppFileManager'
import DeploymentLogs from '@/components/DeploymentLogs'
import DiskUsage from '@/components/DiskUsage'
import ProjectSettings from '@/components/ProjectSettings'

export default function ProjectDetail() {
  const router = useRouter()
  const { id } = router.query
  const { project, isLoading, mutate } = useProject(id)
  const { mutate: mutateAll } = useProjects()
  const [activeTab, setActiveTab] = useState('apps')
  const [deployingAll, setDeployingAll] = useState(false)
  const [deployError, setDeployError] = useState('')
  const fileApi = useMemo(() => (id ? projectFileApi(id) : null), [id])

  if (!id) return null
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full spinner mx-auto mb-4" />
          <p className="text-gray-400">Loading project…</p>
        </div>
      </div>
    )
  }
  if (!project) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-400">Project not found</p>
      </div>
    )
  }

  const apps = project.apps || []

  const deployAll = async () => {
    if (!apps.length) return
    setDeployingAll(true)
    setDeployError('')
    try {
      await apiClient.deploy(project.id)
      mutate()
      mutateAll()
    } catch (err) {
      setDeployError(err.response?.data?.error || 'Failed to deploy')
    } finally {
      setDeployingAll(false)
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">{project.name}</h1>
            <p className="text-gray-400">{project.description}</p>
            <p className="text-gray-500 text-sm mt-2 font-mono">
              {project.github_url} · {project.github_branch}
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href={`/projects/${project.id}/apps/new`}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-gray-700 border border-gray-600 text-white font-semibold rounded-lg transition"
            >
              <Plus className="w-4 h-4" /> Add App
            </Link>
            {apps.length > 0 && (
              <button
                onClick={deployAll}
                disabled={deployingAll}
                className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-blue-600 text-white font-semibold rounded-lg transition disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                {deployingAll ? 'Starting…' : 'Deploy All'}
              </button>
            )}
          </div>
        </div>
        {deployError && (
          <p className="text-red-400 text-sm mt-3">{deployError}</p>
        )}
        {apps.length > 0 && (
          <div className="mt-4">
            <DiskUsage
              label="Project size"
              bytes={project.disk_size_bytes}
              computedAt={project.disk_size_computed_at}
              missing={project.disk_size_missing}
              onRecalculate={async () => {
                await apiClient.recalcProjectSize(project.id)
                mutate()
              }}
            />
          </div>
        )}
      </div>

      <div className="flex gap-4 mb-8 border-b border-gray-700">
        {['apps', 'deployments', 'files', 'settings'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-semibold transition ${
              activeTab === tab
                ? 'text-accent border-b-2 border-accent'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'apps' && (
        <div>
          {apps.length === 0 ? (
            <div className="bg-secondary rounded-lg border border-dashed border-gray-700 p-12 text-center">
              <p className="text-gray-400 mb-4">No apps in this project yet.</p>
              <Link
                href={`/projects/${project.id}/apps/new`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-blue-600 text-white font-semibold rounded-lg transition"
              >
                <Plus className="w-4 h-4" /> Add First App
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {apps.map((a) => (
                <AppCard key={a.id} app={a} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'deployments' && (
        <DeploymentLogs projectId={project.id} />
      )}

      {activeTab === 'files' && fileApi && (
        <AppFileManager api={fileApi} />
      )}

      {activeTab === 'settings' && (
        <ProjectSettings project={project} onUpdate={() => mutate()} />
      )}
    </div>
  )
}
