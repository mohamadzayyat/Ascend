import { useState } from 'react'
import { useRouter } from 'next/router'
import { RefreshCw } from 'lucide-react'
import { apiClient } from '@/lib/api'
import DomainDnsCheck from '@/components/DomainDnsCheck'
import { typedConfirm } from '@/lib/confirm'

export default function AppSettings({ app, onUpdate }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [dnsStatus, setDnsStatus] = useState('idle')
  const [portLoading, setPortLoading] = useState(false)
  const [portHint, setPortHint] = useState('')

  const [formData, setFormData] = useState({
    name: app?.name || '',
    app_type: app?.app_type || 'website',
    subdirectory: app?.subdirectory || '',
    package_manager: app?.package_manager || 'npm',
    build_command: app?.build_command || '',
    start_command: app?.start_command || '',
    pm2_name: app?.pm2_name || '',
    app_port: app?.app_port || '',
    domain: app?.domain || '',
    enable_ssl: app?.enable_ssl !== false,
    client_max_body: app?.client_max_body || '6G',
    env_content: app?.env_content || '',
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
      const res = await apiClient.updateApp(app.id, {
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
    if (!typedConfirm(`Delete app "${app.name}"? This stops the PM2 process but keeps the repo.`, app.name)) return
    setDeleting(true)
    try {
      await apiClient.deleteApp(app.id, app.name)
      router.push(`/projects/${app.project_id}`)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete app')
      setDeleting(false)
    }
  }

  const suggestPort = async () => {
    setPortLoading(true)
    setPortHint('')
    try {
      const res = await apiClient.suggestAppPort(3000, app.id)
      setFormData((prev) => ({ ...prev, app_port: String(res.data.port) }))
      setPortHint(`Suggested next free port: ${res.data.port}`)
    } catch (err) {
      setPortHint(err.response?.data?.error || 'Could not suggest a free port')
    } finally {
      setPortLoading(false)
    }
  }

  const input = (label, name, type = 'text', placeholder = '', hint = '') => (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
      <input
        type={type}
        name={name}
        value={formData[name] ?? ''}
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
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/50 text-red-400">{error}</div>
      )}
      {saved && (
        <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/50 text-green-400">Changes saved.</div>
      )}

      <div className="bg-secondary rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">App Info</h3>
        <div className="space-y-4">
          {input('Name', 'name', 'text', 'CMS / API / Web')}
          {select('Type', 'app_type', [
            ['website', 'Website'], ['api', 'API'], ['cms', 'CMS'], ['custom', 'Custom'],
          ])}
          {input('Subdirectory (monorepo)', 'subdirectory', 'text', 'api/ or cms/', 'Leave empty if the project root is this app.')}
        </div>
      </div>

      <div className="bg-secondary rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">Build & Run</h3>
        <div className="space-y-4">
          {select('Package Manager', 'package_manager', [
            ['npm', 'NPM'], ['yarn', 'Yarn'], ['pnpm', 'PNPM'],
          ])}
          {input('Build Command', 'build_command', 'text', 'npm run build')}
          {input('Start Command', 'start_command', 'text', 'npm start')}
          {input('PM2 App Name', 'pm2_name', 'text', 'myproject-api')}
        </div>
      </div>

      <div className="bg-secondary rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">Domain & Port</h3>
        <div className="space-y-4">
          {input('Domain', 'domain', 'text', 'example.com')}
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
                value={formData.app_port ?? ''}
                onChange={handleChange}
                placeholder="3000"
                className="flex-1 px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={suggestPort}
                disabled={portLoading}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary border border-gray-600 text-gray-300 hover:text-white hover:border-gray-500 transition disabled:opacity-50"
                title="Suggest free port"
              >
                <RefreshCw className={`w-4 h-4 ${portLoading ? 'animate-spin' : ''}`} />
                Suggest
              </button>
            </div>
            <p className={`text-xs mt-1 ${portHint.startsWith('Could not') ? 'text-red-400' : 'text-gray-500'}`}>
              {portHint || 'Ascend checks saved apps and live listeners before suggesting a port.'}
            </p>
          </div>
          {input('Client Max Body Size', 'client_max_body', 'text', '6G')}
          {check('Enable SSL with Certbot', 'enable_ssl')}
        </div>
      </div>

      <div className="bg-secondary rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">Environment Variables</h3>
        <p className="text-xs text-gray-500 mb-3">
          Written as a .env file into this app's deploy directory before each build.
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

      <div className="flex items-center justify-between">
        <button
          type="submit"
          disabled={loading || dnsStatus === 'checking' || dnsStatus === 'error'}
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
          {deleting ? 'Deleting…' : 'Delete App'}
        </button>
      </div>
    </form>
  )
}
