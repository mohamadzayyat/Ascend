import { useState } from 'react'
import { useRouter } from 'next/router'
import { apiClient } from '@/lib/api'

const INITIAL = {
  name: '',
  description: '',
  github_url: '',
  github_branch: 'main',
  folder_name: '',
  auto_deploy: false,
  enable_webhook: true,
}

export default function NewProject() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState(INITIAL)

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    let next = type === 'checkbox' ? checked : value
    setFormData((prev) => {
      const updated = { ...prev, [name]: next }
      // Auto-suggest folder_name from the GitHub URL if the user hasn't typed one yet
      if (name === 'github_url' && !prev.folder_name) {
        const m = String(next).match(/\/([\w.-]+?)(?:\.git)?\/?$/)
        if (m) updated.folder_name = m[1].toLowerCase()
      }
      return updated
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await apiClient.createProject(formData)
      // Go straight to the "add your first app" page
      router.push(`/projects/${res.data.id}/apps/new`)
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
    <div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          name={name}
          checked={formData[name]}
          onChange={handleChange}
          className="w-4 h-4 rounded accent-accent"
        />
        <span className="text-sm font-medium text-gray-300">{label}</span>
      </label>
      {desc && <p className="text-xs text-gray-500 mt-1 ml-6">{desc}</p>}
    </div>
  )

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">New Project</h1>
        <p className="text-gray-400">
          A project represents a GitHub repo. After creating it you'll add one or more
          <strong className="text-white"> apps</strong> (CMS, API, website, …) that each
          get their own port, PM2 process, and optional domain.
        </p>
      </div>

      <div className="bg-secondary rounded-lg border border-gray-700 p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/50 text-red-400">
              {error}
            </div>
          )}

          <section>
            <h2 className="text-lg font-bold text-white mb-4">Basic Info</h2>
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
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white mb-4">GitHub</h2>
            <div className="space-y-4">
              {field('GitHub URL *', 'github_url', 'url', 'https://github.com/user/repo')}
              {field('Branch', 'github_branch', 'text', 'main')}
              {field('Folder Name *', 'folder_name', 'text', 'my-project', 'Where the repo is cloned on disk. All apps in this project share this clone.')}
              {check('Auto-deploy on GitHub push', 'auto_deploy', 'Ascend will create the webhook in your GitHub repo automatically (needs a PAT with repo scope saved under Settings → GitHub Credentials).')}
              {check('Enable webhook endpoint', 'enable_webhook')}
            </div>
          </section>

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={loading || !formData.name || !formData.github_url || !formData.folder_name}
              className="px-6 py-2 bg-accent hover:bg-blue-600 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating…' : 'Create Project & Add App'}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="px-6 py-2 border border-gray-600 text-gray-300 hover:text-white hover:border-gray-500 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
