import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import { Terminal as TerminalIcon, Lock, Loader2 } from 'lucide-react'
import { apiClient, terminalWebSocketUrl } from '@/lib/api'
import ShellPassphraseGate from '@/components/ShellPassphraseGate'

export default function TerminalPage() {
  const [state, setState] = useState('loading') // loading | locked | unlocked | unsupported
  const [needsSetup, setNeedsSetup] = useState(false)
  const [canSetup, setCanSetup] = useState(false)
  const [wsState, setWsState] = useState('connecting') // connecting | open | closed
  const [fontSize, setFontSize] = useState(16)

  const refreshStatus = async () => {
    try {
      const res = await apiClient.getTerminalStatus()
      const { supported, unlocked, needs_setup, can_setup } = res.data
      setNeedsSetup(!!needs_setup)
      setCanSetup(!!can_setup)
      if (!supported) setState('unsupported')
      else if (unlocked) setState('unlocked')
      else setState('locked')
    } catch {
      setState('locked')
    }
  }

  useEffect(() => {
    let cancelled = false
    apiClient.getTerminalStatus()
      .then((res) => {
        if (cancelled) return
        const { supported, unlocked, needs_setup, can_setup } = res.data
        setNeedsSetup(!!needs_setup)
        setCanSetup(!!can_setup)
        if (!supported) setState('unsupported')
        else if (unlocked) setState('unlocked')
        else setState('locked')
      })
      .catch(() => { if (!cancelled) setState('locked') })
    return () => { cancelled = true }
  }, [])

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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFontSize((size) => Math.max(12, size - 1))}
                disabled={fontSize <= 12}
                className="px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm disabled:opacity-40"
                title="Decrease font size"
              >
                A-
              </button>
              <span className="font-mono text-xs text-gray-400 w-10 text-center">{fontSize}px</span>
              <button
                type="button"
                onClick={() => setFontSize((size) => Math.min(24, size + 1))}
                disabled={fontSize >= 24}
                className="px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm disabled:opacity-40"
                title="Increase font size"
              >
                A+
              </button>
              <button
                onClick={onLock}
                className="inline-flex items-center gap-2 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm"
                title="Lock the terminal in this session (requires passphrase to reopen)"
              >
                <Lock className="w-4 h-4" /> Lock
              </button>
            </div>
          )}
        </div>

        {state === 'loading' && (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking terminal status…
          </div>
        )}

        {state === 'unsupported' && (
          <div className="max-w-lg rounded border border-yellow-500/30 bg-yellow-500/10 p-4 text-yellow-200 text-sm">
            Terminal is unavailable on this server. This host needs Linux PTY support and websocket support enabled.
          </div>
        )}

        {state === 'locked' && (
          <ShellPassphraseGate
            needsSetup={needsSetup}
            canSetup={canSetup}
            title="Unlock terminal"
            description="Enter the passphrase to open a shell. Stays unlocked until you log out."
            setupDescription="No shell passphrase is set yet for this install. Choose one to unlock the web terminal — it also gates the server files browser."
            onUnlock={async (pass) => {
              await apiClient.unlockTerminal(pass)
              setState('unlocked')
            }}
            onUnlocked={async () => {
              await refreshStatus()
              setState('unlocked')
            }}
          />
        )}

        {state === 'unlocked' && (
          <TerminalView
            wsState={wsState}
            setWsState={setWsState}
            fontSize={fontSize}
          />
        )}
      </div>
    </>
  )
}

function TerminalView({ wsState, setWsState, fontSize }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const wsRef = useRef(null)

  useEffect(() => {
    let disposed = false
    let cleanupResize = null
    let term
    let ws
    let receivedOutput = false

    // xterm has to load on the client only — dynamic import avoids SSR errors.
    async function boot() {
      setWsState('connecting')
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ])
      await import('@xterm/xterm/css/xterm.css')
      if (disposed || !hostRef.current) return

      term = new Terminal({
        fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
        fontSize,
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
        if (typeof evt.data === 'string') {
          receivedOutput = true
          term.write(evt.data)
        }
      }
      ws.onclose = () => {
        setWsState('closed')
        if (!receivedOutput) {
          try { term.writeln('\r\n\x1b[90m[connection closed - check websocket proxy headers, then reload or re-unlock]\x1b[0m') } catch { /* noop */ }
          return
        }
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
  }, [fontSize, setWsState])

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
