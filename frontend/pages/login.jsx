import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { ArrowRight, CheckCircle2, KeyRound, LockKeyhole, ShieldCheck, User } from 'lucide-react'
import { useAuth, useSetupStatus } from '@/lib/hooks/useAuth'

export default function Login() {
  const router = useRouter()
  const { user, login } = useAuth()
  const { initialized } = useSetupStatus()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [needsOtp, setNeedsOtp] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) router.push('/dashboard')
  }, [user, router])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login(username, password, otp)
      router.push('/dashboard')
    } catch (err) {
      if (err.response?.data?.two_factor_required) {
        setNeedsOtp(true)
        setError(err.response?.data?.error || 'Enter your two-factor code')
        return
      }
      setError(err.response?.data?.error || 'Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-primary text-white">
      <div className="grid min-h-screen lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden overflow-hidden border-r border-white/10 bg-[rgb(11_18_32)] lg:block">
          <div className="absolute inset-0 opacity-70">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:44px_44px]" />
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(59,130,246,0.22),transparent_35%),linear-gradient(315deg,rgba(20,184,166,0.16),transparent_42%)]" />
          </div>

          <div className="relative flex min-h-screen flex-col justify-between p-10 xl:p-14">
            <div className="flex items-center gap-3">
              <img src="/logo/ascend-mark.svg" alt="Ascend" className="h-10 w-10" />
              <img src="/logo/ascend-wordmark.svg" alt="Ascend" className="h-8 w-auto" />
            </div>

            <div className="max-w-xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs font-medium text-cyan-100">
                <ShieldCheck className="h-3.5 w-3.5" />
                Secure control panel access
              </div>
              <h1 className="text-5xl font-bold leading-tight tracking-normal text-white xl:text-6xl">
                Ascend
              </h1>
              <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">
                Sign in to manage deployments, files, databases, backups, and runtime health from one focused workspace.
              </p>

              <div className="mt-10 grid max-w-lg grid-cols-2 gap-3">
                {[
                  ['Deployments', 'Live PM2 and Nginx status'],
                  ['Backups', 'Schedules and restore points'],
                  ['Files', 'Server and app file access'],
                  ['Security', 'Audit logs and protected actions'],
                ].map(([title, text]) => (
                  <div key={title} className="rounded-lg border border-white/10 bg-white/[0.055] p-4 shadow-xl shadow-black/10 backdrop-blur">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                      <CheckCircle2 className="h-4 w-4 text-cyan-300" />
                      {title}
                    </div>
                    <p className="text-xs leading-5 text-slate-400">{text}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Ascend Panel</span>
              <span>Private infrastructure console</span>
            </div>
          </div>
        </section>

        <main className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 lg:px-10">
          <div className="w-full max-w-[440px]">
            <div className="mb-8 flex items-center justify-center lg:hidden">
              <img src="/logo/ascend-wordmark.svg" alt="Ascend" className="h-10 w-auto" />
            </div>

            <div className="rounded-lg border border-white/10 bg-secondary/80 p-6 shadow-2xl shadow-black/30 backdrop-blur sm:p-8">
              <div className="mb-7">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent">
                  <LockKeyhole className="h-5 w-5" />
                </div>
                <h2 className="text-2xl font-bold text-white">Welcome back</h2>
                <p className="mt-2 text-sm leading-6 text-gray-400">Use your Ascend credentials to continue.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="username" className="mb-2 block text-sm font-medium text-gray-300">
                    Username
                  </label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                    <input
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="admin"
                      required
                      autoComplete="username"
                      className="w-full rounded-lg border border-gray-700 bg-primary/80 px-10 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-accent focus:ring-2 focus:ring-accent/25"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="mb-2 block text-sm font-medium text-gray-300">
                    Password
                  </label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                      required
                      autoComplete="current-password"
                      className="w-full rounded-lg border border-gray-700 bg-primary/80 px-10 py-3 text-white outline-none transition placeholder:text-gray-600 focus:border-accent focus:ring-2 focus:ring-accent/25"
                    />
                  </div>
                </div>

                {needsOtp && (
                  <div>
                    <label htmlFor="otp" className="mb-2 block text-sm font-medium text-gray-300">
                      Two-factor code
                    </label>
                    <input
                      id="otp"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      autoComplete="one-time-code"
                      className="w-full rounded-lg border border-gray-700 bg-primary/80 px-4 py-3 text-center font-mono text-lg tracking-[0.28em] text-white outline-none transition placeholder:tracking-normal placeholder:text-gray-600 focus:border-accent focus:ring-2 focus:ring-accent/25"
                    />
                  </div>
                )}

                {error && (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Signing in...' : 'Sign in'}
                  {!loading && <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />}
                </button>
              </form>

              {initialized === false && (
                <div className="mt-6 rounded-lg border border-gray-700 bg-primary/40 px-4 py-3 text-center text-sm text-gray-400">
                  No account yet?{' '}
                  <Link href="/setup" className="font-medium text-accent hover:underline">
                    Run setup
                  </Link>
                </div>
              )}
            </div>

            <p className="mt-6 text-center text-xs text-gray-600">
              Protected session. Activity may be recorded in audit logs.
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
