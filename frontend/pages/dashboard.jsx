import { useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth, useProjects } from '@/lib/hooks/useAuth'
import StatCard from '@/components/StatCard'
import ProjectCard from '@/components/ProjectCard'
import { Activity, AlertCircle, CheckCircle, Clock } from 'lucide-react'

export default function Dashboard() {
  const router = useRouter()
  const { user } = useAuth()
  const { projects, isLoading } = useProjects()

  useEffect(() => {
    if (!user && !isLoading) {
      router.push('/login')
    }
  }, [user, isLoading, router])

  const stats = {
    total: projects.length,
    deployed: projects.filter((p) => p.status === 'deployed').length,
    deploying: projects.filter((p) => p.status === 'deploying').length,
    errors: projects.filter((p) => p.status === 'error').length,
  }

  const recentDeployments = projects
    .filter((p) => p.last_deployment)
    .sort((a, b) => new Date(b.last_deployment) - new Date(a.last_deployment))
    .slice(0, 5)

  if (!user) {
    return <div>Loading...</div>
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-gray-400">Welcome back, {user.username}!</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Total Projects"
          value={stats.total}
          icon={<Activity className="w-6 h-6" />}
          color="bg-blue-500/10 text-blue-400"
        />
        <StatCard
          title="Deployed"
          value={stats.deployed}
          icon={<CheckCircle className="w-6 h-6" />}
          color="bg-green-500/10 text-green-400"
        />
        <StatCard
          title="Deploying"
          value={stats.deploying}
          icon={<Clock className="w-6 h-6" />}
          color="bg-yellow-500/10 text-yellow-400"
        />
        <StatCard
          title="Errors"
          value={stats.errors}
          icon={<AlertCircle className="w-6 h-6" />}
          color="bg-red-500/10 text-red-400"
        />
      </div>

      {/* Projects Section */}
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
            <p className="text-gray-400">Loading projects...</p>
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

      {/* Recent Deployments */}
      {recentDeployments.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold text-white mb-6">Recent Deployments</h2>
          <div className="bg-secondary rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700 bg-primary/50">
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Project</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentDeployments.map((project) => (
                  <tr key={project.id} className="border-b border-gray-700 hover:bg-primary/50 transition">
                    <td className="px-6 py-3">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-accent hover:underline font-medium"
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          project.status === 'deployed'
                            ? 'bg-green-500/20 text-green-400'
                            : project.status === 'deploying'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {project.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-400 text-sm">
                      {new Date(project.last_deployment).toLocaleDateString()}
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
