import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export const apiClient = {
  // Auth — all JSON endpoints, no CSRF token needed
  login: (username, password) => api.post('/api/auth/login', { username, password }),
  logout: () => api.post('/api/auth/logout'),
  setup: (username, password, email) => api.post('/api/auth/setup', { username, password, email }),
  checkAuth: () => api.get('/api/current-user'),

  // Projects
  getProjects: () => api.get('/api/projects'),
  getProject: (id) => api.get(`/api/project/${id}`),
  createProject: (data) => api.post('/api/projects', data),
  updateProject: (id, data) => api.put(`/api/project/${id}`, data),
  deleteProject: (id) => api.delete(`/api/project/${id}`),

  // Deployments
  deploy: (projectId) => api.post(`/api/project/${projectId}/deploy`),
  getDeployment: (id) => api.get(`/api/deployment/${id}/status`),
  getDeploymentLog: (id) => api.get(`/api/deployment/${id}/log`),
  getProjectDeployments: (projectId) => api.get(`/api/project/${projectId}/deployments`),

  // GitHub Credentials
  getGitHubCredentials: () => api.get('/api/github-credentials'),
  addGitHubCredential: (username, token) => api.post('/api/github-credentials', { username, token }),
  deleteGitHubCredential: (id) => api.delete(`/api/github-credentials/${id}`),
}

export { API_URL }
export default api
