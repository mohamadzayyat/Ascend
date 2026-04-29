import { useState } from 'react'
import { Trash2, Plus, Github } from 'lucide-react'
import { apiClient } from '@/lib/api'
import useSWR from 'swr'
import { API_URL } from '@/lib/api'
import { localDate } from '@/lib/time'
import { useDialog } from '@/lib/dialog'

const fetchWithCreds = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => r.json())

export default function GitHubSettings() {
  const { data: creds = [], mutate } = useSWR(
    `${API_URL}/api/github-credentials`,
    fetchWithCreds
  )

  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const dialog = useDialog()

  const handleAdd = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setAdding(true)

    try {
      await apiClient.addGitHubCredential(username.trim(), token.trim())
      setUsername('')
      setToken('')
      setSuccess('Credentials added successfully!')
      mutate()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add credentials')
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id, name) => {
    const ok = await dialog.confirm({ title: 'Remove GitHub credentials?', message: `Remove credentials for "${name}"?`, confirmLabel: 'Remove', tone: 'danger' })
    if (!ok) return
    try {
      await apiClient.deleteGitHubCredential(id)
      mutate()
    } catch (err) {
      await dialog.alert({ title: 'Delete failed', message: err.response?.data?.error || 'Failed to delete credentials', tone: 'danger' })
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">GitHub Credentials</h1>
        <p className="text-gray-400">
          Add a Personal Access Token so Ascend can clone your private repositories.
        </p>
      </div>

      {/* Add form */}
      <div className="bg-secondary rounded-lg border border-gray-700 p-6 mb-6">
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5" /> Add Credentials
        </h2>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/50 text-red-400 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/50 text-green-400 text-sm">
            {success}
          </div>
        )}

        <form onSubmit={handleAdd} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              GitHub Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="octocat"
              required
              className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Personal Access Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              required
              className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Needs <code className="text-accent">repo</code> scope.
              Generate one at GitHub → Settings → Developer settings → Personal access tokens.
            </p>
          </div>

          <button
            type="submit"
            disabled={adding}
            className="px-6 py-2 bg-accent hover:bg-blue-600 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {adding ? 'Adding…' : 'Add Credentials'}
          </button>
        </form>
      </div>

      {/* Existing credentials */}
      <div className="bg-secondary rounded-lg border border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Github className="w-5 h-5" /> Saved Credentials
          </h2>
        </div>

        {creds.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-400">
            No credentials saved yet.
          </div>
        ) : (
          <ul className="divide-y divide-gray-700">
            {creds.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-6 py-4">
                <div>
                  <p className="text-white font-medium">{c.username}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Added {localDate(c.created_at)}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(c.id, c.username)}
                  className="p-2 hover:bg-red-500/10 rounded-lg text-gray-400 hover:text-red-400 transition"
                  title="Delete"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
