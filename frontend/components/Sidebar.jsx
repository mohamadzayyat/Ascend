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
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Terminal,
  Workflow,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { useAuth } from '@/lib/hooks/useAuth'

export default function Sidebar() {
  const router = useRouter()
  const { logout } = useAuth()
  const { sidebarOpen, toggleSidebar, sidebarCollapsed, toggleSidebarCollapsed } = useStore()

  const handleLogout = async () => {
    await logout()
  }

  const closeMobileNav = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 768 && sidebarOpen) {
      toggleSidebar()
    }
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
        className={`fixed md:relative w-[min(18rem,86vw)] ${sidebarCollapsed ? 'md:w-20' : 'md:w-64'} h-dvh bg-secondary border-r border-gray-700 transition-all duration-300 z-40 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className={`p-4 ${sidebarCollapsed ? 'md:px-3' : 'sm:p-6'} h-full flex flex-col overflow-y-auto`}>
          <div className={`flex items-center gap-2 mb-6 sm:mb-8 ${sidebarCollapsed ? 'md:justify-center' : 'justify-between'}`}>
            <Link href="/dashboard" className="flex items-center hover:opacity-90 transition min-w-0" aria-label="Ascend dashboard">
              <img
                src={sidebarCollapsed ? '/logo/ascend-mark.svg' : '/logo/ascend-wordmark.svg'}
                alt="Ascend"
                className={`${sidebarCollapsed ? 'md:h-9 h-12' : 'h-12 sm:h-14'} w-auto max-w-full object-contain`}
              />
            </Link>
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              className="hidden md:inline-flex p-2 rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:bg-primary"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Minimize sidebar'}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Minimize sidebar'}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          </div>

          <nav className="flex-1 space-y-2">
            <NavLink
              href="/dashboard"
              active={isActive('/dashboard')}
              icon={<LayoutDashboard className="w-5 h-5" />}
              label="Dashboard"
              collapsed={sidebarCollapsed}
              onClick={closeMobileNav}
            />
            <NavLink
              href="/projects"
              active={isActive('/projects')}
              icon={<Box className="w-5 h-5" />}
              label="Projects"
              collapsed={sidebarCollapsed}
              onClick={closeMobileNav}
            />
            <NavLink
              href="/system"
              active={isActive('/system')}
              icon={<Monitor className="w-5 h-5" />}
              label="System"
              collapsed={sidebarCollapsed}
              onClick={closeMobileNav}
            />
            <NavLink
              href="/terminal"
              active={isActive('/terminal')}
              icon={<Terminal className="w-5 h-5" />}
              label="Terminal"
              collapsed={sidebarCollapsed}
              onClick={closeMobileNav}
            />
            <NavLink
              href="/server-files"
              active={isActive('/server-files')}
              icon={<FolderTree className="w-5 h-5" />}
              label="Server Files"
              collapsed={sidebarCollapsed}
              onClick={closeMobileNav}
            />
            <NavLink
              href="/databases"
              active={router.pathname.startsWith('/databases')}
              icon={<Database className="w-5 h-5" />}
              label="Databases"
              collapsed={sidebarCollapsed}
              onClick={closeMobileNav}
            />
            <NavLink
              href="/security"
              active={isActive('/security')}
              icon={<ShieldCheck className="w-5 h-5" />}
              label="Security"
              collapsed={sidebarCollapsed}
              onClick={closeMobileNav}
            />
          </nav>

          <div className="border-t border-gray-700 my-4"></div>

          <div className="space-y-2">
            <NavLink
              href="/settings"
              active={router.pathname.startsWith('/settings')}
              icon={<Settings className="w-5 h-5" />}
              label="Settings"
              collapsed={sidebarCollapsed}
              onClick={closeMobileNav}
            />
            <NavLink
              href="/workflow"
              active={isActive('/workflow')}
              icon={<Workflow className="w-5 h-5" />}
              label="Workflow"
              collapsed={sidebarCollapsed}
              onClick={closeMobileNav}
            />
            <NavLink
              href="/audit"
              active={isActive('/audit')}
              icon={<FileText className="w-5 h-5" />}
              label="Audit Log"
              collapsed={sidebarCollapsed}
              onClick={closeMobileNav}
            />
            <NavLink
              href="/update-center"
              active={isActive('/update-center')}
              icon={<DownloadCloud className="w-5 h-5" />}
              label="Update Center"
              collapsed={sidebarCollapsed}
              onClick={closeMobileNav}
            />
            <button
              onClick={handleLogout}
              className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg text-gray-300 hover:bg-primary hover:text-white transition ${sidebarCollapsed ? 'md:justify-center md:px-2' : ''}`}
              title={sidebarCollapsed ? 'Logout' : undefined}
            >
              <LogOut className="w-5 h-5" />
              <span className={sidebarCollapsed ? 'md:hidden' : ''}>Logout</span>
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

function NavLink({ href, active, icon, label, collapsed, onClick }) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2 rounded-lg transition ${collapsed ? 'md:justify-center md:px-2' : ''} ${
        active
          ? 'bg-accent text-white'
          : 'text-gray-300 hover:bg-primary hover:text-white'
      }`}
    >
      {icon}
      <span className={collapsed ? 'md:hidden' : ''}>{label}</span>
    </Link>
  )
}
