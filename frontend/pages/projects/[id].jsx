import { useState } from 'react'
import { useRouter } from 'next/router'
import { useProject } from '@/lib/hooks/useAuth'
import DeploymentForm from '@/components/DeploymentForm'
import DeploymentLogs from '@/components/DeploymentLogs'
import ProjectSettings from '@/components/ProjectSettings'

export default function ProjectDetail() {
  const router = useRouter()
  const { id } = router.query
  const { project, isLoading } = useProject(id)
  const [activeTab, setActiveTab] = useState('overview')

  if (!id) return null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full spinner mx-auto mb-4"></div>
          <p className="text-gray-400">Loading project...</p>
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

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <h1 className="text-4xl font-bold text-white">{project.name}</h1>
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold ${
              project.status === 'deployed'
                ? 'bg-green-500/20 text-green-400'
                : project.status === 'deploying'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-red-500/20 text-red-400'
            }`}
          >
            {project.status}
          </span>
        </div>
        <p className="text-gray-400">{project.description}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-8 border-b border-gray-700">
        {['overview', 'deployments', 'settings'].map((tab) => (
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

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="bg-secondary rounded-lg border border-gray-700 p-6">
              <h2 className="text-xl font-bold text-white mb-4">Project Information</h2>
              <div className="space-y-4">
                <div>
                  <p className="text-gray-400 text-sm">GitHub URL</p>
                  <p className="text-white font-mono">{project.github_url}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Branch</p>
                  <p className="text-white">{project.github_branch}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Type</p>
                  <p className="text-white capitalize">{project.project_type}</p>
                </div>
                {project.domain && (
                  <div>
                    <p className="text-gray-400 text-sm">Domain</p>
                    <p className="text-white">{project.domain}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <DeploymentForm projectId={project.id} />
          </div>
        </div>
      )}

      {activeTab === 'deployments' && (
        <DeploymentLogs projectId={project.id} />
      )}

      {activeTab === 'settings' && (
        <ProjectSettings project={project} />
      )}
    </div>
  )
}
