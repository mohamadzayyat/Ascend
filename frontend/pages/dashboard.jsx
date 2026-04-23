import Link from 'next/link'
import { useAuth, useProjects } from '@/lib/hooks/useAuth'
import StatCard from '@/components/StatCard'
import ProjectCard from '@/components/ProjectCard'
import { Activity, AlertCircle, CheckCircle, Boxes } from 'lucide-react'
import { localDate, parseApiTime } from '@/lib/time'

export default function Dashboard() {
  const { user } = useAuth()
  const { projects, isLoading } = useProjects()

  const allApps = projects.flatMap((p) => p.apps || [])
  const stats = {
    projects: projects.length,
    apps: allApps.length,
    deployed: allApps.filter((a) => a.status === 'deployed').length,
    errors: allApps.filter((a) => a.status === 'error').length,
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
