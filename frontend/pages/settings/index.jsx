import Link from 'next/link'
import { Github, Mail, Shield, ShieldCheck, Users } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'

export default function Settings() {
  const { user } = useAuth()

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Settings</h1>
        <p className="text-gray-400">Manage your account and integration settings.</p>
      </div>

      {/* Account info */}
      <div className="bg-secondary rounded-lg border border-gray-700 p-6 mb-6">
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5" /> Account
        </h2>
        <div className="space-y-2">
          <div className="flex items-center gap-4">
            <p className="text-gray-400 text-sm w-24">Username</p>
            <p className="text-white font-medium">{user?.username}</p>
          </div>
          {user?.email && (
            <div className="flex items-center gap-4">
              <p className="text-gray-400 text-sm w-24">Email</p>
              <p className="text-white">{user.email}</p>
            </div>
          )}
          <div className="flex items-center gap-4">
            <p className="text-gray-400 text-sm w-24">Role</p>
            <span className="px-2 py-1 rounded text-xs font-semibold bg-blue-500/20 text-blue-400">
              {user?.is_admin ? 'Admin' : 'User'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <p className="text-gray-400 text-sm w-24">2FA</p>
            <span className={`px-2 py-1 rounded text-xs font-semibold ${user?.two_factor_enabled ? 'bg-green-500/20 text-green-300' : 'bg-amber-500/20 text-amber-200'}`}>
              {user?.two_factor_enabled ? 'Enabled' : 'Off'}
            </span>
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {user?.is_admin && (
          <Link
            href="/settings/email"
            className="bg-secondary rounded-lg border border-gray-700 hover:border-accent p-6 transition group"
          >
            <div className="flex items-center gap-3 mb-2">
              <Mail className="w-6 h-6 text-accent" />
              <h3 className="text-white font-bold group-hover:text-accent transition">
                Email &amp; alerts
              </h3>
            </div>
            <p className="text-gray-400 text-sm">
              SMTP for backup, login, project, deployment, and terminal unlock notifications.
            </p>
          </Link>
        )}
        <Link
          href="/settings/security"
          className="bg-secondary rounded-lg border border-gray-700 hover:border-accent p-6 transition group"
        >
          <div className="flex items-center gap-3 mb-2">
            <ShieldCheck className="w-6 h-6 text-accent" />
            <h3 className="text-white font-bold group-hover:text-accent transition">
              Security
            </h3>
          </div>
          <p className="text-gray-400 text-sm">
            Enable two-factor authentication for safer admin login.
          </p>
        </Link>
        {user?.is_admin && (
          <Link
            href="/settings/users"
            className="bg-secondary rounded-lg border border-gray-700 hover:border-accent p-6 transition group"
          >
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-6 h-6 text-accent" />
              <h3 className="text-white font-bold group-hover:text-accent transition">
                Users &amp; roles
              </h3>
            </div>
            <p className="text-gray-400 text-sm">
              Create panel users, assign roles, and reset passwords.
            </p>
          </Link>
        )}
        <Link
          href="/settings/github"
          className="bg-secondary rounded-lg border border-gray-700 hover:border-accent p-6 transition group"
        >
          <div className="flex items-center gap-3 mb-2">
            <Github className="w-6 h-6 text-accent" />
            <h3 className="text-white font-bold group-hover:text-accent transition">
              GitHub Credentials
            </h3>
          </div>
          <p className="text-gray-400 text-sm">
            Manage Personal Access Tokens for cloning private repositories.
          </p>
        </Link>
      </div>
    </div>
  )
}
