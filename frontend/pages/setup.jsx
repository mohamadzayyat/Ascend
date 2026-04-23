import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { apiClient } from '@/lib/api'
import { useAuth, useSetupStatus } from '@/lib/hooks/useAuth'

export default function Setup() {
  const router = useRouter()
  const { user, setUser } = useAuth()
  const { initialized, isLoading: setupStatusLoading } = useSetupStatus()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) router.push('/dashboard')
  }, [user, router])

  useEffect(() => {
    if (initialized === true && !user) router.replace('/login')
  }, [initialized, user, router])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (initialized === true) {
      router.replace('/login')
      return
    }
    setError('')
    setLoading(true)

    try {
      const res = await apiClient.setup(username.trim(), password, email.trim())
      setUser(res.data)
      router.push('/dashboard')
    } catch (err) {
      setError(err.response?.data?.error || 'Setup failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (setupStatusLoading || initialized === true) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary via-secondary to-primary flex items-center justify-center p-4">
        <div className="text-gray-400">Checking setup status...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary via-secondary to-primary flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-secondary rounded-lg shadow-2xl p-8 border border-gray-700">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">🚀 Ascend Setup</h1>
            <p className="text-gray-400">Create your admin account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-2">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                minLength="3"
                required
                autoComplete="username"
                className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                Email <span className="text-gray-500">(optional)</span>
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                autoComplete="email"
                className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a strong password"
                minLength="6"
                required
                autoComplete="new-password"
                className="w-full px-4 py-2 rounded-lg bg-primary border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="text-xs text-gray-500 mt-1">Minimum 6 characters</p>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/50 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-accent hover:bg-blue-600 text-white font-semibold rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Setting up…' : 'Create Admin Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
