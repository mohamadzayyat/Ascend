import Link from 'next/link'
import { useRouter } from 'next/router'
import {
  Box,
  Database,
  DownloadCloud,
  FileText,
  FolderTree,
  Menu,
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
  const navItems = [
    { href: '/dashboard', active: isActive('/dashboard'), icon: <LayoutDashboard className="w-5 h-5" />, label: 'Dashboard' },
    { href: '/projects', active: isActive('/projects'), icon: <Box className="w-5 h-5" />, label: 'Projects' },
    { href: '/system', active: isActive('/system'), icon: <Monitor className="w-5 h-5" />, label: 'System' },
    { href: '/terminal', active: isActive('/terminal'), icon: <Terminal className="w-5 h-5" />, label: 'Terminal' },
    { href: '/server-files', active: isActive('/server-files'), icon: <FolderTree className="w-5 h-5" />, label: 'Files' },
    { href: '/databases', active: router.pathname.startsWith('/databases'), icon: <Database className="w-5 h-5" />, label: 'Databases' },
    { href: '/security', active: isActive('/security'), icon: <ShieldCheck className="w-5 h-5" />, label: 'Security' },
  ]
  const utilityItems = [
    { href: '/settings', active: router.pathname.startsWith('/settings'), icon: <Settings className="w-5 h-5" />, label: 'Settings' },
    { href: '/workflow', active: isActive('/workflow'), icon: <Workflow className="w-5 h-5" />, label: 'Workflow' },
    { href: '/audit', active: isActive('/audit'), icon: <FileText className="w-5 h-5" />, label: 'Audit' },
    { href: '/update-center', active: isActive('/update-center'), icon: <DownloadCloud className="w-5 h-5" />, label: 'Update' },
  ]
  const bottomItems = [
    navItems[0],
    navItems[1],
    navItems[5],
    navItems[6],
    utilityItems[0],
  ]

  return (
    <>
      <button
        onClick={toggleSidebar}
        className="fixed top-3 left-3 z-50 md:hidden p-2 rounded-lg bg-secondary border border-gray-700 text-white hover:bg-primary transition"
        aria-label="Open navigation"
      >
        <Menu className="h-6 w-6" />
      </button>

      <header className="fixed top-0 inset-x-0 z-30 h-16 border-b border-gray-800 bg-primary/95 backdrop-blur md:hidden">
        <div className="h-full flex items-center justify-center px-14">
          <Link href="/dashboard" aria-label="Ascend dashboard" className="inline-flex items-center">
            <img src="/logo/ascend-wordmark.svg" alt="Ascend" className="h-10 w-auto object-contain" />
          </Link>
        </div>
      </header>

      <aside
        className={`fixed md:relative w-[min(18rem,86vw)] ${sidebarCollapsed ? 'md:w-20' : 'md:w-64'} h-dvh bg-secondary border-r border-gray-700 transition-all duration-300 z-40 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <button
          type="button"
          onClick={toggleSidebarCollapsed}
          className="hidden md:inline-flex absolute -right-3 top-7 z-50 h-7 w-7 items-center justify-center rounded-md border border-gray-700 bg-primary text-gray-300 shadow-md hover:border-accent hover:text-white transition"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Minimize sidebar'}
        >
          {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
        <div className={`p-4 ${sidebarCollapsed ? 'md:px-3' : 'sm:p-6'} h-full flex flex-col overflow-y-auto`}>
          <div className={`flex items-center gap-2 mb-6 sm:mb-8 ${sidebarCollapsed ? 'md:justify-center' : 'justify-between'}`}>
            <Link href="/dashboard" className="flex items-center hover:opacity-90 transition min-w-0" aria-label="Ascend dashboard">
              <img
                src={sidebarCollapsed ? '/logo/ascend-mark.svg' : '/logo/ascend-wordmark.svg'}
                alt="Ascend"
                className={`${sidebarCollapsed ? 'md:h-9 h-12' : 'h-12 sm:h-14'} w-auto max-w-full object-contain`}
              />
            </Link>
          </div>

          <nav className="flex-1 space-y-2">
            {navItems.map((item) => (
              <NavLink key={item.href} {...item} collapsed={sidebarCollapsed} onClick={closeMobileNav} />
            ))}
          </nav>

          <div className="border-t border-gray-700 my-4"></div>

          <div className="space-y-2">
            {utilityItems.map((item) => (
              <NavLink key={item.href} {...item} collapsed={sidebarCollapsed} onClick={closeMobileNav} />
            ))}
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

      <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden border-t border-gray-800 bg-secondary/95 backdrop-blur">
        <div className="grid grid-cols-5">
          {bottomItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-1 py-2 text-[11px] ${item.active ? 'text-accent' : 'text-gray-400'}`}
            >
              {item.icon}
              <span className="truncate max-w-full px-1">{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </>
  )
}

function NavLink({ href, active, icon, label, collapsed, onClick }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`group/nav relative flex items-center gap-3 px-4 py-2 rounded-lg transition ${collapsed ? 'md:justify-center md:px-2' : ''} ${
        active
          ? 'bg-accent text-white'
          : 'text-gray-300 hover:bg-primary hover:text-white'
      }`}
    >
      {icon}
      <span className={collapsed ? 'md:hidden' : ''}>{label}</span>
      {collapsed && (
        <span className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-md border border-gray-700 bg-secondary px-2.5 py-1.5 text-xs text-white shadow-lg shadow-black/30 md:group-hover/nav:block">
          {label}
        </span>
      )}
    </Link>
  )
}
