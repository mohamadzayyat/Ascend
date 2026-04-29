import { useEffect, useMemo, useState } from 'react'
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
    github_url: '',
    github_branch: 'main',
    auto_deploy: false,
    enable_webhook: true,
    subdirectory: '',
    package_manager: 'npm',
    install_command: '',
    build_command: 'npm run build',
    start_command: 'npm start',
    pm2_name: '',
    php_version: '',
    php_public_path: 'public',
    composer_install: true,
    composer_command: 'composer install --no-dev --optimize-autoloader',
    static_output_path: 'dist',
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
  const [phpRuntimes, setPhpRuntimes] = useState(null)
  const [phpRuntimeError, setPhpRuntimeError] = useState('')
  const [phpInstallStatus, setPhpInstallStatus] = useState(null)
  const [phpInstallError, setPhpInstallError] = useState('')
  const [phpInstalling, setPhpInstalling] = useState(false)
  const [subdirCheck, setSubdirCheck] = useState({ status: 'idle', message: '' })
  const isMultiRepo = project?.repo_mode === 'multi'

  const onChange = (e) => {
    const { name, value, type, checked } = e.target
    if (name === 'app_port') setPortTouched(true)
    setFormData((prev) => {
      const next = { ...prev, [name]: type === 'checkbox' ? checked : value }
      if (name === 'app_type' && value === 'php') {
        next.package_manager = ''
        next.install_command = ''
        next.build_command = ''
        next.start_command = ''
        next.pm2_name = ''
        next.app_port = ''
        next.php_public_path = next.php_public_path || 'public'
        next.composer_command = next.composer_command || 'composer install --no-dev --optimize-autoloader'
        setPortTouched(true)
      }
      if (name === 'app_type' && value === 'static') {
        next.package_manager = next.package_manager || 'npm'
        next.install_command = next.install_command || ''
        next.build_command = next.build_command || 'npm run build'
        next.start_command = ''
        next.pm2_name = ''
        next.app_port = ''
        next.static_output_path = next.static_output_path || 'dist'
        setPortTouched(true)
      }
      if (name === 'app_type' && value !== 'php' && value !== 'static' && (prev.app_type === 'php' || prev.app_type === 'static')) {
        next.package_manager = 'npm'
        next.install_command = ''
        next.build_command = 'npm run build'
        next.start_command = 'npm start'
        setPortTouched(false)
      }
      return next
    })
  }

  const suggestPort = async ({ force = false } = {}) => {
    if (['php', 'static'].includes(formData.app_type)) return
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
    if (projectId && !['php', 'static'].includes(formData.app_type)) suggestPort()
  }, [projectId, formData.app_type]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const path = formData.subdirectory.trim()
    if (!projectId || !path || isMultiRepo) {
      setSubdirCheck({ status: 'idle', message: '' })
      return undefined
    }
    let cancelled = false
    setSubdirCheck({ status: 'checking', message: 'Checking repository path...' })
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.checkProjectSubdirectory(projectId, path, project?.github_branch)
        if (!cancelled) setSubdirCheck({ status: 'ok', message: `Found ${res.data.path} on ${res.data.source}.` })
      } catch (err) {
        if (!cancelled) setSubdirCheck({ status: 'error', message: err.response?.data?.error || 'Subdirectory was not found.' })
      }
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [projectId, project?.github_branch, formData.subdirectory, isMultiRepo])

  useEffect(() => {
    if (formData.app_type !== 'php') return
    let cancelled = false
    apiClient.getPhpRuntimes()
      .then((res) => {
        if (!cancelled) setPhpRuntimes(res.data)
      })
      .catch((err) => {
        if (!cancelled) setPhpRuntimeError(err.response?.data?.error || 'Could not detect PHP-FPM versions')
      })
    return () => {
      cancelled = true
    }
  }, [formData.app_type])

  const loadPhpInstallStatus = async () => {
    const res = await apiClient.getPhpInstallStatus()
    setPhpInstallStatus(res.data)
    return res.data
  }

  useEffect(() => {
    if (formData.app_type !== 'php') return
    loadPhpInstallStatus().catch(() => {})
  }, [formData.app_type])

  useEffect(() => {
    if (!phpInstallStatus?.running) return undefined
    const timer = setInterval(async () => {
      const status = await loadPhpInstallStatus()
      if (!status.running) {
        const res = await apiClient.getPhpRuntimes()
        setPhpRuntimes(res.data)
      }
    }, 4000)
    return () => clearInterval(timer)
  }, [phpInstallStatus?.running])

  const phpVersionOptions = useMemo(() => {
    const common = ['8.4', '8.3', '8.2', '8.1', '8.0', '7.4']
    const installed = new Set(phpRuntimes?.installed_versions || [])
    const versions = Array.from(new Set([...installed, ...common])).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    return [
      {
        value: '',
        label: phpRuntimes?.default_version
          ? `System default (PHP ${phpRuntimes.default_version})`
          : 'System default',
        disabled: phpRuntimes ? !phpRuntimes.default_available : false,
      },
      ...versions.map((version) => ({
        value: version,
        label: installed.has(version) ? `PHP ${version} (installed)` : `PHP ${version} (not installed)`,
        disabled: false,
      })),
    ]
  }, [phpRuntimes])

  const selectedPhpMissing = Boolean(
    formData.app_type === 'php'
    && formData.php_version
    && phpRuntimes
    && !(phpRuntimes.installed_versions || []).includes(formData.php_version)
  )

  const installSelectedPhp = async () => {
    setPhpInstalling(true)
    setPhpInstallError('')
    try {
      await apiClient.startPhpInstall(formData.php_version)
      const status = await loadPhpInstallStatus()
      setPhpInstallStatus(status)
    } catch (err) {
      setPhpInstallError(err.response?.data?.error || err.message || 'Failed to start PHP installation')
    } finally {
      setPhpInstalling(false)
    }
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await apiClient.createApp(projectId, {
        ...formData,
        app_port: ['php', 'static'].includes(formData.app_type) ? null : (formData.app_port ? parseInt(formData.app_port, 10) : null),
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

  const phpVersionSelect = () => (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-2">PHP Version</label>
      <select
        name="php_version"
        value={formData.php_version}
        onChange={onChange}
        className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {phpVersionOptions.map((option) => (
          <option key={option.value || 'default'} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {phpRuntimeError && <p className="text-xs text-yellow-400 mt-1">{phpRuntimeError}</p>}
      {!phpRuntimeError && phpRuntimes && phpRuntimes.installed_versions?.length === 0 && (
        <p className="text-xs text-yellow-400 mt-1">No PHP-FPM versions were detected on this server.</p>
      )}
      {selectedPhpMissing && (
        <div className="mt-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-yellow-100">PHP {formData.php_version} is not installed on this server.</p>
            <button
              type="button"
              onClick={installSelectedPhp}
              disabled={phpInstalling || phpInstallStatus?.running}
              className="px-3 py-1.5 bg-accent hover:bg-blue-600 rounded text-white text-sm font-semibold disabled:opacity-50"
            >
              {phpInstallStatus?.running ? 'Installing...' : phpInstalling ? 'Starting...' : `Install PHP ${formData.php_version}`}
            </button>
          </div>
          {phpInstallError && <p className="text-xs text-red-300 mt-2">{phpInstallError}</p>}
        </div>
      )}
      {(phpInstallStatus?.running || phpInstallStatus?.log_tail) && (
        <div className="mt-3 rounded-lg border border-gray-700 bg-primary">
          <div className="px-3 py-2 border-b border-gray-700 text-xs text-gray-300">
            {phpInstallStatus?.running ? 'PHP install running' : 'Latest PHP install log'}
          </div>
          <pre className="max-h-56 overflow-auto p-3 text-xs text-gray-300 whitespace-pre-wrap">
            {phpInstallStatus?.log_tail || 'Waiting for installer output...'}
          </pre>
        </div>
      )}
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
        Node apps run under PM2. PHP apps use PHP-FPM with Nginx.
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
              ['website', 'Website'], ['static', 'Static site'], ['api', 'API'], ['cms', 'CMS'], ['php', 'PHP'], ['custom', 'Custom'],
            ])}
            {isMultiRepo && (
              <div className="rounded-lg border border-accent/30 bg-accent/10 p-3 text-sm text-blue-100">
                This project uses separate repositories, so this app needs its own GitHub source and webhook settings.
              </div>
            )}
            {isMultiRepo && input('GitHub URL *', 'github_url', 'url', 'https://github.com/user/backend')}
            {isMultiRepo && input('Branch', 'github_branch', 'text', 'main')}
            {input('Subdirectory', 'subdirectory', 'text', isMultiRepo ? '' : 'apps/api', isMultiRepo ? 'Relative path inside this app repository. Leave empty for root.' : 'Relative path inside the repo. Leave empty for root.')}
            {subdirCheck.status !== 'idle' && (
              <p className={`text-xs ${subdirCheck.status === 'ok' ? 'text-green-400' : subdirCheck.status === 'checking' ? 'text-yellow-400' : 'text-red-400'}`}>
                {subdirCheck.message}
              </p>
            )}
            {isMultiRepo && check('Auto-deploy this app on GitHub push', 'auto_deploy')}
            {isMultiRepo && check('Enable webhook endpoint for this app', 'enable_webhook')}
          </div>
        </div>

        <div className="bg-secondary rounded-lg border border-gray-700 p-6">
          <h2 className="text-lg font-bold text-white mb-4">Build & Run</h2>
          {formData.app_type === 'php' ? (
            <div className="space-y-4">
              {phpVersionSelect()}
              {input('Public Directory', 'php_public_path', 'text', 'public', 'Relative to the app directory. Laravel usually uses public.')}
              {check('Run Composer during deploy', 'composer_install')}
              {formData.composer_install && input('Composer Command', 'composer_command', 'text', 'composer install --no-dev --optimize-autoloader')}
            </div>
          ) : formData.app_type === 'static' ? (
            <div className="space-y-4">
              {select('Package Manager', 'package_manager', [['npm', 'NPM'], ['yarn', 'Yarn'], ['pnpm', 'PNPM']])}
              {input('Install Command', 'install_command', 'text', 'npm install --legacy-peer-deps', 'Optional. Leave blank to run the package manager default, for example npm install.')}
              {input('Build Command', 'build_command', 'text', 'npm run build')}
              {input('Static Output Directory', 'static_output_path', 'text', 'dist', 'Relative to the app directory. Vite usually outputs dist.')}
            </div>
          ) : (
            <div className="space-y-4">
              {select('Package Manager', 'package_manager', [['npm', 'NPM'], ['yarn', 'Yarn'], ['pnpm', 'PNPM']])}
              {input('Install Command', 'install_command', 'text', 'npm install --legacy-peer-deps', 'Optional. Leave blank to run the package manager default, for example npm install.')}
              {input('Build Command', 'build_command', 'text', 'npm run build')}
              {input('Start Command', 'start_command', 'text', 'npm start')}
              {input('PM2 Name', 'pm2_name', 'text', '', 'Leave empty to auto-generate from project + app name.')}
            </div>
          )}
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
            {!['php', 'static'].includes(formData.app_type) && (
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
            )}
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
            disabled={loading || !formData.name || (isMultiRepo && !formData.github_url) || dnsStatus === 'checking' || dnsStatus === 'error' || subdirCheck.status === 'checking' || subdirCheck.status === 'error'}
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
