import React, { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/hooks/useAuth'
import Sidebar from '@/components/Sidebar'
import '../styles/globals.css'
import '@xyflow/react/dist/style.css'

const PUBLIC_PATHS = ['/login', '/setup']

export default function App({ Component, pageProps }) {
  const router = useRouter()
  const { user, loading } = useAuth()

  const isPublic = PUBLIC_PATHS.includes(router.pathname)

  useEffect(() => {
    if (!loading && !user && !isPublic) {
      router.replace('/login')
    }
  }, [loading, user, isPublic, router])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-primary">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full spinner mx-auto mb-4" />
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user && !isPublic) {
    return null
  }

  if (user && !isPublic) {
    return (
      <div className="flex h-screen bg-primary">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Component {...pageProps} />
        </main>
      </div>
    )
  }

  return <Component {...pageProps} />
}
