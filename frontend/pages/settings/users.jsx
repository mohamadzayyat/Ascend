import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2, Save, Trash2, Users } from 'lucide-react'
import { apiClient } from '@/lib/api'
import { useAuth } from '@/lib/hooks/useAuth'
import { useDialog } from '@/lib/dialog'

const ROLES = [
  ['admin', 'Admin'],
  ['deployer', 'Deploy only'],
  ['database', 'Database only'],
  ['viewer', 'Read only'],
]

const emptyNew = { username: '', email: '', role: 'viewer', password: '' }

export default function UsersSettingsPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [form, setForm] = useState(emptyNew)
  const [passwords, setPasswords] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const dialog = useDialog()

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await apiClient.listUsers()
      setUsers(data.users || [])
      setMessage('')
    } catch (e) {
      setMessage(e.response?.data?.error || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (user?.is_admin) load() }, [user?.is_admin])

  const create = async (e) => {
    e.preventDefault()
    setBusy(true); setMessage('')
    try {
      await apiClient.createUser(form)
      setForm(emptyNew)
      await load()
      setMessage('User created.')
    } catch (e) {
      setMessage(e.response?.data?.error || 'Failed to create user')
    } finally {
      setBusy(false)
    }
  }

  const update = async (row, patch = {}) => {
    setBusy(true); setMessage('')
    try {
      const payload = { email: row.email || '', role: row.role, ...patch }
      if (!payload.password) delete payload.password
      await apiClient.updateUser(row.id, payload)
      setPasswords((p) => ({ ...p, [row.id]: '' }))
      await load()
      setMessage('User updated.')
    } catch (e) {
      setMessage(e.response?.data?.error || 'Failed to update user')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (row) => {
    const ok = await dialog.typedConfirm({ title: 'Delete user?', message: `Delete user "${row.username}"?`, expected: row.username, confirmLabel: 'Delete user', tone: 'danger' })
    if (!ok) return
    setBusy(true); setMessage('')
    try {
      await apiClient.deleteUser(row.id, row.username)
      await load()
      setMessage('User deleted.')
    } catch (e) {
      setMessage(e.response?.data?.error || 'Failed to delete user')
    } finally {
      setBusy(false)
    }
  }

  if (!user?.is_admin) {
    return <div className="p-8 text-gray-400">Admin only.</div>
  }

  return (
    <div className="p-8 max-w-6xl">
      <Link href="/settings" className="text-gray-400 hover:text-white text-sm inline-flex items-center gap-1 mb-6">
        <ArrowLeft className="w-4 h-4" /> Settings
      </Link>
      <div className="mb-8 flex items-start gap-3">
        <Users className="w-10 h-10 text-accent shrink-0" />
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Users & roles</h1>
          <p className="text-gray-400 text-sm">Create accounts and assign coarse access roles.</p>
        </div>
      </div>

      {message && <div className="mb-4 rounded border border-gray-600 bg-secondary px-3 py-2 text-sm text-gray-200">{message}</div>}

      <form onSubmit={create} className="mb-6 rounded-lg border border-gray-700 bg-secondary p-5">
        <h2 className="text-white font-semibold mb-4">New user</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder="Username" className="bg-primary border border-gray-700 rounded px-3 py-2 text-white" />
          <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="Email optional" className="bg-primary border border-gray-700 rounded px-3 py-2 text-white" />
          <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className="bg-primary border border-gray-700 rounded px-3 py-2 text-white">
            {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="Password" className="bg-primary border border-gray-700 rounded px-3 py-2 text-white" />
        </div>
        <button type="submit" disabled={busy} className="mt-4 px-4 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold disabled:opacity-50">
          Create user
        </button>
      </form>

      <div className="rounded-lg border border-gray-700 bg-secondary overflow-hidden">
        {loading ? (
          <div className="p-6 text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[860px]">
              <thead className="bg-primary/60 text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">2FA</th>
                  <th className="px-4 py-3 font-medium">Reset password</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/70">
                {users.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-white font-medium">{row.username}</td>
                    <td className="px-4 py-3">
                      <input value={row.email || ''} onChange={(e) => setUsers((rows) => rows.map((u) => u.id === row.id ? { ...u, email: e.target.value } : u))} className="w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" />
                    </td>
                    <td className="px-4 py-3">
                      <select value={row.role || 'viewer'} onChange={(e) => setUsers((rows) => rows.map((u) => u.id === row.id ? { ...u, role: e.target.value } : u))} className="bg-primary border border-gray-700 rounded px-2 py-1.5 text-white">
                        {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span className={row.two_factor_enabled ? 'text-green-400' : 'text-amber-300'}>{row.two_factor_enabled ? 'enabled' : 'off'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <input type="password" value={passwords[row.id] || ''} onChange={(e) => setPasswords((p) => ({ ...p, [row.id]: e.target.value }))} placeholder="Leave blank" className="w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button type="button" onClick={() => update(row, { password: passwords[row.id] || '' })} disabled={busy} className="px-3 py-1.5 border border-gray-600 rounded text-white inline-flex items-center gap-1.5 hover:bg-primary/60 disabled:opacity-50">
                        <Save className="w-4 h-4" /> Save
                      </button>
                      <button type="button" onClick={() => remove(row)} disabled={busy || row.id === user.id} className="ml-2 px-3 py-1.5 border border-red-500/40 rounded text-red-200 inline-flex items-center gap-1.5 hover:bg-red-500/10 disabled:opacity-50">
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
