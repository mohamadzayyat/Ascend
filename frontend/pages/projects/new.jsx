import { useState } from 'react'
import { useRouter } from 'next/router'
import { apiClient } from '@/lib/api'

const INITIAL = {
  name: '',
  description: '',
  github_url: '',
  github_branch: 'main',
  project_type: 'website',
  folder_name: '',
  subdirectory: '',
  domain: '',
  app_port: '',
  pm2_name: '',
  build_command: '',
  start_command: '',
  package_manager: 'npm',
  enable_ssl: true,
  auto_deploy: false,
  client_max_body: '100M',
}

export default function NewProject() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState(INITIAL)

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await apiClient.createProject({
        ...formData,
        app_port: formData.app_port ? parseInt(formData.app_port, 10) : null,
      })
      router.push(`/projects/${res.data.id}`)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  const field = (label, name, type = 'text', placeholder = '', hint = '') => (
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

  const check = (label, name, desc = '') => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        name={name}
        checked={formData[name]}
        onChange={handleChange}
        className="w-4 h-4 rounded accent-accent"
      />
      <span className="text-sm font-medium text-gray-300">{label}</span>
      {desc && <span className="text-xs text-gray-500">{desc}</span>}
    </label>
  )

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Create New Project</h1>
        <p className="text-gray-400">Configure your deployment project</p>
      </div>

      <div className="max-w-3xl bg-secondary rounded-lg border border-gray-700 p-8">
        <form onSubmit={handleSubmit} className="space-y-8">
          {error && (
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/50 text-red-400">
              {error}
            </div>
          )}

          {/* Basic Info */}
          <section>
            <h2 className="text-xl font-bold text-white mb-4">Basic Information</h2>
            <div className="space-y-4">
              {field('Project Name *', 'name', 'text', 'My Awesome Project')}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Description</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  placeholder="What is this project about?"
                  rows="3"
                  className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              {field('Folder Name *', 'folder_name', 'text', 'my-awesome-project', 'Where to clone the repository on the server')}
              {field('Subdirectory (monorepo)', 'subdirectory', 'text', 'api/ or services/website/', 'Leave empty if repo root is the app')}
            </div>
          </section>

          {/* GitHub */}
          <section>
            <h2 className="text-xl font-bold text-white mb-4">GitHub Configuration</h2>
            <div className="space-y-4">
              {field('GitHub URL *', 'github_url', 'url', 'https://github.com/user/repo')}
              {field('Branch', 'github_branch', 'text', 'main')}
              {check('Auto-deploy on GitHub push', 'auto_deploy')}
            </div>
          </section>

          {/* Deployment */}
          <section>
            <h2 className="text-xl font-bold text-white mb-4">Deployment Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Project Type</label>
                <select
                  name="project_type"
                  value={formData.project_type}
                  onChange={handleChange}
                  className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="website">Website</option>
                  <option value="api">API</option>
                  <option value="cms">CMS</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Package Manager</label>
                <select
                  name="package_manager"
                  value={formData.package_manager}
                  onChange={handleChange}
                  className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="npm">NPM</option>
                  <option value="yarn">Yarn</option>
                  <option value="pnpm">PNPM</option>
                </select>
              </div>
              {field('Build Command', 'build_command', 'text', 'npm run build')}
              {field('Start Command', 'start_command', 'text', 'npm start')}
              {field('PM2 App Name', 'pm2_name', 'text', 'my-app')}
            </div>
          </section>

          {/* Domain & SSL */}
          <section>
            <h2 className="text-xl font-bold text-white mb-4">Domain & SSL</h2>
            <div className="space-y-4">
              {field('Domain', 'domain', 'text', 'example.com')}
              {field('App Port', 'app_port', 'number', '3000', 'Port your app listens on (required for Nginx proxy)')}
              {field('Client Max Body Size', 'client_max_body', 'text', '100M')}
              {check('Enable SSL with Certbot', 'enable_ssl')}
            </div>
          </section>

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-accent hover:bg-blue-600 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating…' : 'Create Project'}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
