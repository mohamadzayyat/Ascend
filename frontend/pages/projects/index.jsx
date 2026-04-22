import { useState } from 'react'
import Link from 'next/link'
import { useProjects } from '@/lib/hooks/useAuth'
import ProjectCard from '@/components/ProjectCard'

export default function ProjectsList() {
  const { projects, isLoading, mutate } = useProjects()
  const [search, setSearch] = useState('')

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Projects</h1>
          <p className="text-gray-400">Manage all your deployments</p>
        </div>
        <Link
          href="/projects/new"
          className="px-6 py-2 bg-accent hover:bg-blue-600 text-white font-semibold rounded-lg transition"
        >
          + New Project
        </Link>
      </div>

      {/* Search */}
      <div className="mb-8">
        <input
          type="text"
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-2 rounded-lg bg-secondary border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {/* Projects Grid */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full spinner mx-auto mb-4"></div>
          <p className="text-gray-400">Loading projects...</p>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="bg-secondary rounded-lg p-12 text-center border border-gray-700">
          <p className="text-gray-400 mb-4">
            {projects.length === 0 ? 'No projects yet' : 'No matching projects'}
          </p>
          {projects.length === 0 && (
            <Link
              href="/projects/new"
              className="inline-block px-6 py-2 bg-accent hover:bg-blue-600 text-white rounded-lg font-semibold transition"
            >
              Create Your First Project
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  )
}
