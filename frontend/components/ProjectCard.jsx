import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { ExternalLink, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { apiClient } from '@/lib/api'
import { useProjects } from '@/lib/hooks/useAuth'

const STATUS_CLASS = {
  deployed: 'bg-green-500/10 text-green-400',
  deploying: 'bg-yellow-500/10 text-yellow-400',
  error: 'bg-red-500/10 text-red-400',
  created: 'bg-blue-500/10 text-blue-400',
}

export default function ProjectCard({ project }) {
  const [deleting, setDeleting] = useState(false)
  const { mutate } = useProjects()

  const handleDelete = async () => {
    if (!confirm(`Delete "${project.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await apiClient.deleteProject(project.id)
      mutate() // revalidate SWR cache — no full-page reload needed
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete project')
      setDeleting(false)
    }
  }

  const statusColor = STATUS_CLASS[project.status] || 'bg-gray-500/10 text-gray-400'

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
        <div>
          <p className="text-xs text-gray-500 mb-1">Status</p>
          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${statusColor}`}>
            {project.status}
          </span>
        </div>

        <div>
          <p className="text-xs text-gray-500 mb-1">Type</p>
          <p className="text-sm text-gray-300 capitalize">{project.project_type}</p>
        </div>

        {project.domain && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Domain</p>
            <p className="text-sm text-gray-300">{project.domain}</p>
          </div>
        )}

        {project.last_deployment && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Last Deployment</p>
            <p className="text-sm text-gray-300">
              {formatDistanceToNow(new Date(project.last_deployment), { addSuffix: true })}
            </p>
          </div>
        )}
      </div>

      <Link
        href={`/projects/${project.id}`}
        className="flex items-center gap-2 text-accent hover:text-blue-400 text-sm font-semibold transition"
      >
        View Details
        <ExternalLink className="w-4 h-4" />
      </Link>
    </div>
  )
}
