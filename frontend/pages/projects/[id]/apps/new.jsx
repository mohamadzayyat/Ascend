import { useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { apiClient } from '@/lib/api'
import { useProject } from '@/lib/hooks/useAuth'

export default function NewApp() {
  const router = useRouter()
  const { id: projectId } = router.query
  const { project } = useProject(projectId)

  const [formData, setFormData] = useState({
    name: '',
    app_type: 'website',
    subdirectory: '',
    package_manager: 'npm',
    build_command: 'npm run build',
    start_command: 'npm start',
    pm2_name: '',
    app_port: '',
    domain: '',
    enable_ssl: true,
    client_max_body: '100M',
    env_content: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const onChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await apiClient.createApp(projectId, {
        ...formData,
        app_port: formData.app_port ? parseInt(formData.app_port, 10) : null,
      })
      router.push(`/app/${res.data.id}`)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create app')
    } finally {
      setLoading(false)
    }
  }

  const input = (label, name, type = 'text', placeholder = '', hint = '') => (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
      <input
        type={type}
        name={name}
        value={formData[name] ?? ''}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent"
      />
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )

  const select = (label, name, options) => (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
      <select
        name={name}
        value={formData[name]}
        onChange={onChange}
        className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )

  const check = (label, name) => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        name={name}
        checked={formData[name]}
        onChange={onChange}
        className="w-4 h-4 rounded"
      />
      <span className="text-sm font-medium text-gray-300">{label}</span>
    </label>
  )

  return (
    <div className="p-8 max-w-3xl">
      <Link
        href={`/projects/${projectId}`}
        className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-6 text-sm"
      >
        <ArrowLeft className="w-4 h-4" /> Back to {project?.name || 'project'}
      </Link>

      <h1 className="text-4xl font-bold text-white mb-2">Add App</h1>
      <p className="text-gray-400 mb-8">
        A deployable piece of {project?.name || 'this project'} — for example a CMS, an API, or a web frontend.
        Each app runs as its own PM2 process on its own port.
      </p>

      <form onSubmit={onSubmit} className="space-y-6">
        {error && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/50 text-red-400">{error}</div>
        )}

        <div className="bg-secondary rounded-lg border border-gray-700 p-6">
          <h2 className="text-lg font-bold text-white mb-4">Basics</h2>
          <div className="space-y-4">
            {input('Name', 'name', 'text', 'CMS / API / Web')}
            {select('Type', 'app_type', [
              ['website', 'Website'], ['api', 'API'], ['cms', 'CMS'], ['custom', 'Custom'],
            ])}
            {input('Subdirectory', 'subdirectory', 'text', 'apps/api', 'Relative path inside the repo. Leave empty for root.')}
          </div>
        </div>

        <div className="bg-secondary rounded-lg border border-gray-700 p-6">
          <h2 className="text-lg font-bold text-white mb-4">Build & Run</h2>
          <div className="space-y-4">
            {select('Package Manager', 'package_manager', [['npm', 'NPM'], ['yarn', 'Yarn'], ['pnpm', 'PNPM']])}
            {input('Build Command', 'build_command', 'text', 'npm run build')}
            {input('Start Command', 'start_command', 'text', 'npm start')}
            {input('PM2 Name', 'pm2_name', 'text', '', 'Leave empty to auto-generate from project + app name.')}
          </div>
        </div>

        <div className="bg-secondary rounded-lg border border-gray-700 p-6">
          <h2 className="text-lg font-bold text-white mb-4">Domain & Port</h2>
          <div className="space-y-4">
            {input('Domain', 'domain', 'text', 'api.example.com')}
            {input('App Port', 'app_port', 'number', '3000', 'The port this app listens on. Ascend will refuse if it\'s already taken.')}
            {input('Client Max Body', 'client_max_body', 'text', '100M')}
            {check('Enable SSL with Certbot', 'enable_ssl')}
          </div>
        </div>

        <div className="bg-secondary rounded-lg border border-gray-700 p-6">
          <h2 className="text-lg font-bold text-white mb-4">Environment Variables</h2>
          <textarea
            name="env_content"
            value={formData.env_content}
            onChange={onChange}
            placeholder={'KEY1=value1\nKEY2=value2'}
            rows="6"
            className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading || !formData.name}
            className="px-6 py-2 bg-accent hover:bg-blue-600 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating…' : 'Create App'}
          </button>
          <Link
            href={`/projects/${projectId}`}
            className="px-6 py-2 border border-gray-600 text-gray-300 hover:text-white hover:border-gray-500 rounded-lg transition"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
