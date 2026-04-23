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
  checkAuth: () => api.get('/api/current-user'),

  // Projects (repo-level)
  getProjects: () => api.get('/api/projects'),
  getProject: (id) => api.get(`/api/project/${id}`),
  createProject: (data) => api.post('/api/projects', data),
  updateProject: (id, data) => api.put(`/api/project/${id}`, data),
  deleteProject: (id) => api.delete(`/api/project/${id}`),

  // Apps (deployment units inside a project)
  listApps: (projectId) => api.get(`/api/project/${projectId}/apps`),
  createApp: (projectId, data) => api.post(`/api/project/${projectId}/apps`, data),
  getApp: (id) => api.get(`/api/app/${id}`),
  updateApp: (id, data) => api.put(`/api/app/${id}`, data),
  deleteApp: (id) => api.delete(`/api/app/${id}`),
  deployApp: (id) => api.post(`/api/app/${id}/deploy`),
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
  getPm2Processes: () => api.get('/api/system/pm2'),
  getListeningPorts: () => api.get('/api/system/ports'),
  getNginxSites: () => api.get('/api/system/nginx'),
  checkDomainDns: (domain) => api.get('/api/system/dns-check', { params: { domain } }),
  getAppRuntime: (id) => api.get(`/api/app/${id}/runtime`),
}

export { API_URL }
export default api
