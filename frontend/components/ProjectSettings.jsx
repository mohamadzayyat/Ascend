import { useState } from 'react'
import { useRouter } from 'next/router'
import { apiClient } from '@/lib/api'
import { useProjects } from '@/lib/hooks/useAuth'

export default function ProjectSettings({ project, onUpdate }) {
  const router = useRouter()
  const { mutate: mutateProjects } = useProjects()
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [webhookInfo, setWebhookInfo] = useState(null)
  const [syncingWebhook, setSyncingWebhook] = useState(false)

  const [formData, setFormData] = useState({
    name: project?.name || '',
    description: project?.description || '',
    github_url: project?.github_url || '',
    github_branch: project?.github_branch || 'main',
    folder_name: project?.folder_name || '',
    auto_deploy: project?.auto_deploy === true,
    enable_webhook: project?.enable_webhook !== false,
  })

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSaved(false)
    setWebhookInfo(null)

    try {
      const res = await apiClient.updateProject(project.id, formData)
      setSaved(true)
      if (res.data.github_webhook) setWebhookInfo(res.data.github_webhook)
      if (onUpdate) onUpdate(res.data)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save changes')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${project.name}" and all its apps? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await apiClient.deleteProject(project.id)
      mutateProjects()
      router.push('/projects')
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete project')
      setDeleting(false)
    }
  }

  const handleSyncWebhook = async () => {
    setSyncingWebhook(true)
    setError('')
    setWebhookInfo(null)
    try {
      const res = await apiClient.syncProjectWebhook(project.id)
      setWebhookInfo(res.data)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to sync GitHub webhook')
    } finally {
      setSyncingWebhook(false)
    }
  }

  const input = (label, name, type = 'text', placeholder = '', hint = '') => (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
      <input
        type={type}
        name={name}
        value={formData[name]}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent"
      />
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )

  const check = (label, name, hint) => (
    <div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          name={name}
          checked={formData[name]}
          onChange={handleChange}
          className="w-4 h-4 rounded"
        />
        <span className="text-sm font-medium text-gray-300">{label}</span>
      </label>
      {hint && <p className="text-xs text-gray-500 mt-1 ml-6">{hint}</p>}
    </div>
  )

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      {error && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/50 text-red-400">
          {error}
        </div>
      )}
      {saved && (
        <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/50 text-green-400">
          Changes saved.
          {webhookInfo && (
            <span className="block mt-1 text-xs">
              GitHub webhook: <span className="font-mono">{webhookInfo.status}</span>
              {webhookInfo.message && <> - {webhookInfo.message}</>}
            </span>
          )}
        </div>
      )}

      <div className="bg-secondary rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">Basic Information</h3>
        <div className="space-y-4">
          {input('Name', 'name', 'text', 'My Project')}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Description</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows="3"
              className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          {input('Folder Name', 'folder_name', 'text', 'my-project', 'Server directory where the repo is cloned')}
        </div>
      </div>

      <div className="bg-secondary rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">GitHub</h3>
        <div className="space-y-4">
          {input('GitHub URL', 'github_url', 'url', 'https://github.com/user/repo')}
          {input('Branch', 'github_branch', 'text', 'main')}
          {check('Auto-deploy on push', 'auto_deploy', 'When enabled, Ascend creates a webhook in your GitHub repo automatically (requires PAT with repo scope).')}
          {check('Enable webhook endpoint', 'enable_webhook')}
          {project?.webhook_secret && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Webhook URL (paste into GitHub Settings Webhooks)</p>
              <p className="text-xs font-mono text-gray-400 break-all bg-primary p-3 rounded">
                {typeof window !== 'undefined' ? window.location.origin : ''}/webhook/github/{project.webhook_secret}
              </p>
              {webhookInfo && (
                <div className="text-xs mt-2">
                  <p className="text-green-400">
                    GitHub webhook: <span className="font-mono">{webhookInfo.status}</span>
                  </p>
                  {webhookInfo.url && (
                    <p className="text-gray-400 font-mono break-all mt-1">{webhookInfo.url}</p>
                  )}
                  {webhookInfo.reason && <p className="text-yellow-400 mt-1">{webhookInfo.reason}</p>}
                  {webhookInfo.message && <p className="text-red-400 mt-1">{webhookInfo.message}</p>}
                </div>
              )}
              <button
                type="button"
                onClick={handleSyncWebhook}
                disabled={syncingWebhook || !formData.auto_deploy || !formData.enable_webhook}
                className="mt-3 px-3 py-2 bg-primary hover:bg-gray-700 border border-gray-600 text-white text-sm rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {syncingWebhook ? 'Syncing...' : 'Sync GitHub Webhook'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2 bg-accent hover:bg-blue-600 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Saving...' : 'Save Changes'}
        </button>

        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="px-6 py-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-600/50 font-semibold rounded-lg transition disabled:opacity-50"
        >
          {deleting ? 'Deleting...' : 'Delete Project'}
        </button>
      </div>
    </form>
  )
}
