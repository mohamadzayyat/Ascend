import { useRouter } from 'next/router'
import useSWR from 'swr'
import { apiClient, API_URL } from '@/lib/api'

// Treats 401 as "not logged in" (data=null) rather than as an error,
// so SWR caches null instead of thrashing with retries.
const fetchAuth = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (r.status === 401) return null
    if (!r.ok) throw new Error('Request failed')
    return r.json()
  })

const fetchWithCreds = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error('Request failed')
    return r.json()
  })

const AUTH_KEY = `${API_URL}/api/current-user`

// All components calling useAuth() share the same SWR cache entry under
// AUTH_KEY, so login in one component updates the user everywhere.
export function useAuth() {
  const router = useRouter()
  const { data, error, mutate } = useSWR(AUTH_KEY, fetchAuth, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 60000,
  })

  const login = async (username, password) => {
    const res = await apiClient.login(username, password)
    await mutate(res.data, false)
    return res.data
  }

  const logout = async () => {
    try {
      await apiClient.logout()
    } catch (_) {
      // best-effort
    }
    await mutate(null, false)
    router.push('/login')
  }

  return {
    user: data ?? null,
    loading: data === undefined && !error,
    login,
    logout,
    setUser: (u) => mutate(u, false),
  }
}

export function useProjects() {
  const { data: projects, error, mutate } = useSWR(
    `${API_URL}/api/projects`,
    fetchWithCreds
  )

  return {
    projects: projects || [],
    isLoading: !error && !projects,
    isError: !!error,
    mutate,
  }
}

export function useProject(id) {
  const { data: project, error, mutate } = useSWR(
    id ? `${API_URL}/api/project/${id}` : null,
    fetchWithCreds
  )

  return {
    project,
    isLoading: !error && !project,
    isError: !!error,
    mutate,
  }
}

export function useDeployment(id) {
  const isRunning = (data) => data?.status === 'running' || data?.status === 'pending'

  const { data: deployment, error, mutate } = useSWR(
    id ? `${API_URL}/api/deployment/${id}/status` : null,
    fetchWithCreds,
    {
      // Poll every 3s while a deployment is in flight, stop when done.
      // SWR's refreshWhenHidden defaults to false → polling pauses on background tabs.
      refreshInterval: (data) => (isRunning(data) ? 3000 : 0),
      dedupingInterval: 1000,
    }
  )

  const getLog = () =>
    fetchWithCreds(`${API_URL}/api/deployment/${id}/log`)

  return {
    deployment,
    isLoading: !error && !deployment,
    isError: !!error,
    getLog,
    mutate,
  }
}

export function useProjectDeployments(projectId) {
  const { data: deployments, error, mutate } = useSWR(
    projectId ? `${API_URL}/api/project/${projectId}/deployments` : null,
    fetchWithCreds,
    { refreshInterval: 10000, dedupingInterval: 2000 }
  )

  return {
    deployments: deployments || [],
    isLoading: !error && !deployments,
    isError: !!error,
    mutate,
  }
}
