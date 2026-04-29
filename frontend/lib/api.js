import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

// Let callers handle 401s. _app.jsx redirects unauthenticated users to /login,
// and useAuth() treats a 401 on /api/current-user as "not logged in" (not an error).
// A global redirect here would fight those and cause loops on /login and /setup.
api.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(error)
)

export const apiClient = {
  // Auth — all JSON endpoints, no CSRF token needed
  login: (username, password, otp = '') => api.post('/api/auth/login', { username, password, otp }),
  logout: () => api.post('/api/auth/logout'),
  setup: (username, password, email) => api.post('/api/auth/setup', { username, password, email }),
  getSetupStatus: () => api.get('/api/setup-status'),
  checkAuth: () => api.get('/api/current-user'),
  getSecuritySettings: () => api.get('/api/settings/security'),
  setupTwoFactor: () => api.post('/api/settings/security/2fa/setup'),
  enableTwoFactor: (code) => api.post('/api/settings/security/2fa/enable', { code }),
  disableTwoFactor: (password, code) => api.post('/api/settings/security/2fa/disable', { password, code }),
  getAuditLog: (limit = 250) => api.get('/api/audit-log', { params: { limit } }),
  clearAuditLog: () => api.delete('/api/audit-log'),
  getBackupHealth: () => api.get('/api/backups/health'),
  getUpdateStatus: () => api.get('/api/update/status', { timeout: 120000 }),
  startUpdate: () => api.post('/api/update/start', {}, { timeout: 30000 }),
  getSystemAlerts: () => api.get('/api/system/alerts'),
  listUsers: () => api.get('/api/users'),
  createUser: (data) => api.post('/api/users', data),
  updateUser: (id, data) => api.put(`/api/users/${id}`, data),
  deleteUser: (id, confirmText) => api.delete(`/api/users/${id}`, { data: { confirm_text: confirmText } }),

  // Projects (repo-level)
  getProjects: () => api.get('/api/projects'),
  getProject: (id) => api.get(`/api/project/${id}`),
  createProject: (data) => api.post('/api/projects', data),
  updateProject: (id, data) => api.put(`/api/project/${id}`, data),
  deleteProject: (id, confirmText) => api.delete(`/api/project/${id}`, { data: { confirm_text: confirmText } }),
  syncProjectWebhook: (id) => api.post(`/api/project/${id}/github-webhook/sync`),
  listProjectBranches: (id) => api.get(`/api/project/${id}/branches`),
  checkProjectSubdirectory: (id, path, branch) =>
    api.get(`/api/project/${id}/subdirectory-check`, { params: { path, ...(branch ? { branch } : {}) } }),

  // Apps (deployment units inside a project)
  listApps: (projectId) => api.get(`/api/project/${projectId}/apps`),
  createApp: (projectId, data) => api.post(`/api/project/${projectId}/apps`, data),
  getApp: (id) => api.get(`/api/app/${id}`),
  updateApp: (id, data) => api.put(`/api/app/${id}`, data),
  deleteApp: (id, confirmText) => api.delete(`/api/app/${id}`, { data: { confirm_text: confirmText } }),
  deployApp: (id, branch) => api.post(`/api/app/${id}/deploy`, { branch }),
  restartApp: (id) => api.post(`/api/app/${id}/restart`),
  retryAppSsl: (id) => api.post(`/api/app/${id}/ssl/retry`),
  getAppDeployments: (id) => api.get(`/api/app/${id}/deployments`),

  // Deployments
  deploy: (projectId, branch) => api.post(`/api/project/${projectId}/deploy`, { branch }),
  getDeployment: (id) => api.get(`/api/deployment/${id}/status`),
  getDeploymentLog: (id) => api.get(`/api/deployment/${id}/log`),
  getProjectDeployments: (projectId) => api.get(`/api/project/${projectId}/deployments`),

  // GitHub Credentials
  getEmailNotifications: () => api.get('/api/settings/email-notifications'),
  updateEmailNotifications: (data) => api.put('/api/settings/email-notifications', data),
  // SMTP can take up to ~30s before the server responds with an error; avoid client giving up first.
  testEmailNotifications: (data) =>
    api.post('/api/settings/email-notifications/test', data || {}, { timeout: 120000 }),
  getEmailNotificationLog: (limit = 200) => api.get('/api/settings/email-notifications/log', { params: { limit } }),
  clearEmailNotificationLog: () => api.delete('/api/settings/email-notifications/log'),
  getBackupUploadSettings: () => api.get('/api/settings/backup-upload'),
  updateBackupUploadSettings: (data) => api.put('/api/settings/backup-upload', data),
  testBackupUploadSettings: () => api.post('/api/settings/backup-upload/test', {}, { timeout: 120000 }),
  listAscendBackups: () => api.get('/api/settings/ascend-backups'),
  createAscendBackup: () => api.post('/api/settings/ascend-backups', {}, { timeout: 120000 }),
  uploadAscendBackup: (file) => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/api/settings/ascend-backups/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
  },
  restoreAscendBackup: (filename, confirmText) =>
    api.post(`/api/settings/ascend-backups/${encodeURIComponent(filename)}/restore`, { confirm_text: confirmText }, { timeout: 120000 }),
  downloadAscendBackupUrl: (filename) =>
    `${API_URL}/api/settings/ascend-backups/${encodeURIComponent(filename)}/download`,

  getGitHubCredentials: () => api.get('/api/github-credentials'),
  addGitHubCredential: (username, token) => api.post('/api/github-credentials', { username, token }),
  deleteGitHubCredential: (id) => api.delete(`/api/github-credentials/${id}`),

  // System introspection
  getServerStats: () => api.get('/api/system/stats'),
  getPm2Processes: () => api.get('/api/system/pm2'),
  getListeningPorts: () => api.get('/api/system/ports'),
  getNginxSites: () => api.get('/api/system/nginx'),
  getCertificates: () => api.get('/api/system/certificates'),
  checkDomainDns: (domain) => api.get('/api/system/dns-check', { params: { domain } }),
  suggestAppPort: (start = 3000, excludeAppId = null) =>
    api.get('/api/system/suggest-port', { params: { start, exclude_app_id: excludeAppId } }),
  getPhpRuntimes: () => api.get('/api/system/php-runtimes'),
  getPhpInstallStatus: () => api.get('/api/system/php-install/status'),
  startPhpInstall: (version) => api.post('/api/system/php-install/start', { version }),
  getSecurityCenterStatus: () => api.get('/api/security/status'),
  startSecurityInstall: () => api.post('/api/security/install/start'),
  startSecurityScan: (data) => api.post('/api/security/scan/start', data || {}),
  startCrowdSecInstall: () => api.post('/api/security/crowdsec/install/start'),
  repairSecurity: (action) => api.post('/api/security/repair', { action }, { timeout: 240000 }),
  deleteCrowdSecDecision: (decision) => api.delete('/api/security/crowdsec/decisions', { data: decision || {} }),
  getSshFailures: (limit = 500) => api.get('/api/security/ssh-failures', { params: { limit } }),
  blockCrowdSecIp: (ip, duration = '24h', reason = '') => api.post('/api/security/crowdsec/block', { ip, duration, reason }),
  blockRepeatSshAttackers: (threshold = 5, duration = '24h') => api.post('/api/security/ssh-failures/block-repeat', { threshold, duration }, { timeout: 120000 }),
  getSecurityLogs: (kind = 'scan') => api.get('/api/security/logs', { params: { kind } }),
  clearSecurityFindings: () => api.delete('/api/security/findings'),
  clearSecurityQuarantine: () => api.delete('/api/security/quarantine'),
  getAppRuntime: (id) => api.get(`/api/app/${id}/runtime`),
  getAppPm2Logs: (id, lines = 120) => api.get(`/api/app/${id}/pm2-logs`, { params: { lines } }),
  getAppLogs: (id, lines = 200) => api.get(`/api/app/${id}/logs`, { params: { lines } }),
  getServerFilesStatus: () => api.get('/api/server/files/status'),
  unlockServerFiles: (passphrase) => api.post('/api/server/files/unlock', { passphrase }),
  lockServerFiles: () => api.post('/api/server/files/lock'),

  // File manager (scoped to app's deploy directory)
  listAppFiles: (id, path = '', showHidden = false) =>
    api.get(`/api/app/${id}/files/list`, { params: { path, show_hidden: showHidden ? 1 : 0 } }),
  readAppFile: (id, path) =>
    api.get(`/api/app/${id}/files/read`, { params: { path } }),
  writeAppFile: (id, path, content) =>
    api.post(`/api/app/${id}/files/write`, { path, content }),
  downloadAppFileUrl: (id, path) =>
    `${API_URL}/api/app/${id}/files/download?path=${encodeURIComponent(path)}`,
  fetchAppFileBlob: (id, path) =>
    api.get(`/api/app/${id}/files/download`, { params: { path }, responseType: 'blob' }),
  uploadAppFiles: (id, path, files, { unzip = false } = {}) => {
    const form = new FormData()
    form.append('path', path || '')
    if (unzip) form.append('unzip', '1')
    for (const f of files) form.append('files', f)
    return api.post(`/api/app/${id}/files/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  mkdirAppFiles: (id, path) =>
    api.post(`/api/app/${id}/files/mkdir`, { path }),
  renameAppFile: (id, from, to) =>
    api.post(`/api/app/${id}/files/rename`, { from, to }),
  deleteAppFile: (id, path) =>
    api.post(`/api/app/${id}/files/delete`, { path }),
  recalcAppSize: (id) =>
    api.post(`/api/app/${id}/files/recalculate-size`),
  recalcProjectSize: (id) =>
    api.post(`/api/project/${id}/files/recalculate-size`),

  // Terminal — passphrase-gated server shell
  getTerminalStatus: () => api.get('/api/terminal/status'),
  unlockTerminal: (passphrase) => api.post('/api/terminal/unlock', { passphrase }),
  lockTerminal: () => api.post('/api/terminal/lock'),

  // Shell passphrase — shared by terminal and server-files unlock screens.
  // First-time setup omits `current`; rotation requires it.
  setShellPassphrase: (newPass, current) =>
    api.post('/api/shell-passphrase', { new: newPass, current: current || '' }),

  // Database screen — connections, browse, SQL runner, backups
  listDbConnections: () => api.get('/api/databases/connections'),
  createDbConnection: (data) => api.post('/api/databases/connections', data),
  updateDbConnection: (id, data) => api.put(`/api/databases/connections/${id}`, data),
  deleteDbConnection: (id) => api.delete(`/api/databases/connections/${id}`),
  testDbConnection: (id) => api.post(`/api/databases/connections/${id}/test`),
  listDatabases: (id) => api.get(`/api/databases/connections/${id}/databases`),
  createDatabase: (id, data) => api.post(`/api/databases/connections/${id}/databases`, data),
  importSqlFile: (id, data) => {
    const form = new FormData()
    Object.entries(data || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) form.append(key, value)
    })
    return api.post(`/api/databases/connections/${id}/import-sql`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 1900000,
    })
  },
  listMysqlUsers: (id, database = '') =>
    api.get(`/api/databases/connections/${id}/mysql-users`, { params: { ...(database ? { database } : {}) } }),
  createMysqlUser: (id, data) => api.post(`/api/databases/connections/${id}/mysql-users`, data),
  grantMysqlUser: (id, data) => api.post(`/api/databases/connections/${id}/mysql-users/grants`, data),
  deleteMysqlUser: (id, username, host, confirmText) =>
    api.delete(`/api/databases/connections/${id}/mysql-users`, { data: { username, host, confirm_text: confirmText } }),
  listTables: (id, database) =>
    api.get(`/api/databases/connections/${id}/tables`, { params: { database } }),
  createTable: (id, data) => api.post(`/api/databases/connections/${id}/tables`, data),
  addTableColumn: (id, data) => api.post(`/api/databases/connections/${id}/table-columns`, data),
  getDatabaseSchema: (id, database) =>
    api.get(`/api/databases/connections/${id}/database-schema`, { params: { database } }),
  getTableRows: (id, database, table, page = 1, perPage = 50, search = '') =>
    api.get(`/api/databases/connections/${id}/table-rows`, {
      params: {
        database,
        table,
        page,
        per_page: perPage,
        ...(search && String(search).trim() ? { search: String(search).trim() } : {}),
      },
    }),
  getTableDesign: (id, database, table) =>
    api.get(`/api/databases/connections/${id}/table-design`, { params: { database, table } }),
  insertTableRow: (id, database, table, values) =>
    api.post(`/api/databases/connections/${id}/table-row`, { database, table, values }),
  updateTableRow: (id, database, table, key, values) =>
    api.put(`/api/databases/connections/${id}/table-row`, { database, table, key, values }),
  deleteTableRow: (id, database, table, key) =>
    api.delete(`/api/databases/connections/${id}/table-row`, { data: { database, table, key } }),
  runDbQuery: (id, sql, database, confirmDestructive = false) =>
    api.post(`/api/databases/connections/${id}/query`, {
      sql, database, confirm_destructive: confirmDestructive,
    }),
  listDbBackups: (id) => api.get(`/api/databases/connections/${id}/backups`),
  runDbBackup: (id) => api.post(`/api/databases/connections/${id}/backups/run`),
  startDbRestore: (id, data) => api.post(`/api/databases/connections/${id}/restore-jobs`, data, { timeout: 120000 }),
  getDbRestoreJob: (jobId) => api.get(`/api/databases/restore-jobs/${jobId}`),
  downloadDbBackupUrl: (backupId) =>
    `${API_URL}/api/databases/backups/${backupId}/download`,
  deleteDbBackup: (backupId) => api.delete(`/api/databases/backups/${backupId}`),
  getDbSchedule: (id) => api.get(`/api/databases/connections/${id}/schedule`),
  upsertDbSchedule: (id, data) =>
    api.put(`/api/databases/connections/${id}/schedule`, data),
  listDbBackupSchedules: (id) =>
    api.get(`/api/databases/connections/${id}/backup-schedules`),
  createDbBackupSchedule: (id, data) =>
    api.post(`/api/databases/connections/${id}/backup-schedules`, data),
  updateDbBackupSchedule: (connId, scheduleId, data) =>
    api.put(`/api/databases/connections/${connId}/backup-schedules/${scheduleId}`, data),
  deleteDbBackupSchedule: (connId, scheduleId) =>
    api.delete(`/api/databases/connections/${connId}/backup-schedules/${scheduleId}`),
}

// Build the WebSocket URL for the server-shell endpoint. Respects
// NEXT_PUBLIC_API_URL for dev (cross-origin), falls back to same-origin in prod.
export function terminalWebSocketUrl() {
  const base = API_URL
  if (base) {
    const u = new URL(base)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    u.pathname = '/api/terminal/ws'
    u.search = ''
    return u.toString()
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/terminal/ws`
}

// Factory for a file-manager API bound to a specific scope (app or project).
// Lets AppFileManager stay scope-agnostic — the parent page picks the prefix.
export function makeFileApi(prefix) {
  return {
    list: (path = '', showHidden = false, search = '') =>
      api.get(`${prefix}/files/list`, { params: { path, show_hidden: showHidden ? 1 : 0, search } }),
    read: (path) => api.get(`${prefix}/files/read`, { params: { path } }),
    write: (path, content) => api.post(`${prefix}/files/write`, { path, content }),
    downloadUrl: (path) => `${API_URL}${prefix}/files/download?path=${encodeURIComponent(path)}`,
    fetchBlob: (path) => api.get(`${prefix}/files/download`, { params: { path }, responseType: 'blob' }),
    upload: (path, files, { unzip = false, onProgress } = {}) => {
      const form = new FormData()
      form.append('path', path || '')
      if (unzip) form.append('unzip', '1')
      for (const f of files) form.append('files', f)
      return api.post(`${prefix}/files/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          if (!onProgress) return
          const total = evt.total || evt.event?.total || 0
          const loaded = evt.loaded || 0
          onProgress({ loaded, total, percent: total ? Math.round((loaded / total) * 100) : 0 })
        },
      })
    },
    mkdir: (path) => api.post(`${prefix}/files/mkdir`, { path }),
    extract: (path) => api.post(`${prefix}/files/extract`, { path }),
    rename: (from, to) => api.post(`${prefix}/files/rename`, { from, to }),
    copy: (from, to) => api.post(`${prefix}/files/copy`, { from, to }),
    delete: (path) => api.post(`${prefix}/files/delete`, { path }),
    deleteMany: (paths) => api.post(`${prefix}/files/delete`, { paths }),
    archiveDownload: (paths, currentPath = '', outputName = '') =>
      api.post(`${prefix}/files/archive`, { paths, current_path: currentPath, output_name: outputName, mode: 'download' }, { responseType: 'blob' }),
    archiveCreate: (paths, currentPath = '', outputName = '') =>
      api.post(`${prefix}/files/archive`, { paths, current_path: currentPath, output_name: outputName, mode: 'create' }),
  }
}
export const appFileApi = (id) => makeFileApi(`/api/app/${id}`)
export const projectFileApi = (id) => makeFileApi(`/api/project/${id}`)
export const serverFileApi = () => makeFileApi('/api/server')

export { API_URL }
export default api
