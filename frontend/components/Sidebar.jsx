import Link from 'next/link'
import { useRouter } from 'next/router'
import {
  Box,
  Database,
  DownloadCloud,
  FileText,
  FolderTree,
  LayoutDashboard,
  LogOut,
  Monitor,
  Settings,
  Terminal,
  Workflow,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { useAuth } from '@/lib/hooks/useAuth'

export default function Sidebar() {
  const router = useRouter()
  const { logout } = useAuth()
  const { sidebarOpen, toggleSidebar } = useStore()

  const handleLogout = async () => {
    await logout()
  }

  const isActive = (path) => router.pathname === path

  return (
    <>
      <button
        onClick={toggleSidebar}
        className="fixed top-4 left-4 z-50 md:hidden p-2 rounded-lg bg-secondary border border-gray-700 text-white hover:bg-primary transition"
        aria-label="Open navigation"
      >
        <img src="/logo/ascend-mark.svg" alt="" className="h-6 w-6 object-contain" />
      </button>

      <aside
        className={`fixed md:relative w-64 h-screen bg-secondary border-r border-gray-700 transition-transform duration-300 z-40 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="p-6 h-full flex flex-col">
          <Link href="/dashboard" className="flex items-center mb-8 hover:opacity-90 transition" aria-label="Ascend dashboard">
            <img
              src="/logo/ascend-wordmark.svg"
              alt="Ascend"
              className="h-14 w-auto max-w-full object-contain"
            />
          </Link>

          <nav className="flex-1 space-y-2">
            <NavLink
              href="/dashboard"
              active={isActive('/dashboard')}
              icon={<LayoutDashboard className="w-5 h-5" />}
              label="Dashboard"
            />
            <NavLink
              href="/projects"
              active={isActive('/projects')}
              icon={<Box className="w-5 h-5" />}
              label="Projects"
            />
            <NavLink
              href="/system"
              active={isActive('/system')}
              icon={<Monitor className="w-5 h-5" />}
              label="System"
            />
            <NavLink
              href="/terminal"
              active={isActive('/terminal')}
              icon={<Terminal className="w-5 h-5" />}
              label="Terminal"
            />
            <NavLink
              href="/server-files"
              active={isActive('/server-files')}
              icon={<FolderTree className="w-5 h-5" />}
              label="Server Files"
            />
            <NavLink
              href="/databases"
              active={router.pathname.startsWith('/databases')}
              icon={<Database className="w-5 h-5" />}
              label="Databases"
            />
          </nav>

          <div className="border-t border-gray-700 my-4"></div>

          <div className="space-y-2">
            <NavLink
              href="/settings"
              active={router.pathname.startsWith('/settings')}
              icon={<Settings className="w-5 h-5" />}
              label="Settings"
            />
            <NavLink
              href="/workflow"
              active={isActive('/workflow')}
              icon={<Workflow className="w-5 h-5" />}
              label="Workflow"
            />
            <NavLink
              href="/audit"
              active={isActive('/audit')}
              icon={<FileText className="w-5 h-5" />}
              label="Audit Log"
            />
            <NavLink
              href="/update-center"
              active={isActive('/update-center')}
              icon={<DownloadCloud className="w-5 h-5" />}
              label="Update Center"
            />
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-gray-300 hover:bg-primary hover:text-white transition"
            >
              <LogOut className="w-5 h-5" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={toggleSidebar}
        />
      )}
    </>
  )
}

function NavLink({ href, active, icon, label }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-4 py-2 rounded-lg transition ${
        active
          ? 'bg-accent text-white'
          : 'text-gray-300 hover:bg-primary hover:text-white'
      }`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  )
}
