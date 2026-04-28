import Link from 'next/link'
import { ExternalLink, Trash2, GitBranch, Boxes } from 'lucide-react'
import { useState } from 'react'
import { apiClient } from '@/lib/api'
import { useProjects } from '@/lib/hooks/useAuth'
import { typedConfirm } from '@/lib/confirm'

export default function ProjectCard({ project }) {
  const [deleting, setDeleting] = useState(false)
  const { mutate } = useProjects()

  const handleDelete = async () => {
    if (!typedConfirm(`Delete "${project.name}" and all its apps? This cannot be undone.`, project.name)) return
    setDeleting(true)
    try {
      await apiClient.deleteProject(project.id, project.name)
      mutate()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete project')
      setDeleting(false)
    }
  }

  const apps = project.apps || []
  const deployedApps = apps.filter((a) => a.status === 'deployed').length
  const erroredApps = apps.filter((a) => a.status === 'error').length

  return (
    <div className="bg-secondary rounded-lg border border-gray-700 p-6 hover:border-accent transition group">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <Link href={`/projects/${project.id}`}>
            <h3 className="text-lg font-bold text-white group-hover:text-accent transition cursor-pointer truncate">
              {project.name}
            </h3>
          </Link>
          <p className="text-gray-400 text-sm mt-1 line-clamp-2">
            {project.description || 'No description'}
          </p>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="p-2 ml-2 flex-shrink-0 hover:bg-red-500/10 rounded-lg text-gray-400 hover:text-red-400 transition disabled:opacity-50"
          title="Delete project"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-3 mb-4">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <GitBranch className="w-4 h-4" />
          <span className="font-mono truncate">{project.github_branch || 'main'}</span>
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Boxes className="w-4 h-4" />
          <span>
            {apps.length} {apps.length === 1 ? 'app' : 'apps'}
            {deployedApps > 0 && <span className="text-green-400 ml-2">{deployedApps} deployed</span>}
            {erroredApps > 0 && <span className="text-red-400 ml-2">{erroredApps} error</span>}
          </span>
        </div>

        {project.auto_deploy && (
          <div>
            <span className="inline-block px-2 py-1 rounded text-xs font-semibold bg-accent/10 text-accent">
              Auto-deploy on push
            </span>
          </div>
        )}
      </div>

      <Link
        href={`/projects/${project.id}`}
        className="flex items-center gap-2 text-accent hover:text-blue-400 text-sm font-semibold transition"
      >
        Open Project
        <ExternalLink className="w-4 h-4" />
      </Link>
    </div>
  )
}
