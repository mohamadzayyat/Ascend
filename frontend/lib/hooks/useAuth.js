import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import useSWR from 'swr'
import { apiClient, API_URL } from '@/lib/api'

const fetchWithCreds = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error('Request failed')
    return r.json()
  })

export function useAuth() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiClient.checkAuth()
      .then((res) => setUser(res.data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const login = async (username, password) => {
    const res = await apiClient.login(username, password)
    setUser(res.data)
    return res.data
  }

  const logout = async () => {
    try {
      await apiClient.logout()
    } catch (_) {
      // best-effort
    }
    setUser(null)
    router.push('/login')
  }

  return { user, loading, login, logout, setUser }
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
