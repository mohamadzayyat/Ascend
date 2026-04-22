import { useState } from 'react'
import { Play } from 'lucide-react'
import { apiClient } from '@/lib/api'

export default function DeploymentForm({ projectId, onDeployStarted }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deploymentId, setDeploymentId] = useState(null)

  const handleDeploy = async () => {
    setLoading(true)
    setError('')

    try {
      const res = await apiClient.deploy(projectId)
      setDeploymentId(res.data.id)
      if (onDeployStarted) onDeployStarted(res.data.id)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start deployment')
    } finally {
      setLoading(false)
    }
  }

  if (deploymentId) {
    return (
      <div className="bg-secondary rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">Deployment Started</h3>
        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/50 text-yellow-400 text-sm space-y-2">
          <p className="flex items-center gap-2">
            <span className="w-2 h-2 bg-yellow-400 rounded-full spinner" />
            Deployment #{deploymentId} is running
          </p>
          <p className="text-gray-400">Switch to the Deployments tab to watch live logs.</p>
        </div>
        <button
          onClick={() => setDeploymentId(null)}
          className="mt-4 w-full flex items-center justify-center gap-2 px-6 py-2 border border-gray-600 text-gray-300 hover:text-white hover:border-gray-500 rounded-lg transition text-sm"
        >
          Deploy Again
        </button>
      </div>
    )
  }

  return (
    <div className="bg-secondary rounded-lg border border-gray-700 p-6">
      <h3 className="text-lg font-bold text-white mb-4">Deploy Now</h3>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/50 text-red-400 text-sm">
          {error}
        </div>
      )}

      <button
        onClick={handleDeploy}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-accent hover:bg-blue-600 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Play className="w-4 h-4" />
        {loading ? 'Starting…' : 'Start Deployment'}
      </button>

      <p className="text-xs text-gray-500 mt-4 text-center">
        Clones/updates the repo, installs dependencies, builds, and starts via PM2.
      </p>
    </div>
  )
}
