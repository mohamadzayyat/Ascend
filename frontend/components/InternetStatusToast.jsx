import { useEffect, useRef, useState } from 'react'
import { Wifi, WifiOff } from 'lucide-react'

const CHECK_URL = 'https://www.gstatic.com/generate_204'

async function hasInternet() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    await fetch(`${CHECK_URL}?ascend=${Date.now()}`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export default function InternetStatusToast() {
  const [status, setStatus] = useState('online')
  const [visible, setVisible] = useState(false)
  const statusRef = useRef('online')
  const firstCheckRef = useRef(true)
  const hideTimerRef = useRef(null)

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    const show = (next) => {
      setStatus(next)
      setVisible(true)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      if (next === 'online') {
        hideTimerRef.current = setTimeout(() => setVisible(false), 3200)
      }
    }

    const check = async ({ forceShow = false } = {}) => {
      const ok = await hasInternet()
      const next = ok ? 'online' : 'offline'
      const previous = statusRef.current
      setStatus(next)
      if (firstCheckRef.current) {
        firstCheckRef.current = false
        if (next === 'offline') show(next)
        return
      }
      if (forceShow || next !== previous) show(next)
      if (next === 'online' && previous === 'online' && !forceShow) setVisible(false)
    }

    const onOffline = () => show('offline')
    const onOnline = () => check({ forceShow: true })

    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    check()
    const interval = setInterval(check, 15000)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      clearInterval(interval)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [])

  if (!visible) return null

  const offline = status === 'offline'
  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[240] -translate-x-1/2 px-4">
      <div className={`pointer-events-auto flex min-w-[260px] items-center gap-3 rounded-full border px-4 py-3 shadow-2xl backdrop-blur-md transition-all ${
        offline
          ? 'border-red-500/40 bg-red-950/90 text-red-50'
          : 'border-green-500/40 bg-green-950/90 text-green-50'
      }`}>
        <span className={`grid h-8 w-8 place-items-center rounded-full ${offline ? 'bg-red-500/20' : 'bg-green-500/20'}`}>
          {offline ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{offline ? 'No internet connection' : 'Back online'}</span>
          <span className={`block text-xs ${offline ? 'text-red-100/75' : 'text-green-100/75'}`}>
            {offline ? 'Ascend will retry live checks automatically.' : 'Connection restored.'}
          </span>
        </span>
      </div>
    </div>
  )
}
