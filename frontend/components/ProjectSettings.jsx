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

  const [formData, setFormData] = useState({
    name: project?.name || '',
    description: project?.description || '',
    github_url: project?.github_url || '',
    github_branch: project?.github_branch || 'main',
    project_type: project?.project_type || 'website',
    folder_name: project?.folder_name || '',
    subdirectory: project?.subdirectory || '',
    domain: project?.domain || '',
    app_port: project?.app_port || '',
    pm2_name: project?.pm2_name || '',
    build_command: project?.build_command || '',
    start_command: project?.start_command || '',
    package_manager: project?.package_manager || 'npm',
    env_content: project?.env_content || '',
    enable_ssl: project?.enable_ssl !== false,
    auto_deploy: project?.auto_deploy === true,
    enable_webhook: project?.enable_webhook !== false,
    client_max_body: project?.client_max_body || '100M',
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

    try {
      const res = await apiClient.updateProject(project.id, {
        ...formData,
        app_port: formData.app_port ? parseInt(formData.app_port, 10) : null,
      })
      setSaved(true)
      if (onUpdate) onUpdate(res.data)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save changes')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${project.name}"? This cannot be undone.`)) return
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

  const check = (label, name) => (
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
  )

  const select = (label, name, options) => (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
      <select
        name={name}
        value={formData[name]}
        onChange={handleChange}
        className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {options.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
      </select>
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
          Changes saved successfully!
        </div>
      )}

      {/* Basic Info */}
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

      {/* GitHub Settings */}
      <div className="bg-secondary rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">GitHub Settings</h3>
        <div className="space-y-4">
          {input('GitHub URL', 'github_url', 'url', 'https://github.com/user/repo')}
          {input('Branch', 'github_branch', 'text', 'main')}
          {input('Subdirectory (monorepo)', 'subdirectory', 'text', 'api/ or cms/', 'Leave empty if repo root is the app')}
          {check('Auto-deploy on push', 'auto_deploy')}
          {check('Enable webhook endpoint', 'enable_webhook')}
          {project?.webhook_secret && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Webhook URL</p>
              <p className="text-xs font-mono text-gray-400 break-all">
                {process.env.NEXT_PUBLIC_API_URL}/webhook/github/{project.webhook_secret}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Build Settings */}
      <div className="bg-secondary rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">Build Settings</h3>
        <div className="space-y-4">
          {select('Package Manager', 'package_manager', [
            ['npm', 'NPM'], ['yarn', 'Yarn'], ['pnpm', 'PNPM'],
          ])}
          {select('Project Type', 'project_type', [
            ['website', 'Website'], ['api', 'API'], ['cms', 'CMS'], ['custom', 'Custom'],
          ])}
          {input('Build Command', 'build_command', 'text', 'npm run build')}
          {input('Start Command', 'start_command', 'text', 'npm start')}
          {input('PM2 App Name', 'pm2_name', 'text', 'my-app')}
        </div>
      </div>

      {/* Domain & SSL */}
      <div className="bg-secondary rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">Domain & SSL</h3>
        <div className="space-y-4">
          {input('Domain', 'domain', 'text', 'example.com')}
          {input('App Port', 'app_port', 'number', '3000', 'Port your app listens on (for Nginx proxy)')}
          {input('Client Max Body Size', 'client_max_body', 'text', '100M')}
          {check('Enable SSL with Certbot', 'enable_ssl')}
        </div>
      </div>

      {/* Environment Variables */}
      <div className="bg-secondary rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">Environment Variables</h3>
        <p className="text-xs text-gray-500 mb-3">
          Written as a .env file into the deploy directory before each build.
        </p>
        <textarea
          name="env_content"
          value={formData.env_content}
          onChange={handleChange}
          placeholder={'KEY1=value1\nKEY2=value2'}
          rows="8"
          className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2 bg-accent hover:bg-blue-600 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Saving…' : 'Save Changes'}
        </button>

        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="px-6 py-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-600/50 font-semibold rounded-lg transition disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Delete Project'}
        </button>
      </div>
    </form>
  )
}
