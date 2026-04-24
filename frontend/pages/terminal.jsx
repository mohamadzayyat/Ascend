import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import { Terminal as TerminalIcon, Lock, Loader2 } from 'lucide-react'
import { apiClient, terminalWebSocketUrl } from '@/lib/api'

export default function TerminalPage() {
  const [state, setState] = useState('loading') // loading | locked | unlocked | unsupported
  const [passphrase, setPassphrase] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [wsState, setWsState] = useState('connecting') // connecting | open | closed

  useEffect(() => {
    let cancelled = false
    apiClient.getTerminalStatus()
      .then((res) => {
        if (cancelled) return
        const { supported, unlocked } = res.data
        if (!supported) setState('unsupported')
        else if (unlocked) setState('unlocked')
        else setState('locked')
      })
      .catch(() => { if (!cancelled) setState('locked') })
    return () => { cancelled = true }
  }, [])

  const onUnlock = async (e) => {
    e.preventDefault()
    if (unlocking) return
    setUnlockError('')
    setUnlocking(true)
    try {
      await apiClient.unlockTerminal(passphrase)
      setPassphrase('')
      setState('unlocked')
    } catch (err) {
      setUnlockError(err.response?.data?.error || 'Unlock failed')
    } finally {
      setUnlocking(false)
    }
  }

  const onLock = async () => {
    try { await apiClient.lockTerminal() } catch { /* ignore */ }
    setState('locked')
  }

  return (
    <>
      <Head><title>Terminal · Ascend</title></Head>
      <div className="p-8 h-full flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <TerminalIcon className="w-8 h-8 text-accent" /> Terminal
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Interactive server shell. Behaves like SSH — arrow keys, history, copy/paste, colors.
            </p>
          </div>
          {state === 'unlocked' && (
            <button
              onClick={onLock}
              className="inline-flex items-center gap-2 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm"
              title="Lock the terminal in this session (requires passphrase to reopen)"
            >
              <Lock className="w-4 h-4" /> Lock
            </button>
          )}
        </div>

        {state === 'loading' && (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking terminal status…
          </div>
        )}

        {state === 'unsupported' && (
          <div className="max-w-lg rounded border border-yellow-500/30 bg-yellow-500/10 p-4 text-yellow-200 text-sm">
            Terminal is only available on Linux servers. This host does not expose a PTY.
          </div>
        )}

        {state === 'locked' && (
          <form
            onSubmit={onUnlock}
            className="max-w-md w-full rounded border border-gray-700 bg-secondary p-6 space-y-4"
          >
            <div>
              <h2 className="text-white font-semibold mb-1">Unlock terminal</h2>
              <p className="text-gray-400 text-sm">
                Enter the passphrase to open a shell. Stays unlocked until you log out.
              </p>
            </div>
            <input
              autoFocus
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Passphrase"
              className="w-full px-3 py-2 bg-primary border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-accent"
            />
            {unlockError && (
              <div className="rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300 text-sm">
                {unlockError}
              </div>
            )}
            <button
              type="submit"
              disabled={unlocking || !passphrase}
              className="w-full px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold disabled:opacity-50"
            >
              {unlocking ? 'Unlocking…' : 'Unlock'}
            </button>
          </form>
        )}

        {state === 'unlocked' && (
          <TerminalView wsState={wsState} setWsState={setWsState} />
        )}
      </div>
    </>
  )
}

function TerminalView({ wsState, setWsState }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const wsRef = useRef(null)

  useEffect(() => {
    let disposed = false
    let cleanupResize = null
    let term
    let ws

    // xterm has to load on the client only — dynamic import avoids SSR errors.
    async function boot() {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ])
      await import('@xterm/xterm/css/xterm.css')
      if (disposed || !hostRef.current) return

      term = new Terminal({
        fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
        fontSize: 13,
        cursorBlink: true,
        scrollback: 10000,
        theme: {
          background: '#0b0f17',
          foreground: '#e5e7eb',
          cursor: '#60a5fa',
          selectionBackground: '#334155',
        },
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.loadAddon(new WebLinksAddon())
      term.open(hostRef.current)
      try { fit.fit() } catch { /* noop */ }
      term.focus()
      termRef.current = term
      fitRef.current = fit

      ws = new WebSocket(terminalWebSocketUrl())
      wsRef.current = ws

      const send = (obj) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
      }

      ws.onopen = () => {
        setWsState('open')
        send({ type: 'resize', cols: term.cols, rows: term.rows })
      }
      ws.onmessage = (evt) => {
        if (typeof evt.data === 'string') term.write(evt.data)
      }
      ws.onclose = () => {
        setWsState('closed')
        try { term.writeln('\r\n\x1b[90m[connection closed — reload or re-unlock to reconnect]\x1b[0m') } catch { /* noop */ }
      }
      ws.onerror = () => {
        setWsState('closed')
      }

      term.onData((data) => send({ type: 'input', data }))

      const onResize = () => {
        try { fit.fit() } catch { /* noop */ }
        send({ type: 'resize', cols: term.cols, rows: term.rows })
      }
      window.addEventListener('resize', onResize)
      cleanupResize = () => window.removeEventListener('resize', onResize)
    }

    boot()

    return () => {
      disposed = true
      if (cleanupResize) cleanupResize()
      try { wsRef.current?.close() } catch { /* noop */ }
      try { termRef.current?.dispose() } catch { /* noop */ }
    }
  }, [setWsState])

  // Ctrl+Shift+V paste from clipboard into the PTY. Ctrl+Shift+C is xterm's
  // default copy binding and needs no extra wiring.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        navigator.clipboard.readText().then((text) => {
          const ws = wsRef.current
          if (text && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data: text }))
          }
        }).catch(() => { /* clipboard denied */ })
      }
    }
    const host = hostRef.current
    host?.addEventListener('keydown', onKey)
    return () => host?.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex-1 flex flex-col min-h-0 rounded border border-gray-700 bg-[#0b0f17] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700 bg-secondary text-xs text-gray-400">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${wsState === 'open' ? 'bg-green-500' : wsState === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'}`} />
          <span>
            {wsState === 'open' ? 'connected' : wsState === 'connecting' ? 'connecting…' : 'disconnected'}
          </span>
        </div>
        <div className="text-gray-500">Ctrl+Shift+C copy · Ctrl+Shift+V paste</div>
      </div>
      <div ref={hostRef} className="flex-1 min-h-0" />
    </div>
  )
}
