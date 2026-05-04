import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { RefreshCw } from 'lucide-react'
import { apiClient } from '@/lib/api'
import DomainDnsCheck from '@/components/DomainDnsCheck'
import { useDialog } from '@/lib/dialog'

const PHP_PUBLIC_DIR_PRESETS = ['public', 'web', 'frontend/web', 'backend/web']

function splitPhpPublicSubdirectory(subdirectory) {
  const raw = (subdirectory || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!raw) return null
  const publicPath = PHP_PUBLIC_DIR_PRESETS
    .slice()
    .sort((a, b) => b.length - a.length)
    .find((preset) => raw === preset || raw.endsWith(`/${preset}`))
  if (!publicPath) return null
  const rootPath = raw === publicPath ? '' : raw.slice(0, -publicPath.length).replace(/\/+$/g, '')
  return { rootPath, publicPath }
}

export default function AppSettings({ app, onUpdate }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [webhookInfo, setWebhookInfo] = useState(null)
  const [syncingWebhook, setSyncingWebhook] = useState(false)
  const dialog = useDialog()
  const [dnsStatus, setDnsStatus] = useState('idle')
  const [portLoading, setPortLoading] = useState(false)
  const [portHint, setPortHint] = useState('')
  const [phpRuntimes, setPhpRuntimes] = useState(null)
  const [phpRuntimeError, setPhpRuntimeError] = useState('')
  const [phpInstallStatus, setPhpInstallStatus] = useState(null)
  const [phpInstallError, setPhpInstallError] = useState('')
  const [phpInstalling, setPhpInstalling] = useState(false)
  const [subdirCheck, setSubdirCheck] = useState({ status: 'idle', message: '' })

  const [formData, setFormData] = useState({
    name: app?.name || '',
    app_type: app?.app_type || 'website',
    github_url: app?.github_url || '',
    github_branch: app?.github_branch || app?.project?.github_branch || '',
    auto_deploy: app?.auto_deploy === true,
    enable_webhook: app?.enable_webhook !== false,
    subdirectory: app?.subdirectory || '',
    package_manager: app?.package_manager || 'npm',
    install_command: app?.install_command || '',
    build_command: app?.build_command || '',
    start_command: app?.start_command || '',
    pm2_name: app?.pm2_name || '',
    php_version: app?.php_version || '',
    php_public_path: app?.php_public_path || '',
    composer_install: app?.composer_install !== false,
    composer_command: app?.composer_command || 'composer install --no-dev --optimize-autoloader',
    static_output_path: app?.static_output_path || 'dist',
    app_port: app?.app_port || '',
    domain: app?.domain || '',
    enable_ssl: app?.enable_ssl !== false,
    client_max_body: app?.client_max_body || '6G',
    env_content: app?.env_content || '',
  })
  const isMultiRepo = app?.project?.repo_mode === 'multi'

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData((prev) => {
      const next = { ...prev, [name]: type === 'checkbox' ? checked : value }
      if (name === 'app_type' && value === 'php') {
        next.package_manager = ''
        next.install_command = ''
        next.build_command = ''
        next.start_command = ''
        next.pm2_name = ''
        next.app_port = ''
        next.php_public_path = next.php_public_path || ''
        next.composer_command = next.composer_command || 'composer install --no-dev --optimize-autoloader'
      }
      if (name === 'app_type' && value === 'static') {
        next.package_manager = next.package_manager || 'npm'
        next.install_command = next.install_command || ''
        next.build_command = next.build_command || 'npm run build'
        next.start_command = ''
        next.pm2_name = ''
        next.app_port = ''
        next.static_output_path = next.static_output_path || 'dist'
      }
      if (name === 'app_type' && value !== 'php' && value !== 'static' && (prev.app_type === 'php' || prev.app_type === 'static')) {
        next.package_manager = 'npm'
        next.install_command = ''
        next.build_command = 'npm run build'
        next.start_command = 'npm start'
      }
      return next
    })
  }

  useEffect(() => {
    const path = formData.subdirectory.trim()
    if (!app?.project_id || !path) {
      setSubdirCheck({ status: 'idle', message: '' })
      return undefined
    }
    if (path === (app?.subdirectory || '')) {
      setSubdirCheck({ status: 'idle', message: '' })
      return undefined
    }
    let cancelled = false
    if (formData.app_type === 'php' && PHP_PUBLIC_DIR_PRESETS.includes(path)) {
      setSubdirCheck({ status: 'ok', message: `For PHP apps, "${path}" looks like a public directory. Ascend will use it as Public Directory and keep the app at the repo root.` })
      return undefined
    }
    setSubdirCheck({ status: 'checking', message: 'Checking repository path...' })
    const timer = setTimeout(async () => {
      try {
        const res = isMultiRepo
          ? await apiClient.checkAppSubdirectory(app.id, path, formData.github_branch)
          : await apiClient.checkProjectSubdirectory(app.project_id, path)
        if (!cancelled) setSubdirCheck({ status: 'ok', message: `Found ${res.data.path} on ${res.data.source}.` })
      } catch (err) {
        if (!cancelled) setSubdirCheck({ status: 'error', message: err.response?.data?.error || 'Subdirectory was not found.' })
      }
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [app?.id, app?.project_id, app?.subdirectory, formData.app_type, formData.subdirectory, formData.github_branch, isMultiRepo])

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

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSaved(false)
    setWebhookInfo(null)
    try {
      const payload = { ...formData }
      const splitPublicDir = payload.app_type === 'php' ? splitPhpPublicSubdirectory(payload.subdirectory) : null
      if (splitPublicDir) {
        payload.php_public_path = splitPublicDir.publicPath
        payload.subdirectory = splitPublicDir.rootPath
      }
      const res = await apiClient.updateApp(app.id, {
        ...payload,
        app_port: ['php', 'static'].includes(payload.app_type) ? null : (payload.app_port ? parseInt(payload.app_port, 10) : null),
      })
      setFormData((prev) => splitPublicDir ? { ...prev, subdirectory: payload.subdirectory, php_public_path: payload.php_public_path } : prev)
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

  const handleSyncWebhook = async () => {
    setSyncingWebhook(true)
    setError('')
    setWebhookInfo(null)
    try {
      const res = await apiClient.syncAppWebhook(app.id)
      setWebhookInfo(res.data)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to sync GitHub webhook')
    } finally {
      setSyncingWebhook(false)
    }
  }

  const handleDelete = async () => {
    const ok = await dialog.typedConfirm({
      title: 'Delete app?',
      message: `Delete app "${app.name}"? This stops the PM2 process but keeps the repo.`,
      expected: app.name,
      confirmLabel: 'Delete app',
      tone: 'danger',
    })
    if (!ok) return
    setDeleting(true)
    try {
      await apiClient.deleteApp(app.id, app.name)
      router.push(`/projects/${app.project_id}`)
    } catch (err) {
      await dialog.alert({ title: 'Delete failed', message: err.response?.data?.error || 'Failed to delete app', tone: 'danger' })
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

  const phpVersionSelect = () => (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-2">PHP Version</label>
      <select
        name="php_version"
        value={formData.php_version}
        onChange={handleChange}
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
            ['website', 'Website'], ['static', 'Static site'], ['api', 'API'], ['cms', 'CMS'], ['php', 'PHP'], ['custom', 'Custom'],
          ])}
          {isMultiRepo && input('GitHub URL', 'github_url', 'url', 'https://github.com/user/backend')}
          {isMultiRepo && input('Branch', 'github_branch', 'text', 'master', 'Leave empty to use the repository default branch.')}
          {input(
            isMultiRepo ? 'App Subdirectory' : 'App Subdirectory (monorepo)',
            'subdirectory',
            'text',
            isMultiRepo ? '' : 'api/ or cms/',
            formData.app_type === 'php'
              ? 'Leave empty when composer.json is at the repo root. Yii Basic should use Public Directory = web below.'
              : isMultiRepo
                ? 'Relative path inside this app repository. Leave empty if the app is the repo root.'
                : 'Leave empty if the project root is this app.'
          )}
          {subdirCheck.status !== 'idle' && (
            <p className={`text-xs ${subdirCheck.status === 'ok' ? 'text-green-400' : subdirCheck.status === 'checking' ? 'text-yellow-400' : 'text-red-400'}`}>
              {subdirCheck.message}
            </p>
          )}
          {isMultiRepo && check('Auto-deploy this app on GitHub push', 'auto_deploy')}
          {isMultiRepo && check('Enable webhook endpoint for this app', 'enable_webhook')}
          {isMultiRepo && app?.webhook_secret && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Webhook URL for this app</p>
              <p className="text-xs font-mono text-gray-400 break-all bg-primary p-3 rounded">
                {typeof window !== 'undefined' ? window.location.origin : ''}/webhook/github/{app.webhook_secret}
              </p>
              {webhookInfo && (
                <div className="text-xs mt-2">
                  <p className="text-green-400">
                    GitHub webhook: <span className="font-mono">{webhookInfo.status}</span>
                  </p>
                  {webhookInfo.url && <p className="text-gray-400 font-mono break-all mt-1">{webhookInfo.url}</p>}
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
                {syncingWebhook ? 'Syncing...' : 'Sync App Webhook'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-secondary rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">Build & Run</h3>
        {formData.app_type === 'php' ? (
          <div className="space-y-4">
            {phpVersionSelect()}
            {input('Public Directory', 'php_public_path', 'text', 'web', 'Relative to the app directory. Yii Basic uses web, Laravel uses public, Yii Advanced uses frontend/web or backend/web. Leave empty for repo root.')}
            {check('Run Composer during deploy', 'composer_install')}
            {formData.composer_install && input('Composer Command', 'composer_command', 'text', 'composer install --no-dev --optimize-autoloader')}
          </div>
        ) : formData.app_type === 'static' ? (
          <div className="space-y-4">
            {select('Package Manager', 'package_manager', [
              ['npm', 'NPM'], ['yarn', 'Yarn'], ['pnpm', 'PNPM'],
            ])}
            {input('Install Command', 'install_command', 'text', 'npm install --legacy-peer-deps', 'Optional. Leave blank to run the package manager default, for example npm install.')}
            {input('Build Command', 'build_command', 'text', 'npm run build')}
            {input('Static Output Directory', 'static_output_path', 'text', 'dist', 'Relative to the app directory. Vite usually outputs dist.')}
          </div>
        ) : (
          <div className="space-y-4">
            {select('Package Manager', 'package_manager', [
              ['npm', 'NPM'], ['yarn', 'Yarn'], ['pnpm', 'PNPM'],
            ])}
            {input('Install Command', 'install_command', 'text', 'npm install --legacy-peer-deps', 'Optional. Leave blank to run the package manager default, for example npm install.')}
            {input('Build Command', 'build_command', 'text', 'npm run build')}
            {input('Start Command', 'start_command', 'text', 'npm start')}
            {input('PM2 App Name', 'pm2_name', 'text', 'myproject-api')}
          </div>
        )}
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
          {!['php', 'static'].includes(formData.app_type) && (
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
          )}
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
          disabled={loading || dnsStatus === 'checking' || dnsStatus === 'error' || subdirCheck.status === 'checking' || subdirCheck.status === 'error'}
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
