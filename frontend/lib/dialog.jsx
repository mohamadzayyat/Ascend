import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

const DialogContext = createContext(null)

export function useDialog() {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used inside DialogProvider')
  return ctx
}

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const [value, setValue] = useState('')
  const resolverRef = useRef(null)

  const open = useCallback((next) => new Promise((resolve) => {
    resolverRef.current = resolve
    setValue(next.defaultValue || '')
    setDialog(next)
  }), [])

  const close = useCallback((result) => {
    resolverRef.current?.(result)
    resolverRef.current = null
    setDialog(null)
    setValue('')
  }, [])

  const api = useMemo(() => ({
    alert: ({ title = 'Notice', message = '', tone = 'info' }) =>
      open({ mode: 'alert', title, message, tone }).then(() => true),
    confirm: ({ title = 'Confirm action', message = '', confirmLabel = 'Confirm', tone = 'danger' }) =>
      open({ mode: 'confirm', title, message, confirmLabel, tone }),
    prompt: ({ title = 'Input required', message = '', label = '', placeholder = '', defaultValue = '', confirmLabel = 'Continue', tone = 'info', required = false }) =>
      open({ mode: 'prompt', title, message, label, placeholder, defaultValue, confirmLabel, tone, required }),
    typedConfirm: ({ title = 'Confirm action', message = '', expected, confirmLabel = 'Confirm', tone = 'danger' }) =>
      open({ mode: 'typed', title, message, expected, confirmLabel, tone }),
  }), [open])

  const toneClasses = dialog?.tone === 'danger'
    ? 'border-red-500/40 bg-red-500/10 text-red-200'
    : dialog?.tone === 'warning'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
      : 'border-accent/40 bg-accent/10 text-blue-100'
  const confirmClasses = dialog?.tone === 'danger'
    ? 'bg-red-500 hover:bg-red-400'
    : dialog?.tone === 'warning'
      ? 'bg-amber-500 hover:bg-amber-400 text-gray-950'
      : 'bg-accent hover:bg-accent/80'
  const canConfirm = dialog?.mode === 'typed'
    ? value === dialog.expected
    : dialog?.mode === 'prompt' && dialog.required
      ? value.trim().length > 0
      : true

  const submit = () => {
    if (!canConfirm) return
    if (dialog.mode === 'alert') close(true)
    else if (dialog.mode === 'confirm') close(true)
    else if (dialog.mode === 'typed') close(value === dialog.expected)
    else close(value)
  }

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-gray-700 bg-secondary shadow-2xl">
            <div className={`m-4 rounded border p-3 ${toneClasses}`}>
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <h2 className="text-white font-semibold">{dialog.title}</h2>
                  {dialog.message && <p className="mt-1 text-sm opacity-90 whitespace-pre-wrap">{dialog.message}</p>}
                </div>
              </div>
            </div>
            {(dialog.mode === 'prompt' || dialog.mode === 'typed') && (
              <div className="px-4 pb-4">
                {dialog.mode === 'typed' && (
                  <p className="text-xs text-gray-400 mb-2">
                    Type exactly: <span className="font-mono text-white">{dialog.expected}</span>
                  </p>
                )}
                {dialog.label && <label className="block text-xs text-gray-400 mb-2">{dialog.label}</label>}
                <input
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit()
                    if (e.key === 'Escape') close(dialog.mode === 'prompt' ? null : false)
                  }}
                  placeholder={dialog.placeholder || ''}
                  className="w-full rounded border border-gray-700 bg-primary px-3 py-2 text-white placeholder-gray-500 outline-none focus:border-accent"
                />
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-gray-700 px-4 py-3">
              {dialog.mode !== 'alert' && (
                <button
                  type="button"
                  onClick={() => close(dialog.mode === 'prompt' ? null : false)}
                  className="px-3 py-2 rounded border border-gray-600 text-gray-300 hover:text-white hover:border-gray-500 text-sm"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                disabled={!canConfirm}
                onClick={submit}
                className={`px-3 py-2 rounded text-white text-sm font-semibold disabled:opacity-50 ${confirmClasses}`}
              >
                {dialog.mode === 'alert' ? 'OK' : dialog.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}
