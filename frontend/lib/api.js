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
  login: (username, password) => api.post('/api/auth/login', { username, password }),
  logout: () => api.post('/api/auth/logout'),
  setup: (username, password, email) => api.post('/api/auth/setup', { username, password, email }),
  getSetupStatus: () => api.get('/api/setup-status'),
  checkAuth: () => api.get('/api/current-user'),

  // Projects (repo-level)
  getProjects: () => api.get('/api/projects'),
  getProject: (id) => api.get(`/api/project/${id}`),
  createProject: (data) => api.post('/api/projects', data),
  updateProject: (id, data) => api.put(`/api/project/${id}`, data),
  deleteProject: (id) => api.delete(`/api/project/${id}`),
  syncProjectWebhook: (id) => api.post(`/api/project/${id}/github-webhook/sync`),

  // Apps (deployment units inside a project)
  listApps: (projectId) => api.get(`/api/project/${projectId}/apps`),
  createApp: (projectId, data) => api.post(`/api/project/${projectId}/apps`, data),
  getApp: (id) => api.get(`/api/app/${id}`),
  updateApp: (id, data) => api.put(`/api/app/${id}`, data),
  deleteApp: (id) => api.delete(`/api/app/${id}`),
  deployApp: (id) => api.post(`/api/app/${id}/deploy`),
  restartApp: (id) => api.post(`/api/app/${id}/restart`),
  retryAppSsl: (id) => api.post(`/api/app/${id}/ssl/retry`),
  getAppDeployments: (id) => api.get(`/api/app/${id}/deployments`),

  // Deployments
  deploy: (projectId) => api.post(`/api/project/${projectId}/deploy`),
  getDeployment: (id) => api.get(`/api/deployment/${id}/status`),
  getDeploymentLog: (id) => api.get(`/api/deployment/${id}/log`),
  getProjectDeployments: (projectId) => api.get(`/api/project/${projectId}/deployments`),

  // GitHub Credentials
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
  getAppRuntime: (id) => api.get(`/api/app/${id}/runtime`),
  getAppPm2Logs: (id, lines = 120) => api.get(`/api/app/${id}/pm2-logs`, { params: { lines } }),

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
}

export { API_URL }
export default api
