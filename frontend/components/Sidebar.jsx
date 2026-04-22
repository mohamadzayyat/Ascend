import Link from 'next/link'
import { useRouter } from 'next/router'
import { Menu, LogOut, Settings, Github } from 'lucide-react'
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
      {/* Mobile Menu Button */}
      <button
        onClick={toggleSidebar}
        className="fixed top-4 left-4 z-50 md:hidden p-2 rounded-lg bg-secondary border border-gray-700 text-white hover:bg-primary transition"
      >
        <Menu className="w-6 h-6" />
      </button>

      {/* Sidebar */}
      <aside
        className={`fixed md:relative w-64 h-screen bg-secondary border-r border-gray-700 transition-transform duration-300 z-40 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="p-6 h-full flex flex-col">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2 mb-8 text-xl font-bold text-white hover:text-accent transition">
            <span className="text-2xl">🚀</span>
            Ascend
          </Link>

          {/* Navigation */}
          <nav className="flex-1 space-y-2">
            <NavLink
              href="/dashboard"
              active={isActive('/dashboard')}
              icon="📊"
              label="Dashboard"
            />
            <NavLink
              href="/projects"
              active={isActive('/projects')}
              icon="📦"
              label="Projects"
            />
            <NavLink
              href="/settings/github"
              active={isActive('/settings/github')}
              icon="🔑"
              label="GitHub Credentials"
            />
          </nav>

          {/* Divider */}
          <div className="border-t border-gray-700 my-4"></div>

          {/* Bottom Actions */}
          <div className="space-y-2">
            <NavLink
              href="/settings"
              active={isActive('/settings')}
              icon={<Settings className="w-5 h-5" />}
              label="Settings"
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

      {/* Overlay */}
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
      {typeof icon === 'string' ? (
        <span className="text-lg">{icon}</span>
      ) : (
        icon
      )}
      <span>{label}</span>
    </Link>
  )
}
