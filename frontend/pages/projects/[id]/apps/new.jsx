import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { apiClient } from '@/lib/api'
import { useProject } from '@/lib/hooks/useAuth'
import DomainDnsCheck from '@/components/DomainDnsCheck'

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
    client_max_body: '6G',
    env_content: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dnsStatus, setDnsStatus] = useState('idle')
  const [portTouched, setPortTouched] = useState(false)
  const [portLoading, setPortLoading] = useState(false)
  const [portHint, setPortHint] = useState('')

  const onChange = (e) => {
    const { name, value, type, checked } = e.target
    if (name === 'app_port') setPortTouched(true)
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
  }

  const suggestPort = async ({ force = false } = {}) => {
    if (!force && (portTouched || formData.app_port)) return
    setPortLoading(true)
    setPortHint('')
    try {
      const res = await apiClient.suggestAppPort(3000)
      setFormData((prev) => {
        if (!force && (portTouched || prev.app_port)) return prev
        return { ...prev, app_port: String(res.data.port) }
      })
      setPortHint(`Suggested next free port: ${res.data.port}`)
      if (force) setPortTouched(false)
    } catch (err) {
      setPortHint(err.response?.data?.error || 'Could not suggest a free port')
    } finally {
      setPortLoading(false)
    }
  }

  useEffect(() => {
    if (projectId) suggestPort()
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

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
            <DomainDnsCheck
              domain={formData.domain}
              enabled={formData.enable_ssl}
              onStatus={(status) => setDnsStatus(status)}
            />
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">App Port</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  name="app_port"
                  value={formData.app_port}
                  onChange={onChange}
                  placeholder="3000"
                  className="flex-1 px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button
                  type="button"
                  onClick={() => suggestPort({ force: true })}
                  disabled={portLoading}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary border border-gray-600 text-gray-300 hover:text-white hover:border-gray-500 transition disabled:opacity-50"
                  title="Suggest free port"
                >
                  <RefreshCw className={`w-4 h-4 ${portLoading ? 'animate-spin' : ''}`} />
                  Suggest
                </button>
              </div>
              <p className={`text-xs mt-1 ${portHint.startsWith('Could not') ? 'text-red-400' : 'text-gray-500'}`}>
                {portHint || 'Ascend suggests the next free port and refuses ports already in use.'}
              </p>
            </div>
            {input('Client Max Body', 'client_max_body', 'text', '6G')}
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
            disabled={loading || !formData.name || dnsStatus === 'checking' || dnsStatus === 'error'}
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
