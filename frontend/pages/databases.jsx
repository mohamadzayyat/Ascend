import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Head from 'next/head'
import {
  Database, Plus, Trash2, Play, Download, RefreshCw, Loader2,
  CheckCircle2, XCircle, AlertTriangle, Save, Pencil, Calendar, Table as TableIcon,
  ChevronDown, ChevronRight, Folder, Server, Eye, Code2, ScrollText, Search, X,
  UploadCloud, RotateCcw,
} from 'lucide-react'
import { apiClient } from '@/lib/api'

const DialogContext = createContext(null)

function useDialog() {
  return useContext(DialogContext)
}

function DatabaseDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const [typedValue, setTypedValue] = useState('')
  const resolverRef = useRef(null)

  const openDialog = useCallback((next) => new Promise((resolve) => {
    resolverRef.current = resolve
    setTypedValue(next.defaultValue || '')
    setDialog(next)
  }), [])

  const closeDialog = useCallback((result) => {
    resolverRef.current?.(result)
    resolverRef.current = null
    setDialog(null)
    setTypedValue('')
  }, [])

  const value = useMemo(() => ({
    alert: ({ title = 'Notice', message, tone = 'info' }) => openDialog({ mode: 'alert', title, message, tone }),
    confirm: ({ title = 'Confirm action', message, confirmLabel = 'Confirm', tone = 'danger' }) =>
      openDialog({ mode: 'confirm', title, message, confirmLabel, tone }),
    prompt: ({ title = 'Input required', message = '', label = '', defaultValue = '', confirmLabel = 'Continue', tone = 'info', required = false }) =>
      openDialog({ mode: 'prompt', title, message, label, defaultValue, confirmLabel, tone, required }),
    typedConfirm: ({ title = 'Confirm action', message, expected, confirmLabel = 'Confirm', tone = 'danger' }) =>
      openDialog({ mode: 'typed', title, message, expected, confirmLabel, tone }),
  }), [openDialog])

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
  const typedOk = dialog?.mode === 'typed'
    ? typedValue === dialog.expected
    : dialog?.mode === 'prompt' && dialog.required
      ? typedValue.trim().length > 0
      : true

  return (
    <DialogContext.Provider value={value}>
      {children}
      {dialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
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
            {(dialog.mode === 'typed' || dialog.mode === 'prompt') && (
              <div className="px-4 pb-2">
                {dialog.mode === 'typed' ? (
                  <label className="block text-sm text-gray-300 mb-2">
                    Type <span className="font-mono text-white">{dialog.expected}</span> to continue
                  </label>
                ) : (
                  dialog.label && <label className="block text-sm text-gray-300 mb-2">{dialog.label}</label>
                )}
                <input
                  autoFocus
                  value={typedValue}
                  onChange={(e) => setTypedValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && typedOk) closeDialog(dialog.mode === 'prompt' ? typedValue : true)
                    if (e.key === 'Escape') closeDialog(false)
                  }}
                  className="w-full bg-primary border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}
            <div className="flex items-center justify-end gap-2 border-t border-gray-700 px-4 py-3">
              {dialog.mode !== 'alert' && (
                <button
                  type="button"
                  onClick={() => closeDialog(false)}
                  className="px-3 py-2 rounded border border-gray-600 text-gray-200 hover:bg-primary text-sm"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                disabled={!typedOk}
                  onClick={() => closeDialog(dialog.mode === 'prompt' ? typedValue : dialog.mode === 'alert' ? undefined : true)}
                className={`px-3 py-2 rounded text-white text-sm font-semibold disabled:opacity-50 ${dialog.mode === 'alert' ? 'bg-accent hover:bg-accent/80' : confirmClasses}`}
              >
                {dialog.mode === 'alert' ? 'OK' : dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}

const TABS = [
  { id: 'browse',   label: 'Browse',   icon: TableIcon },
  { id: 'manage',   label: 'Manage',   icon: Database },
  { id: 'sql',      label: 'SQL',      icon: Play },
  { id: 'backups',  label: 'Backups',  icon: Download },
  { id: 'restore',  label: 'Restore',  icon: RotateCcw },
  { id: 'schedule', label: 'Schedule', icon: Calendar },
]

const DB_CHARSETS = ['utf8mb4', 'utf8', 'latin1']
const DB_COLLATIONS = {
  utf8mb4: ['utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8mb4_0900_ai_ci', 'utf8mb4_bin'],
  utf8: ['utf8_general_ci', 'utf8_unicode_ci', 'utf8_bin'],
  latin1: ['latin1_swedish_ci', 'latin1_general_ci', 'latin1_bin'],
}

const MYSQL_PRIVILEGE_OPTIONS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'INDEX', 'ALTER', 'CREATE VIEW', 'SHOW VIEW', 'TRIGGER']
const COLUMN_TYPES = ['INT', 'BIGINT', 'VARCHAR', 'TEXT', 'LONGTEXT', 'DECIMAL', 'DATETIME', 'TIMESTAMP', 'DATE', 'TINYINT', 'BOOLEAN', 'JSON']

async function copyTextToClipboard(text) {
  const value = String(text || '')
  if (!value) return false
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value)
    return true
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } finally {
    textarea.remove()
  }
  return ok
}

function columnDefinitionPreview(col) {
  const name = col.name?.trim() || 'column_name'
  const type = col.type || 'VARCHAR'
  const length = col.length?.trim() || (type === 'VARCHAR' ? '255' : '')
  const typeSql = length ? `${type}(${length})` : type
  const parts = [`\`${name}\` ${typeSql}`, col.nullable ? 'NULL' : 'NOT NULL']
  if (col.default !== undefined && col.default !== '') parts.push(String(col.default).toUpperCase() === 'NULL' ? 'DEFAULT NULL' : `DEFAULT '${String(col.default).replace(/'/g, "''")}'`)
  if (col.auto_increment) parts.push('AUTO_INCREMENT')
  return parts.join(' ')
}

const COMMON_TIMEZONES = [
  'Asia/Beirut',
  'Asia/Jerusalem',
  'Asia/Dubai',
  'Asia/Riyadh',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
]

function newTableTabId() {
  return `tbl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export default function DatabasesPage() {
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [panelTab, setPanelTab] = useState('browse')
  const [openTableTabs, setOpenTableTabs] = useState([])
  const [browseSelection, setBrowseSelection] = useState(null)
  /** When set, SQL tab applies this to the editor once then clears via callback. */
  const [pendingSql, setPendingSql] = useState(null)
  const consumePendingSql = useCallback(() => setPendingSql(null), [])
  const active = useMemo(
    () => connections.find((c) => c.id === activeId) || null,
    [connections, activeId],
  )

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await apiClient.listDbConnections()
      setConnections(res.data.connections)
      if (!activeId && res.data.connections.length > 0) {
        setActiveId(res.data.connections[0].id)
      }
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load connections.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() /* eslint-disable-next-line */ }, [])

  const onConnectionDeleted = (id) => {
    setConnections((prev) => {
      const next = prev.filter((c) => c.id !== id)
      if (activeId === id) {
        setActiveId(next[0]?.id || null)
        setBrowseSelection(null)
      }
      return next
    })
  }

  const handleActivateConnection = (connId) => {
    if (connId !== activeId) {
      setOpenTableTabs([])
      setPanelTab('browse')
    }
    setActiveId(connId)
    setBrowseSelection((sel) => {
      if (!sel) return null
      if (sel.connectionId === connId) return sel
      return null
    })
  }

  const openTableTab = useCallback((database, name, kind) => {
    let targetId = null
    setOpenTableTabs((prev) => {
      const hit = prev.find((t) => t.database === database && t.name === name && t.kind === kind)
      if (hit) {
        targetId = hit.id
        return prev
      }
      targetId = newTableTabId()
      return [...prev, { id: targetId, database, name, kind }]
    })
    if (targetId) setPanelTab(targetId)
  }, [])

  const closeTableTab = useCallback((tabId) => {
    setOpenTableTabs((prev) => prev.filter((t) => t.id !== tabId))
    setPanelTab((cur) => (cur === tabId ? 'browse' : cur))
  }, [])

  const onOpenTableFolder = useCallback((connId, database, folder) => {
    setActiveId(connId)
    setBrowseSelection({ connectionId: connId, database, folder })
    setPanelTab('browse')
  }, [])

  const onBrowseObject = (connId, database, name, kind) => {
    setActiveId(connId)
    setBrowseSelection({ connectionId: connId, database, name, kind })
    setPanelTab('browse')
  }

  const onRoutineInspect = (connId, database, name, routineType) => {
    setActiveId(connId)
    const rt = routineType === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE'
    setPendingSql(`SHOW CREATE ${rt} \`${database}\`.\`${name}\``)
    setPanelTab('sql')
  }

  return (
    <DatabaseDialogProvider>
      <Head><title>Databases · Ascend</title></Head>
      <div className="px-3 py-2 h-full flex flex-col min-h-0">
        <div className="flex items-center justify-between gap-3 mb-2 shrink-0 border-b border-gray-800/80 pb-2">
          <div className="min-w-0 flex items-center gap-2">
            <Database className="w-5 h-5 text-accent shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-white leading-tight">Databases</h1>
              <p className="text-[11px] text-gray-500 leading-snug truncate">
                Connections, browse, SQL, backups — per-database schedules below.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-accent hover:bg-accent/80 rounded text-white text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" /> New connection
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading connections…
          </div>
        )}

        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm mb-4">
            {error}
          </div>
        )}

        {!loading && connections.length === 0 && !showAddForm && (
          <div className="rounded border border-gray-700 bg-secondary p-6 text-gray-300 text-sm">
            No database connections yet. Click <strong>New connection</strong> above to add one.
          </div>
        )}

        {showAddForm && (
          <ConnectionForm
            onCancel={() => setShowAddForm(false)}
            onSaved={(c) => {
              setConnections((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))
              setActiveId(c.id)
              setShowAddForm(false)
            }}
          />
        )}

        {connections.length > 0 && (
          <div className="flex flex-1 min-h-0 gap-4">
            <SchemaNavigator
              connections={connections}
              activeConnectionId={activeId}
              browseSelection={browseSelection}
              onConnectionActivate={handleActivateConnection}
              onBrowseObject={onBrowseObject}
              onTableLeafDoubleClick={(connId, database, name, kind) => {
                setActiveId(connId)
                openTableTab(database, name, kind)
              }}
              onOpenTableFolder={onOpenTableFolder}
              onRoutineInspect={onRoutineInspect}
              onDeleted={onConnectionDeleted}
              onRefresh={refresh}
            />
            {active && (
              <ConnectionPanel
                connection={active}
                tab={panelTab}
                onTabChange={setPanelTab}
                openTableTabs={openTableTabs}
                onCloseTableTab={closeTableTab}
                browseSelection={browseSelection}
                onBrowseSelectionChange={setBrowseSelection}
                onOpenTableTab={openTableTab}
                pendingSql={pendingSql}
                onPendingSqlConsumed={consumePendingSql}
              />
            )}
          </div>
        )}
      </div>
    </DatabaseDialogProvider>
  )
}

// ── Sidebar: connection → databases → tables / views / routines ─

const SCHEMA_CATEGORIES = [
  { id: 'tables', label: 'Tables', icon: TableIcon, key: 'tables' },
  { id: 'views', label: 'Views', icon: Eye, key: 'views' },
  { id: 'functions', label: 'Functions', icon: Code2, key: 'functions' },
  { id: 'procedures', label: 'Procedures', icon: ScrollText, key: 'procedures' },
]

function SchemaNavigator({
  connections,
  activeConnectionId,
  browseSelection,
  onConnectionActivate,
  onBrowseObject,
  onTableLeafDoubleClick,
  onOpenTableFolder,
  onRoutineInspect,
  onDeleted,
  onRefresh,
}) {
  const dialog = useDialog()
  const [busyId, setBusyId] = useState(null)
  const [testResults, setTestResults] = useState({})
  const [expandedConn, setExpandedConn] = useState(() => new Set())
  const [expandedDb, setExpandedDb] = useState(() => new Set())
  const [expandedCat, setExpandedCat] = useState(() => new Set())
  const [dbsByConn, setDbsByConn] = useState({})
  const [loadingDbs, setLoadingDbs] = useState({})
  const [schemaByKey, setSchemaByKey] = useState({})
  const [loadingSchema, setLoadingSchema] = useState({})

  const toggleSet = (setter, key) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const loadDatabases = async (cid) => {
    if (dbsByConn[cid] || loadingDbs[cid]) return
    setLoadingDbs((m) => ({ ...m, [cid]: true }))
    try {
      const res = await apiClient.listDatabases(cid)
      const user = res.data.databases || []
      const system = res.data.system_databases || []
      setDbsByConn((m) => ({ ...m, [cid]: [...user, ...system] }))
    } catch {
      setDbsByConn((m) => ({ ...m, [cid]: [] }))
    } finally {
      setLoadingDbs((m) => ({ ...m, [cid]: false }))
    }
  }

  const loadSchema = async (cid, dbName) => {
    const sk = `${cid}:${dbName}`
    if (schemaByKey[sk] || loadingSchema[sk]) return
    setLoadingSchema((m) => ({ ...m, [sk]: true }))
    try {
      const res = await apiClient.getDatabaseSchema(cid, dbName)
      setSchemaByKey((m) => ({ ...m, [sk]: res.data }))
    } catch {
      setSchemaByKey((m) => ({
        ...m,
        [sk]: { tables: [], views: [], functions: [], procedures: [] },
      }))
    } finally {
      setLoadingSchema((m) => ({ ...m, [sk]: false }))
    }
  }

  const onToggleConnection = (e, cid) => {
    e.stopPropagation()
    const open = expandedConn.has(cid)
    toggleSet(setExpandedConn, cid)
    if (!open) loadDatabases(cid)
  }

  const onToggleDb = (e, cid, dbName) => {
    e.stopPropagation()
    const dk = `${cid}:${dbName}`
    const open = expandedDb.has(dk)
    toggleSet(setExpandedDb, dk)
    if (!open) loadSchema(cid, dbName)
  }

  const onToggleCat = (e, cid, dbName, catId) => {
    e.stopPropagation()
    toggleSet(setExpandedCat, `${cid}:${dbName}:${catId}`)
  }

  const onTest = async (c) => {
    setBusyId(c.id)
    try {
      const res = await apiClient.testDbConnection(c.id)
      setTestResults((prev) => ({ ...prev, [c.id]: res.data }))
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [c.id]: { ok: false, error: err.response?.data?.error || 'Test failed' },
      }))
    } finally {
      setBusyId(null)
    }
  }

  const onDelete = async (c) => {
    const ok = await dialog.confirm({
      title: 'Delete database connection?',
      message: `Delete "${c.name}"?\n\nBackups on disk for this connection will also be removed.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    setBusyId(c.id)
    try {
      await apiClient.deleteDbConnection(c.id)
      onDeleted(c.id)
      setExpandedConn((s) => {
        const next = new Set(s)
        next.delete(c.id)
        return next
      })
    } catch (err) {
      await dialog.alert({ title: 'Delete failed', message: err.response?.data?.error || 'Delete failed', tone: 'danger' })
    } finally {
      setBusyId(null)
    }
  }

  const leafSelected = (cid, dbName, name, kind) =>
    browseSelection?.connectionId === cid
    && browseSelection.database === dbName
    && browseSelection.name === name
    && browseSelection.kind === kind

  const folderActive = (cid, dbName, catId) =>
    browseSelection?.connectionId === cid
    && browseSelection.database === dbName
    && browseSelection.folder === catId

  return (
    <div className="w-80 shrink-0 rounded border border-gray-700 bg-secondary flex flex-col min-h-0 max-h-full">
      <div className="p-3 border-b border-gray-700 flex items-center justify-between shrink-0">
        <span className="text-xs uppercase tracking-wide text-gray-400">Navigator</span>
        <button
          type="button"
          onClick={() => {
            onRefresh()
            setDbsByConn({})
            setSchemaByKey({})
          }}
          className="text-gray-400 hover:text-white"
          title="Refresh tree"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      <div className="overflow-y-auto flex-1 min-h-0 text-sm">
        {connections.map((c) => {
          const connOpen = expandedConn.has(c.id)
          const isActiveConn = c.id === activeConnectionId
          const test = testResults[c.id]
          const dbs = dbsByConn[c.id]
          const loadingD = loadingDbs[c.id]

          return (
            <div key={c.id} className="border-b border-gray-700/80">
              <div
                role="button"
                tabIndex={0}
                onClick={() => onConnectionActivate(c.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') onConnectionActivate(c.id) }}
                className={`flex items-start gap-1 px-2 py-2 cursor-pointer ${
                  isActiveConn ? 'bg-primary/60' : 'hover:bg-primary/30'
                }`}
              >
                <button
                  type="button"
                  className="p-0.5 mt-0.5 text-gray-400 hover:text-white shrink-0"
                  aria-expanded={connOpen}
                  title={connOpen ? 'Collapse connection' : 'Expand databases'}
                  onClick={(e) => onToggleConnection(e, c.id)}
                >
                  {connOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                <Server className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-white font-medium truncate">{c.name}</div>
                  <div className="text-gray-500 text-xs truncate">{c.username}@{c.host}:{c.port}</div>
                  {test?.ok && (
                    <div className="text-green-400/80 text-xs mt-0.5 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> {test.server_version}
                    </div>
                  )}
                  {test?.ok === false && (
                    <div className="text-red-400/80 text-xs mt-0.5 truncate" title={test.error}>{test.error}</div>
                  )}
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onTest(c) }}
                      disabled={busyId === c.id}
                      className="text-[11px] text-accent hover:underline disabled:opacity-50"
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDelete(c) }}
                      disabled={busyId === c.id}
                      className="text-[11px] text-red-400 hover:underline disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              {connOpen && (
                <div className="pb-2 pl-1">
                  {loadingD && (
                    <div className="pl-7 py-1 text-gray-500 text-xs flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Loading databases…
                    </div>
                  )}
                  {!loadingD && dbs && dbs.length === 0 && (
                    <div className="pl-7 py-1 text-gray-500 text-xs">No databases</div>
                  )}
                  {dbs?.map((dbName) => {
                    const dk = `${c.id}:${dbName}`
                    const dbOpen = expandedDb.has(dk)
                    const sk = `${c.id}:${dbName}`
                    const schema = schemaByKey[sk]
                    const loadingS = loadingSchema[sk]

                    return (
                      <div key={dk} className="mt-0.5">
                        <div
                          role="button"
                          tabIndex={0}
                          className="flex items-center gap-1 pl-5 pr-2 py-1 rounded hover:bg-primary/25 cursor-pointer"
                          onClick={(e) => onToggleDb(e, c.id, dbName)}
                          onKeyDown={(e) => { if (e.key === 'Enter') onToggleDb(e, c.id, dbName) }}
                        >
                          <span className="text-gray-400 shrink-0">
                            {dbOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </span>
                          <Folder className="w-3.5 h-3.5 text-amber-400/90 shrink-0" />
                          <span className="text-gray-200 truncate">{dbName}</span>
                        </div>

                        {dbOpen && (
                          <div className="pl-4">
                            {loadingS && (
                              <div className="pl-7 py-1 text-gray-500 text-xs flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" /> Loading schema…
                              </div>
                            )}
                            {schema && SCHEMA_CATEGORIES.map((cat) => {
                              const items = schema[cat.key] || []
                              if (items.length === 0) return null
                              const ck = `${c.id}:${dbName}:${cat.id}`
                              const catOpen = expandedCat.has(ck)
                              const Icon = cat.icon

                              const openFolderPanel = cat.id === 'tables' || cat.id === 'views'
                              return (
                                <div key={ck} className="mt-0.5">
                                  <div
                                    className={`w-full flex items-center gap-0.5 pl-5 pr-2 py-0.5 rounded ${
                                      folderActive(c.id, dbName, cat.id) ? 'bg-accent/15' : ''
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      className="p-0.5 text-gray-400 hover:text-white shrink-0"
                                      title={catOpen ? 'Collapse list' : 'Expand in sidebar'}
                                      onClick={(e) => onToggleCat(e, c.id, dbName, cat.id)}
                                    >
                                      {catOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                    </button>
                                    <button
                                      type="button"
                                      className={`min-w-0 flex-1 flex items-center gap-1 py-0.5 rounded text-left text-gray-400 hover:text-gray-200 hover:bg-primary/20 ${
                                        folderActive(c.id, dbName, cat.id) ? 'text-white' : ''
                                      }`}
                                      title={openFolderPanel ? 'Open searchable list in Browse' : ''}
                                      onClick={() => {
                                        if (openFolderPanel) onOpenTableFolder(c.id, dbName, cat.id)
                                      }}
                                    >
                                      <Icon className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                                      <span className="truncate">{cat.label}</span>
                                      <span className="text-gray-600 text-xs ml-auto tabular-nums">{items.length}</span>
                                    </button>
                                  </div>
                                  {catOpen && (
                                    <ul className="pl-12 pr-1 mt-0.5 space-y-0.5 max-h-48 overflow-y-auto">
                                      {items.map((item) => {
                                        const name = item.name
                                        if (cat.id === 'tables' || cat.id === 'views') {
                                          const kind = cat.id === 'tables' ? 'table' : 'view'
                                          const sel = leafSelected(c.id, dbName, name, kind)
                                          return (
                                            <li key={`${kind}:${name}`}>
                                              <button
                                                type="button"
                                                className={`w-full text-left truncate py-0.5 px-1.5 rounded flex items-center gap-1.5 ${
                                                  sel ? 'bg-accent/25 text-white' : 'text-gray-300 hover:bg-primary/30'
                                                }`}
                                                onClick={() => onBrowseObject(c.id, dbName, name, kind)}
                                                onDoubleClick={(e) => {
                                                  e.preventDefault()
                                                  onTableLeafDoubleClick(c.id, dbName, name, kind)
                                                }}
                                              >
                                                <TableIcon className="w-3 h-3 shrink-0 opacity-70" />
                                                <span className="truncate">{name}</span>
                                              </button>
                                            </li>
                                          )
                                        }
                                        const rt = cat.id === 'functions' ? 'FUNCTION' : 'PROCEDURE'
                                        return (
                                          <li key={`${rt}:${name}`}>
                                            <button
                                              type="button"
                                              className="w-full text-left truncate py-0.5 px-1.5 rounded text-gray-300 hover:bg-primary/30 flex items-center gap-1.5"
                                              title={`Open SHOW CREATE in SQL tab`}
                                              onClick={() => onRoutineInspect(c.id, dbName, name, rt)}
                                            >
                                              <Icon className="w-3 h-3 shrink-0 opacity-70" />
                                              <span className="truncate">{name}</span>
                                            </button>
                                          </li>
                                        )
                                      })}
                                    </ul>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Right-side panel with tabs ───────────────────────────────────

function ConnectionPanel({
  connection,
  tab,
  onTabChange,
  openTableTabs,
  onCloseTableTab,
  browseSelection,
  onBrowseSelectionChange,
  onOpenTableTab,
  pendingSql,
  onPendingSqlConsumed,
}) {
  const activeTable = openTableTabs.find((t) => t.id === tab) || null

  return (
    <div className="flex-1 min-w-0 rounded border border-gray-700 bg-secondary flex flex-col min-h-0">
      <div className="border-b border-gray-700 flex items-stretch gap-0.5 px-1 overflow-x-auto shrink-0">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={`shrink-0 px-2.5 py-2 text-sm flex items-center gap-1.5 border-b-2 whitespace-nowrap ${
                active
                  ? 'border-accent text-white'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" /> {t.label}
            </button>
          )
        })}
        {openTableTabs.map((tt) => {
          const active = tab === tt.id
          return (
            <div
              key={tt.id}
              className={`shrink-0 flex items-stretch border-b-2 max-w-[11rem] ${
                active ? 'border-accent' : 'border-transparent'
              }`}
            >
              <button
                type="button"
                onClick={() => onTabChange(tt.id)}
                className={`pl-2 pr-1 py-2 text-xs flex items-center gap-1 truncate min-w-0 ${
                  active ? 'text-white' : 'text-gray-400 hover:text-white'
                }`}
                title={`${tt.database} · ${tt.name} (${tt.kind})`}
              >
                <TableIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />
                <span className="truncate">{tt.name}</span>
              </button>
              <button
                type="button"
                onClick={() => onCloseTableTab(tt.id)}
                className="px-1.5 py-2 text-gray-500 hover:text-red-400 shrink-0"
                title="Close tab"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        })}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'browse' && (
          <BrowseTab
            key={connection.id}
            connection={connection}
            browseSelection={browseSelection}
            onBrowseSelectionChange={onBrowseSelectionChange}
            onOpenTableTab={onOpenTableTab}
          />
        )}
        {activeTable && (
          <div className="p-4 h-full flex flex-col min-h-0">
            <div className="text-xs text-gray-500 mb-2">
              {activeTable.database}
              <span className="mx-1 text-gray-600">›</span>
              <span className="text-gray-300">{activeTable.name}</span>
              <span className="text-gray-600 ml-2">({activeTable.kind})</span>
            </div>
            <TableViewerEnhanced
              connectionId={connection.id}
              database={activeTable.database}
              table={activeTable.name}
              showSearch
            />
          </div>
        )}
        {tab === 'sql' && (
          <SqlTab
            connection={connection}
            pendingSql={pendingSql}
            onPendingSqlConsumed={onPendingSqlConsumed}
          />
        )}
        {tab === 'manage' && <ManageDatabasesTab connection={connection} />}
        {tab === 'backups' && <BackupsTab connection={connection} />}
        {tab === 'restore' && <RestoreTab connection={connection} />}
        {tab === 'schedule' && <ScheduleTab connection={connection} />}
      </div>
    </div>
  )
}

// ── Searchable tables / views grid (opened from navigator folder) ─

function TableFolderPanel({ connection, database, folder, onOpenTableTab }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    let c = false
    setLoading(true)
    apiClient.getDatabaseSchema(connection.id, database)
      .then((res) => {
        if (c) return
        const raw = folder === 'tables' ? (res.data.tables || []) : (res.data.views || [])
        setItems(raw)
        setError('')
      })
      .catch((err) => !c && setError(err.response?.data?.error || 'Failed to load'))
      .finally(() => !c && setLoading(false))
    return () => { c = true }
  }, [connection.id, database, folder])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return items
    return items.filter((it) => it.name.toLowerCase().includes(s))
  }, [items, q])

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-400">
          {folder === 'tables' ? 'Tables' : 'Views'} in <span className="text-gray-200">{database}</span>
        </span>
        <span className="text-xs text-gray-600">({items.length} total)</span>
      </div>
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${folder}…`}
          className="w-full bg-primary border border-gray-700 rounded pl-9 pr-3 py-1.5 text-sm text-white placeholder:text-gray-600"
        />
      </div>
      <p className="text-xs text-gray-500">Double-click a row to open it in a new tab (search inside data there).</p>
      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{error}</div>
      )}
      {loading ? (
        <div className="text-gray-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded border border-gray-700">
          <table className="w-full text-sm text-left">
            <thead className="bg-primary text-gray-300 sticky top-0">
              <tr>
                <th className="px-3 py-2">Name</th>
                {folder === 'tables' && (
                  <>
                    <th className="px-3 py-2">Rows</th>
                    <th className="px-3 py-2">Size</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr
                  key={it.name}
                  className="border-t border-gray-700 hover:bg-primary/40 cursor-default"
                  onDoubleClick={() => onOpenTableTab(database, it.name, folder === 'tables' ? 'table' : 'view')}
                >
                  <td className="px-3 py-1.5 text-gray-200 font-mono text-xs">{it.name}</td>
                  {folder === 'tables' && (
                    <>
                      <td className="px-3 py-1.5 text-gray-400 text-xs">{(it.rows ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-gray-400 text-xs">{formatBytes(it.size_bytes ?? 0)}</td>
                    </>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={folder === 'tables' ? 3 : 1} className="px-3 py-8 text-center text-gray-500 text-sm">No matches</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Browse: pick a DB → pick a table → paginated rows ───────────

function TableViewerEnhanced({ connectionId, database, table, showSearch = false }) {
  const dialog = useDialog()
  const [view, setView] = useState('data')
  const [data, setData] = useState(null)
  const [design, setDesign] = useState(null)
  const [page, setPage] = useState(1)
  const [perPage] = useState(50)
  const [loading, setLoading] = useState(false)
  const [designLoading, setDesignLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [editing, setEditing] = useState(null)
  const [changes, setChanges] = useState({})
  const [insertOpen, setInsertOpen] = useState(false)
  const [newRow, setNewRow] = useState({})
  const [addColumnOpen, setAddColumnOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    setSearchInput('')
    setSearchDebounced('')
    setChanges({})
    setEditing(null)
    setInsertOpen(false)
    setAddColumnOpen(false)
    setNewRow({})
    setDesign(null)
    setView('data')
  }, [database, table])

  useEffect(() => { setPage(1) }, [database, table, searchDebounced])

  const loadRows = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const q = showSearch ? searchDebounced : ''
      const res = await apiClient.getTableRows(connectionId, database, table, page, perPage, q)
      setData(res.data)
      setChanges({})
      setEditing(null)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load rows')
    } finally {
      setLoading(false)
    }
  }, [connectionId, database, table, page, perPage, searchDebounced, showSearch])

  useEffect(() => { loadRows() }, [loadRows])

  useEffect(() => {
    if (view !== 'design' || design) return
    let cancelled = false
    setDesignLoading(true)
    setError('')
    apiClient.getTableDesign(connectionId, database, table)
      .then((res) => !cancelled && setDesign(res.data))
      .catch((err) => !cancelled && setError(err.response?.data?.error || 'Failed to load table design'))
      .finally(() => !cancelled && setDesignLoading(false))
    return () => { cancelled = true }
  }, [view, design, connectionId, database, table])

  const reloadDesign = async () => {
    setDesignLoading(true)
    setError('')
    try {
      const res = await apiClient.getTableDesign(connectionId, database, table)
      setDesign(res.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load table design')
    } finally {
      setDesignLoading(false)
    }
  }

  if (error) return <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{error}<button type="button" onClick={() => { setError(''); loadRows() }} className="ml-3 underline">Retry</button></div>
  if (!data) return <div className="text-gray-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>

  const totalPages = Math.max(1, Math.ceil(data.total / data.per_page))
  const hasPrimaryKey = (data.primary_key || []).length > 0
  const changedCount = Object.keys(changes).length

  const setCellValue = (rowIndex, col, value) => {
    setChanges((prev) => ({ ...prev, [rowIndex]: { ...(prev[rowIndex] || {}), [col]: value } }))
  }
  const saveRow = async (rowIndex) => {
    const key = data.row_keys?.[rowIndex]
    if (!key) return setError('This table has no primary key, so Ascend cannot safely update this row.')
    const values = changes[rowIndex] || {}
    if (!Object.keys(values).length) return
    await apiClient.updateTableRow(connectionId, database, table, key, values)
    setMessage('Row saved.')
    await loadRows()
  }
  const deleteRow = async (rowIndex) => {
    const key = data.row_keys?.[rowIndex]
    if (!key) return setError('This table has no primary key, so Ascend cannot safely delete this row.')
    const ok = await dialog.confirm({
      title: 'Delete row?',
      message: `Delete this row from ${table}?\n\nThis cannot be undone.`,
      confirmLabel: 'Delete row',
      tone: 'danger',
    })
    if (!ok) return
    await apiClient.deleteTableRow(connectionId, database, table, key)
    setMessage('Row deleted.')
    await loadRows()
  }
  const insertRow = async () => {
    const values = Object.fromEntries(Object.entries(newRow).filter(([, v]) => v !== ''))
    if (!Object.keys(values).length) return setError('Fill at least one value before inserting.')
    await apiClient.insertTableRow(connectionId, database, table, values)
    setMessage('Row inserted.')
    setInsertOpen(false)
    setNewRow({})
    await loadRows()
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setView('data')} className={`px-3 py-1.5 rounded text-sm ${view === 'data' ? 'bg-accent text-white' : 'bg-primary text-gray-300 hover:text-white'}`}>Data</button>
          <button type="button" onClick={() => setView('design')} className={`px-3 py-1.5 rounded text-sm ${view === 'design' ? 'bg-accent text-white' : 'bg-primary text-gray-300 hover:text-white'}`}>Design</button>
        </div>
        {view === 'data' && <div className="flex flex-wrap items-center gap-2">
          {!hasPrimaryKey && <span className="text-xs text-yellow-300">No primary key: row edit/delete disabled</span>}
          {changedCount > 0 && <span className="text-xs text-yellow-300">{changedCount} changed row(s)</span>}
          <button type="button" onClick={() => setInsertOpen((v) => !v)} className="px-2 py-1 bg-primary hover:bg-gray-700 rounded text-gray-200 text-xs inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Insert row</button>
          <button type="button" onClick={loadRows} disabled={loading} className="px-2 py-1 bg-primary hover:bg-gray-700 rounded text-gray-200 text-xs inline-flex items-center gap-1 disabled:opacity-50"><RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>}
      </div>
      {message && <div className="rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-green-300 text-xs">{message}</div>}
      {view === 'design' ? (
        <TableDesignPanel
          design={design}
          loading={designLoading}
          connectionId={connectionId}
          database={database}
          table={table}
          addColumnOpen={addColumnOpen}
          onToggleAddColumn={() => setAddColumnOpen((v) => !v)}
          onColumnAdded={async () => {
            setMessage('Column added.')
            setAddColumnOpen(false)
            await reloadDesign()
            await loadRows()
          }}
        />
      ) : <>
        {showSearch && <div className="relative max-w-md shrink-0"><Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" /><input type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search rows (any column)..." className="w-full bg-primary border border-gray-700 rounded pl-9 pr-3 py-1.5 text-sm text-white placeholder:text-gray-600" /></div>}
        <div className="flex items-center justify-between text-xs text-gray-400 shrink-0"><span>{data.total.toLocaleString()} row{data.total === 1 ? '' : 's'}{data.search ? ' matching search' : ' total'} - page {data.page} of {totalPages}</span><div className="flex items-center gap-2"><button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="px-2 py-1 bg-primary rounded disabled:opacity-40">Prev</button><button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="px-2 py-1 bg-primary rounded disabled:opacity-40">Next</button></div></div>
        {insertOpen && <div className="rounded border border-gray-700 bg-secondary p-3"><div className="text-sm font-semibold text-white mb-2">Insert row</div><div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">{data.columns.map((col) => <label key={col} className="text-xs text-gray-400">{col}<input value={newRow[col] ?? ''} onChange={(e) => setNewRow((r) => ({ ...r, [col]: e.target.value }))} placeholder="leave empty for default/null" className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" /></label>)}</div><div className="mt-3 flex gap-2"><button type="button" onClick={insertRow} className="px-3 py-1.5 bg-accent hover:bg-accent/80 rounded text-white text-xs font-semibold">Insert</button><button type="button" onClick={() => { setInsertOpen(false); setNewRow({}) }} className="px-3 py-1.5 bg-primary hover:bg-gray-700 rounded text-gray-200 text-xs">Cancel</button></div></div>}
        <div className="flex-1 min-h-0 overflow-auto rounded border border-gray-700"><table className="w-full text-sm text-left"><thead className="bg-primary text-gray-300 sticky top-0"><tr><th className="px-3 py-2 font-semibold whitespace-nowrap w-24">Actions</th>{data.columns.map((c) => <th key={c} className="px-3 py-2 font-semibold whitespace-nowrap">{c}</th>)}</tr></thead><tbody>{data.rows.map((row, i) => <tr key={i} className="border-t border-gray-700 hover:bg-primary/40"><td className="px-3 py-1.5 whitespace-nowrap"><div className="flex gap-1"><button type="button" onClick={() => saveRow(i)} disabled={!changes[i]} title="Save row" className="p-1 rounded bg-primary hover:bg-gray-700 text-green-300 disabled:opacity-30"><Save className="w-3.5 h-3.5" /></button><button type="button" onClick={() => deleteRow(i)} disabled={!hasPrimaryKey} title="Delete row" className="p-1 rounded bg-primary hover:bg-gray-700 text-red-300 disabled:opacity-30"><Trash2 className="w-3.5 h-3.5" /></button></div></td>{data.columns.map((col, j) => { const v = changes[i]?.[col] !== undefined ? changes[i][col] : row[j]; const isEditing = editing?.row === i && editing?.col === col; return <td key={col} className="px-3 py-1.5 text-gray-200 whitespace-nowrap max-w-xs truncate" title={v === null ? 'NULL' : String(v)} onDoubleClick={() => hasPrimaryKey && setEditing({ row: i, col })}>{isEditing ? <input autoFocus value={v ?? ''} onChange={(e) => setCellValue(i, col, e.target.value)} onBlur={() => setEditing(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditing(null) }} className="w-full min-w-[10rem] bg-black/30 border border-accent rounded px-2 py-1 text-white" /> : v === null ? <span className="text-gray-500 italic">NULL</span> : <span className={changes[i]?.[col] !== undefined ? 'text-yellow-200' : ''}>{String(v)}</span>}</td> })}</tr>)}</tbody></table></div>
      </>}
    </div>
  )
}

function TableDesignPanel({ design, loading, connectionId, database, table, addColumnOpen, onToggleAddColumn, onColumnAdded }) {
  const [tab, setTab] = useState('fields')
  if (loading || !design) return <div className="text-gray-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading table design...</div>
  const tabs = [['fields', 'Fields'], ['indexes', 'Indexes'], ['foreign_keys', 'Foreign Keys'], ['triggers', 'Triggers'], ['sql', 'SQL Preview']]
  return <div className="flex-1 min-h-0 flex flex-col gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-2">{tabs.map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`px-3 py-1.5 rounded text-sm ${tab === id ? 'bg-accent text-white' : 'bg-primary text-gray-300 hover:text-white'}`}>{label}</button>)}</div><button type="button" onClick={onToggleAddColumn} className="px-2 py-1 bg-primary hover:bg-gray-700 rounded text-gray-200 text-xs inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add column</button></div>{addColumnOpen && <AddColumnPanel connectionId={connectionId} database={database} table={table} columns={design.columns || []} onAdded={onColumnAdded} />}{tab === 'fields' && <DesignTable columns={['Name', 'Type', 'Length', 'Decimals', 'Not null', 'Key', 'Default', 'Extra', 'Charset', 'Collation', 'Comment']}>{design.columns.map((c) => <tr key={c.name} className="border-t border-gray-700"><td className="px-3 py-1.5 font-mono text-xs text-white">{c.name}</td><td className="px-3 py-1.5">{c.data_type}</td><td className="px-3 py-1.5">{c.char_length || c.numeric_precision || ''}</td><td className="px-3 py-1.5">{c.numeric_scale ?? ''}</td><td className="px-3 py-1.5">{c.nullable ? '' : 'yes'}</td><td className="px-3 py-1.5">{c.key || ''}</td><td className="px-3 py-1.5 font-mono text-xs">{c.default ?? ''}</td><td className="px-3 py-1.5">{c.extra || ''}</td><td className="px-3 py-1.5">{c.charset || ''}</td><td className="px-3 py-1.5">{c.collation || ''}</td><td className="px-3 py-1.5">{c.comment || ''}</td></tr>)}</DesignTable>}{tab === 'indexes' && <DesignTable columns={['Name', 'Unique', 'Seq', 'Column', 'Type', 'Collation', 'Cardinality', 'Nullable']}>{design.indexes.map((idx, i) => <tr key={`${idx.name}-${i}`} className="border-t border-gray-700"><td className="px-3 py-1.5 font-mono text-xs text-white">{idx.name}</td><td className="px-3 py-1.5">{idx.unique ? 'yes' : 'no'}</td><td className="px-3 py-1.5">{idx.sequence}</td><td className="px-3 py-1.5 font-mono text-xs">{idx.column}</td><td className="px-3 py-1.5">{idx.type}</td><td className="px-3 py-1.5">{idx.collation || ''}</td><td className="px-3 py-1.5">{idx.cardinality ?? ''}</td><td className="px-3 py-1.5">{idx.nullable || ''}</td></tr>)}</DesignTable>}{tab === 'foreign_keys' && <DesignTable columns={['Constraint', 'Column', 'References']}>{design.foreign_keys.map((fk, i) => <tr key={`${fk.constraint}-${i}`} className="border-t border-gray-700"><td className="px-3 py-1.5 font-mono text-xs text-white">{fk.constraint}</td><td className="px-3 py-1.5 font-mono text-xs">{fk.column}</td><td className="px-3 py-1.5 font-mono text-xs">{fk.referenced_schema}.{fk.referenced_table}.{fk.referenced_column}</td></tr>)}</DesignTable>}{tab === 'triggers' && <DesignTable columns={['Name', 'Timing', 'Event', 'Statement']}>{design.triggers.map((tr) => <tr key={tr.name} className="border-t border-gray-700"><td className="px-3 py-1.5 font-mono text-xs text-white">{tr.name}</td><td className="px-3 py-1.5">{tr.timing}</td><td className="px-3 py-1.5">{tr.event}</td><td className="px-3 py-1.5 font-mono text-xs whitespace-pre-wrap">{tr.statement}</td></tr>)}</DesignTable>}{tab === 'sql' && <pre className="flex-1 min-h-0 overflow-auto rounded border border-gray-700 bg-primary p-3 text-xs text-gray-200 whitespace-pre-wrap">{design.create_sql || 'No SQL returned.'}</pre>}</div>
}

function AddColumnPanel({ connectionId, database, table, columns, onAdded }) {
  const [form, setForm] = useState({ name: '', type: 'VARCHAR', length: '255', nullable: true, default: '', auto_increment: false, after: columns[columns.length - 1]?.name || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const preview = `ALTER TABLE \`${table}\` ADD COLUMN ${columnDefinitionPreview(form)}${form.after ? ` AFTER \`${form.after}\`` : ''};`
  const submit = async () => {
    setBusy(true); setError('')
    try {
      await apiClient.addTableColumn(connectionId, { database, table, column: form, after: form.after })
      onAdded()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add column')
    } finally {
      setBusy(false)
    }
  }
  return <div className="rounded border border-gray-700 bg-secondary p-3"><div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-2"><label className="text-xs text-gray-400">Name<input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" /></label><label className="text-xs text-gray-400">Type<select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value, length: e.target.value === 'VARCHAR' ? '255' : '' }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white">{COLUMN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label><label className="text-xs text-gray-400">Length<input value={form.length} onChange={(e) => setForm((f) => ({ ...f, length: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" placeholder="255 or 10,2" /></label><label className="text-xs text-gray-400">Default<input value={form.default} onChange={(e) => setForm((f) => ({ ...f, default: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" /></label><label className="text-xs text-gray-400">After<select value={form.after} onChange={(e) => setForm((f) => ({ ...f, after: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white"><option value="">First</option>{columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label><div className="flex items-end gap-3 text-xs text-gray-300"><label className="inline-flex items-center gap-1"><input type="checkbox" checked={form.nullable} onChange={(e) => setForm((f) => ({ ...f, nullable: e.target.checked }))} /> Null</label><label className="inline-flex items-center gap-1"><input type="checkbox" checked={form.auto_increment} onChange={(e) => setForm((f) => ({ ...f, auto_increment: e.target.checked, nullable: false }))} /> AI</label></div></div><pre className="mt-3 rounded border border-gray-700 bg-primary p-2 text-xs text-gray-300 whitespace-pre-wrap">{preview}</pre>{error && <div className="mt-2 text-red-300 text-xs">{error}</div>}<button type="button" onClick={submit} disabled={busy || !form.name.trim()} className="mt-3 px-3 py-1.5 bg-accent hover:bg-accent/80 rounded text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50">{busy && <Loader2 className="w-3 h-3 animate-spin" />} Apply add column</button></div>
}

function DesignTable({ columns, children }) {
  return <div className="flex-1 min-h-0 overflow-auto rounded border border-gray-700"><table className="w-full text-sm text-left"><thead className="bg-primary text-gray-300 sticky top-0"><tr>{columns.map((c) => <th key={c} className="px-3 py-2 font-semibold whitespace-nowrap">{c}</th>)}</tr></thead><tbody className="text-gray-300">{children}</tbody></table></div>
}

function CreateTablePanel({ connectionId, database, onCreated }) {
  const [form, setForm] = useState({
    table: '',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collation: 'utf8mb4_general_ci',
    columns: [{ name: 'id', type: 'INT', length: '11', nullable: false, auto_increment: true, default: '' }],
    primary_key: 'id',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const patchColumn = (idx, updates) => {
    setForm((f) => ({ ...f, columns: f.columns.map((c, i) => (i === idx ? { ...c, ...updates } : c)) }))
  }
  const addColumn = () => setForm((f) => ({ ...f, columns: [...f.columns, { name: '', type: 'VARCHAR', length: '255', nullable: true, default: '' }] }))
  const removeColumn = (idx) => setForm((f) => ({ ...f, columns: f.columns.filter((_, i) => i !== idx) }))
  const preview = useMemo(() => {
    const table = form.table.trim() || 'table_name'
    const defs = form.columns.map(columnDefinitionPreview)
    if (form.primary_key) defs.push(`PRIMARY KEY (\`${form.primary_key}\`)`)
    return `CREATE TABLE \`${table}\` (\n  ${defs.join(',\n  ')}\n) ENGINE=${form.engine} DEFAULT CHARSET=${form.charset} COLLATE=${form.collation};`
  }, [form])
  const submit = async () => {
    setBusy(true); setError('')
    try {
      const name = form.table.trim()
      const payload = { ...form, table: name, columns: form.columns.filter((c) => c.name.trim()) }
      await apiClient.createTable(connectionId, payload)
      onCreated(name)
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create table')
    } finally {
      setBusy(false)
    }
  }
  return <div className="rounded border border-gray-700 bg-secondary p-3 max-w-5xl"><div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3"><label className="text-xs text-gray-400 md:col-span-2">Table name<input value={form.table} onChange={(e) => setForm((f) => ({ ...f, table: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" placeholder="new_table" /></label><label className="text-xs text-gray-400">Engine<input value={form.engine} onChange={(e) => setForm((f) => ({ ...f, engine: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" /></label><label className="text-xs text-gray-400">Collation<select value={form.collation} onChange={(e) => setForm((f) => ({ ...f, collation: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white">{(DB_COLLATIONS[form.charset] || DB_COLLATIONS.utf8mb4).map((c) => <option key={c} value={c}>{c}</option>)}</select></label></div><div className="space-y-2">{form.columns.map((col, idx) => <div key={idx} className="grid grid-cols-1 md:grid-cols-7 gap-2 items-end"><label className="text-xs text-gray-400 md:col-span-2">Column<input value={col.name} onChange={(e) => patchColumn(idx, { name: e.target.value })} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" /></label><label className="text-xs text-gray-400">Type<select value={col.type} onChange={(e) => patchColumn(idx, { type: e.target.value, length: e.target.value === 'VARCHAR' ? '255' : e.target.value === 'INT' ? '11' : '' })} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white">{COLUMN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label><label className="text-xs text-gray-400">Length<input value={col.length || ''} onChange={(e) => patchColumn(idx, { length: e.target.value })} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" /></label><label className="text-xs text-gray-400">Default<input value={col.default || ''} onChange={(e) => patchColumn(idx, { default: e.target.value })} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" /></label><div className="flex flex-wrap gap-2 text-xs text-gray-300"><label className="inline-flex items-center gap-1"><input type="checkbox" checked={!!col.nullable} onChange={(e) => patchColumn(idx, { nullable: e.target.checked })} /> Null</label><label className="inline-flex items-center gap-1"><input type="checkbox" checked={!!col.auto_increment} onChange={(e) => patchColumn(idx, { auto_increment: e.target.checked, nullable: false })} /> AI</label><label className="inline-flex items-center gap-1"><input type="radio" checked={form.primary_key === col.name && !!col.name} onChange={() => setForm((f) => ({ ...f, primary_key: col.name }))} /> PK</label></div><button type="button" onClick={() => removeColumn(idx)} disabled={form.columns.length <= 1} className="px-2 py-1.5 bg-primary hover:bg-gray-700 rounded text-red-300 text-xs disabled:opacity-40">Remove</button></div>)}</div><button type="button" onClick={addColumn} className="mt-3 px-2 py-1 bg-primary hover:bg-gray-700 rounded text-gray-200 text-xs inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add field</button><pre className="mt-3 rounded border border-gray-700 bg-primary p-2 text-xs text-gray-300 whitespace-pre-wrap">{preview}</pre>{error && <div className="mt-2 text-red-300 text-xs">{error}</div>}<button type="button" onClick={submit} disabled={busy || !form.table.trim()} className="mt-3 px-3 py-1.5 bg-accent hover:bg-accent/80 rounded text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50">{busy && <Loader2 className="w-3 h-3 animate-spin" />} Create table</button></div>
}

function BrowseTab({ connection, browseSelection, onBrowseSelectionChange, onOpenTableTab }) {
  const [databases, setDatabases] = useState([])
  const [database, setDatabase] = useState('')
  const [tables, setTables] = useState([])
  const [table, setTable] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const treeSel = browseSelection?.connectionId === connection.id ? browseSelection : null
  const folderMode = treeSel && (treeSel.folder === 'tables' || treeSel.folder === 'views')
  const browseRef = useRef(browseSelection)
  browseRef.current = browseSelection

  const loadTables = useCallback(async (dbName = database) => {
    if (!dbName) { setTables([]); setTable(''); return }
    const res = await apiClient.listTables(connection.id, dbName)
    const tlist = res.data.tables || []
    setTables(tlist)
    const ts = browseRef.current?.connectionId === connection.id ? browseRef.current : null
    const fromTree = ts
      && ts.database === dbName
      && (ts.kind === 'table' || ts.kind === 'view')
    if (fromTree) setTable(ts.name)
    else setTable(tlist[0]?.name || '')
  }, [connection.id, database])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiClient.listDatabases(connection.id)
      .then((res) => {
        if (cancelled) return
        const all = [...(res.data.databases || []), ...(res.data.system_databases || [])]
        setDatabases(all)
        const ts = browseRef.current?.connectionId === connection.id ? browseRef.current : null
        if (ts?.database && !ts.folder) {
          setDatabase(ts.database)
        } else if (ts?.folder) {
          setDatabase(ts.database)
        } else {
          const def = connection.default_database && all.includes(connection.default_database)
            ? connection.default_database
            : (res.data.databases?.[0] || '')
          setDatabase(def)
        }
        setError('')
      })
      .catch((err) => !cancelled && setError(err.response?.data?.error || 'Failed to load databases'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [connection.id, connection.default_database])

  useEffect(() => {
    if (!treeSel) return
    setDatabase(treeSel.database)
    if (treeSel.folder) return
    if (treeSel.name) setTable(treeSel.name)
  }, [treeSel?.database, treeSel?.name, treeSel?.kind, treeSel?.folder, treeSel?.connectionId])

  useEffect(() => {
    if (folderMode) return
    if (!database) { setTables([]); setTable(''); return }
    let cancelled = false
    loadTables(database)
      .catch((err) => !cancelled && setError(err.response?.data?.error || 'Failed to load tables'))
    return () => { cancelled = true }
  }, [connection.id, database, folderMode, loadTables])

  useEffect(() => {
    if (folderMode) return
    if (!treeSel || treeSel.database !== database) return
    if (treeSel.kind !== 'table' && treeSel.kind !== 'view') return
    setTable(treeSel.name)
  }, [treeSel, database, tables, folderMode])

  const onDatabaseChange = (value) => {
    setDatabase(value)
    onBrowseSelectionChange(null)
  }

  const onTableChange = (value) => {
    setTable(value)
    if (database && value) {
      onBrowseSelectionChange({
        connectionId: connection.id,
        database,
        name: value,
        kind: 'table',
      })
    }
  }

  if (folderMode) {
    return (
      <div className="p-4 h-full flex flex-col min-h-0">
        <TableFolderPanel
          connection={connection}
          database={treeSel.database}
          folder={treeSel.folder}
          onOpenTableTab={onOpenTableTab}
        />
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-col gap-4 h-full min-h-0">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-400">Database</label>
        <select
          value={database}
          onChange={(e) => onDatabaseChange(e.target.value)}
          className="bg-primary border border-gray-700 text-white text-sm px-2 py-1 rounded"
        >
          {databases.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <label className="text-sm text-gray-400 ml-4">Table / view</label>
        <select
          value={table}
          onChange={(e) => onTableChange(e.target.value)}
          className="bg-primary border border-gray-700 text-white text-sm px-2 py-1 rounded min-w-[12rem]"
        >
          {tables.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name} ({t.rows.toLocaleString()} rows · {formatBytes(t.size_bytes)})
            </option>
          ))}
        </select>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
        <button type="button" onClick={() => setCreateOpen((v) => !v)} disabled={!database} className="px-2 py-1 bg-primary hover:bg-gray-700 rounded text-gray-200 text-xs inline-flex items-center gap-1 disabled:opacity-50"><Plus className="w-3 h-3" /> Create table</button>
      </div>

      {createOpen && (
        <CreateTablePanel
          connectionId={connection.id}
          database={database}
          onCreated={async (name) => {
            setCreateOpen(false)
            await loadTables(database)
            setTable(name)
            onBrowseSelectionChange({ connectionId: connection.id, database, name, kind: 'table' })
          }}
        />
      )}

      {treeSel && (treeSel.kind === 'table' || treeSel.kind === 'view') && (
        <div className="text-xs text-gray-500">
          Navigator: <span className="text-gray-400">{treeSel.database}</span>
          <span className="mx-1 text-gray-600">›</span>
          <span className="text-accent">{treeSel.kind}</span>
          <span className="mx-1 text-gray-600">›</span>
          <span className="text-gray-300">{treeSel.name}</span>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {database && table && (
        <TableViewerEnhanced connectionId={connection.id} database={database} table={table} showSearch />
      )}
    </div>
  )
}

function TableViewer({ connectionId, database, table, showSearch = false }) {
  const [data, setData] = useState(null)
  const [page, setPage] = useState(1)
  const [perPage] = useState(50)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    setSearchInput('')
    setSearchDebounced('')
  }, [database, table])

  useEffect(() => { setPage(1) }, [database, table, searchDebounced])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const q = showSearch ? searchDebounced : ''
    apiClient.getTableRows(connectionId, database, table, page, perPage, q)
      .then((res) => !cancelled && setData(res.data))
      .catch((err) => !cancelled && setError(err.response?.data?.error || 'Failed to load rows'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [connectionId, database, table, page, perPage, searchDebounced, showSearch])

  if (error) {
    return <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{error}</div>
  }
  if (!data) {
    return <div className="text-gray-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.per_page))

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      {showSearch && (
        <div className="relative max-w-md shrink-0">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search rows (any column)…"
            className="w-full bg-primary border border-gray-700 rounded pl-9 pr-3 py-1.5 text-sm text-white placeholder:text-gray-600"
          />
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-gray-400 shrink-0">
        <span>
          {data.total.toLocaleString()} row{data.total === 1 ? '' : 's'}
          {data.search ? ' matching search' : ' total'}
          {' · '}page {data.page} of {totalPages}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="px-2 py-1 bg-primary rounded disabled:opacity-40">Prev</button>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="px-2 py-1 bg-primary rounded disabled:opacity-40">Next</button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto rounded border border-gray-700">
        <table className="w-full text-sm text-left">
          <thead className="bg-primary text-gray-300 sticky top-0">
            <tr>
              {data.columns.map((c) => <th key={c} className="px-3 py-2 font-semibold whitespace-nowrap">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i} className="border-t border-gray-700 hover:bg-primary/40">
                {row.map((v, j) => (
                  <td key={j} className="px-3 py-1.5 text-gray-200 whitespace-nowrap max-w-xs truncate" title={v === null ? 'NULL' : String(v)}>
                    {v === null ? <span className="text-gray-500 italic">NULL</span> : String(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── SQL runner ──────────────────────────────────────────────────

function SqlTab({ connection, pendingSql, onPendingSqlConsumed }) {
  const [databases, setDatabases] = useState([])
  const [database, setDatabase] = useState('')
  const [sql, setSql] = useState('SHOW DATABASES;')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState(null) // { reason }
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (!pendingSql) return
    setSql(pendingSql)
    onPendingSqlConsumed()
  }, [pendingSql, onPendingSqlConsumed])

  useEffect(() => {
    apiClient.listDatabases(connection.id)
      .then((res) => {
        const all = [...(res.data.databases || []), ...(res.data.system_databases || [])]
        setDatabases(all)
        if (connection.default_database && all.includes(connection.default_database)) {
          setDatabase(connection.default_database)
        }
      })
      .catch(() => {})
  }, [connection.id, connection.default_database])

  const run = async (forceConfirm = false) => {
    setRunning(true)
    setError('')
    setConfirmation(null)
    try {
      const res = await apiClient.runDbQuery(connection.id, sql, database, forceConfirm)
      if (res.data.requires_confirmation) {
        setConfirmation({ reason: res.data.reason })
        setResult(null)
      } else if (res.data.error) {
        setError(res.data.error)
        setResult(null)
      } else {
        setResult(res.data)
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Query failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-400">Database (optional)</label>
        <select
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
          className="bg-primary border border-gray-700 text-white text-sm px-2 py-1 rounded min-w-[10rem]"
        >
          <option value="">(none — server-wide)</option>
          {databases.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        rows={6}
        className="font-mono text-sm bg-primary border border-gray-700 rounded p-2 text-white focus:outline-none focus:border-accent"
        placeholder="SELECT ..."
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => run(false)}
          disabled={running || !sql.trim()}
          className="px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Run
        </button>
        {result && (
          <span className="text-xs text-gray-400">
            {result.rows.length > 0
              ? `${result.rows.length} row(s) returned`
              : `${result.affected_rows} row(s) affected`} · {result.duration_ms} ms
          </span>
        )}
      </div>

      {confirmation && (
        <div className="rounded border border-yellow-500/30 bg-yellow-500/10 p-3 text-yellow-200 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold mb-1">Confirm destructive query</div>
            <div className="text-yellow-200/80 mb-2">{confirmation.reason}</div>
            <button
              type="button"
              onClick={() => run(true)}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-white text-xs font-semibold"
            >
              Yes, run it anyway
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm font-mono whitespace-pre-wrap">
          {error}
        </div>
      )}

      {result && result.columns.length > 0 && (
        <div className="flex-1 min-h-0 overflow-auto rounded border border-gray-700">
          <table className="w-full text-sm text-left">
            <thead className="bg-primary text-gray-300 sticky top-0">
              <tr>{result.columns.map((c) => <th key={c} className="px-3 py-2 font-semibold whitespace-nowrap">{c}</th>)}</tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className="border-t border-gray-700 hover:bg-primary/40">
                  {row.map((v, j) => (
                    <td key={j} className="px-3 py-1.5 text-gray-200 whitespace-nowrap max-w-xs truncate" title={v === null ? 'NULL' : String(v)}>
                      {v === null ? <span className="text-gray-500 italic">NULL</span> : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Backups list + run-now ──────────────────────────────────────

function ManageDatabasesTab({ connection }) {
  const dialog = useDialog()
  const [databases, setDatabases] = useState([])
  const [loading, setLoading] = useState(true)
  const [createForm, setCreateForm] = useState({ name: '', charset: 'utf8mb4', collation: 'utf8mb4_general_ci' })
  const [createBusy, setCreateBusy] = useState(false)
  const [createResult, setCreateResult] = useState(null)
  const [createError, setCreateError] = useState('')
  const [importForm, setImportForm] = useState({
    mode: 'existing',
    database: '',
    new_database: '',
    charset: 'utf8mb4',
    collation: 'utf8mb4_general_ci',
  })
  const [importFile, setImportFile] = useState(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importError, setImportError] = useState('')
  const [mysqlUsers, setMysqlUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState('')
  const [userBusy, setUserBusy] = useState(false)
  const [userResult, setUserResult] = useState(null)
  const [userForm, setUserForm] = useState({
    username: '',
    host: 'localhost',
    password: '',
    database: '',
    privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  })
  const [grantForm, setGrantForm] = useState({ username: '', host: 'localhost', database: '', privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] })

  const refreshDatabases = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.listDatabases(connection.id)
      const all = [...(res.data.databases || []), ...(res.data.system_databases || [])]
      setDatabases(all)
      setImportForm((f) => ({ ...f, database: f.database || connection.default_database || all[0] || '' }))
      setUserForm((f) => ({ ...f, database: f.database || connection.default_database || all[0] || '' }))
      setGrantForm((f) => ({ ...f, database: f.database || connection.default_database || all[0] || '' }))
    } finally {
      setLoading(false)
    }
  }, [connection.id, connection.default_database])

  useEffect(() => { refreshDatabases() }, [refreshDatabases])

  const refreshUsers = useCallback(async (database = '') => {
    setUsersLoading(true)
    setUsersError('')
    try {
      const res = await apiClient.listMysqlUsers(connection.id, database)
      setMysqlUsers(res.data.users || [])
    } catch (err) {
      setUsersError(err.response?.data?.error || 'Could not load MySQL users')
    } finally {
      setUsersLoading(false)
    }
  }, [connection.id])

  useEffect(() => { refreshUsers(userForm.database) }, [refreshUsers, userForm.database])

  const createCollations = DB_COLLATIONS[createForm.charset] || DB_COLLATIONS.utf8mb4
  const importCollations = DB_COLLATIONS[importForm.charset] || DB_COLLATIONS.utf8mb4
  const createSqlPreview = useMemo(() => {
    const name = createForm.name.trim() || 'database_name'
    return `CREATE DATABASE \`${name}\` CHARACTER SET ${createForm.charset} COLLATE ${createForm.collation};`
  }, [createForm])
  const importCreateSqlPreview = useMemo(() => {
    const name = importForm.new_database.trim() || 'database_name'
    return `CREATE DATABASE \`${name}\` CHARACTER SET ${importForm.charset} COLLATE ${importForm.collation};\nUSE \`${name}\`;\n-- then Ascend imports the selected .sql file with mysql`
  }, [importForm])

  const patchCreate = (updates) => {
    setCreateForm((f) => {
      const next = { ...f, ...updates }
      if (updates.charset) next.collation = (DB_COLLATIONS[updates.charset] || [])[0] || next.collation
      return next
    })
  }

  const patchImport = (updates) => {
    setImportForm((f) => {
      const next = { ...f, ...updates }
      if (updates.charset) next.collation = (DB_COLLATIONS[updates.charset] || [])[0] || next.collation
      return next
    })
  }

  const togglePrivilege = (target, priv) => {
    const setter = target === 'grant' ? setGrantForm : setUserForm
    setter((f) => {
      const set = new Set(f.privileges || [])
      if (set.has(priv)) set.delete(priv)
      else set.add(priv)
      return { ...f, privileges: [...set] }
    })
  }

  const createDatabase = async () => {
    const name = createForm.name.trim()
    if (!name) {
      setCreateError('Database name is required.')
      return
    }
    setCreateBusy(true)
    setCreateError('')
    setCreateResult(null)
    try {
      const res = await apiClient.createDatabase(connection.id, { ...createForm, name })
      setCreateResult(res.data)
      setCreateForm((f) => ({ ...f, name: '' }))
      await refreshDatabases()
    } catch (err) {
      setCreateError(err.response?.data?.error || 'Database creation failed')
    } finally {
      setCreateBusy(false)
    }
  }

  const importSql = async () => {
    if (!importFile) {
      setImportError('Choose a .sql file first.')
      return
    }
    const target = importForm.mode === 'new' ? importForm.new_database.trim() : importForm.database.trim()
    if (!target) {
      setImportError('Choose or enter a target database.')
      return
    }
    if (importForm.mode === 'existing') {
      const ok = await dialog.confirm({
        title: 'Import into existing database?',
        message: `Import ${importFile.name} into "${target}"?\n\nExisting objects may be changed by the SQL file.`,
        confirmLabel: 'Import',
        tone: 'warning',
      })
      if (!ok) return
    }
    setImportBusy(true)
    setImportError('')
    setImportResult(null)
    try {
      const res = await apiClient.importSqlFile(connection.id, {
        ...importForm,
        database: target,
        new_database: importForm.mode === 'new' ? target : '',
        file: importFile,
      })
      setImportResult(res.data)
      await refreshDatabases()
    } catch (err) {
      setImportError(err.response?.data?.error || 'SQL import failed')
    } finally {
      setImportBusy(false)
    }
  }

  const createMysqlUser = async () => {
    if (!userForm.username.trim() || !userForm.password) {
      setUsersError('Username and password are required.')
      return
    }
    setUserBusy(true)
    setUsersError('')
    setUserResult(null)
    try {
      const res = await apiClient.createMysqlUser(connection.id, {
        ...userForm,
        username: userForm.username.trim(),
        host: userForm.host.trim() || 'localhost',
      })
      setUserResult(res.data)
      setUserForm((f) => ({ ...f, username: '', password: '' }))
      await refreshUsers(userForm.database)
    } catch (err) {
      setUsersError(err.response?.data?.error || 'Could not create MySQL user')
    } finally {
      setUserBusy(false)
    }
  }

  const grantMysqlUser = async () => {
    if (!grantForm.username.trim() || !grantForm.database) {
      setUsersError('Choose a user and database to grant.')
      return
    }
    setUserBusy(true)
    setUsersError('')
    setUserResult(null)
    try {
      const res = await apiClient.grantMysqlUser(connection.id, {
        ...grantForm,
        username: grantForm.username.trim(),
        host: grantForm.host.trim() || 'localhost',
      })
      setUserResult(res.data)
      await refreshUsers(grantForm.database)
    } catch (err) {
      setUsersError(err.response?.data?.error || 'Could not grant privileges')
    } finally {
      setUserBusy(false)
    }
  }

  const deleteMysqlUser = async (row) => {
    const label = `${row.username}@${row.host}`
    const ok = await dialog.typedConfirm({
      title: 'Delete MySQL user?',
      message: `Delete MySQL user ${label}?`,
      expected: label,
      confirmLabel: 'Delete user',
      tone: 'danger',
    })
    if (!ok) return
    setUserBusy(true)
    setUsersError('')
    try {
      await apiClient.deleteMysqlUser(connection.id, row.username, row.host, label)
      await refreshUsers(userForm.database)
    } catch (err) {
      setUsersError(err.response?.data?.error || 'Could not delete MySQL user')
    } finally {
      setUserBusy(false)
    }
  }

  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      <div className="rounded border border-gray-700 bg-primary/30 p-4 max-w-5xl">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-white font-semibold">Create database</h2>
            <p className="text-xs text-gray-500 mt-1">Defaults to utf8mb4 and general_ci for broad MySQL/MariaDB compatibility.</p>
          </div>
          <button type="button" onClick={refreshDatabases} className="text-gray-400 hover:text-white" title="Refresh database list">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="sm:col-span-2 text-sm text-gray-300">
              Database name
              <input value={createForm.name} onChange={(e) => patchCreate({ name: e.target.value })} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white" placeholder="my_database" />
            </label>
            <label className="text-sm text-gray-300">
              Character set
              <select value={createForm.charset} onChange={(e) => patchCreate({ charset: e.target.value })} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white">
                {DB_CHARSETS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-sm text-gray-300">
              Collation
              <select value={createForm.collation} onChange={(e) => patchCreate({ collation: e.target.value })} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white">
                {createCollations.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <div className="sm:col-span-2">
              <button type="button" onClick={createDatabase} disabled={createBusy || !createForm.name.trim()} className="px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
                {createBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create database
              </button>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">SQL Preview</div>
            <pre className="min-h-[8.5rem] rounded border border-gray-700 bg-primary p-3 text-xs text-gray-200 whitespace-pre-wrap overflow-auto">{createSqlPreview}</pre>
          </div>
        </div>
        {createError && <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{createError}</div>}
        {createResult?.ok && <div className="mt-3 rounded border border-green-500/30 bg-green-500/10 p-3 text-green-300 text-sm">Created {createResult.database} in {createResult.duration_ms} ms.</div>}
      </div>

      <div className="rounded border border-gray-700 bg-primary/30 p-4 max-w-5xl">
        <div className="mb-3">
          <h2 className="text-white font-semibold">Import SQL file</h2>
          <p className="text-xs text-gray-500 mt-1">Upload a `.sql` dump and import it with the server mysql client.</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm text-gray-300">
              Target
              <select value={importForm.mode} onChange={(e) => patchImport({ mode: e.target.value })} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white">
                <option value="existing">Existing database</option>
                <option value="new">Create new database</option>
              </select>
            </label>
            {importForm.mode === 'existing' ? (
              <label className="text-sm text-gray-300">
                Database
                <select value={importForm.database} onChange={(e) => patchImport({ database: e.target.value })} disabled={loading} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white disabled:opacity-50">
                  {databases.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            ) : (
              <label className="text-sm text-gray-300">
                New database name
                <input value={importForm.new_database} onChange={(e) => patchImport({ new_database: e.target.value })} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white" placeholder="import_target" />
              </label>
            )}
            {importForm.mode === 'new' && (
              <>
                <label className="text-sm text-gray-300">
                  Character set
                  <select value={importForm.charset} onChange={(e) => patchImport({ charset: e.target.value })} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white">
                    {DB_CHARSETS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="text-sm text-gray-300">
                  Collation
                  <select value={importForm.collation} onChange={(e) => patchImport({ collation: e.target.value })} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white">
                    {importCollations.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </>
            )}
            <label className="sm:col-span-2 text-sm text-gray-300">
              SQL file
              <input type="file" accept=".sql,application/sql,text/sql,text/plain" onChange={(e) => setImportFile(e.target.files?.[0] || null)} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white file:mr-3 file:border-0 file:rounded file:bg-accent file:px-3 file:py-1.5 file:text-white" />
            </label>
            <div className="sm:col-span-2">
              <button type="button" onClick={importSql} disabled={importBusy || !importFile} className="px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
                {importBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                {importBusy ? 'Importing...' : 'Import SQL'}
              </button>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">SQL Preview</div>
            <pre className="min-h-[8.5rem] rounded border border-gray-700 bg-primary p-3 text-xs text-gray-200 whitespace-pre-wrap overflow-auto">
              {importForm.mode === 'new'
                ? importCreateSqlPreview
                : `USE \`${importForm.database || 'database_name'}\`;\n-- then Ascend imports the selected .sql file with mysql`}
            </pre>
            {importFile && <div className="mt-2 text-xs text-gray-400">{importFile.name} · {formatBytes(importFile.size)}</div>}
          </div>
        </div>
        {importBusy && (
          <div className="mt-3 rounded border border-accent/30 bg-accent/10 p-3 text-accent text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Uploading and importing SQL. Large dumps can take a few minutes.
          </div>
        )}
        {importError && <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{importError}</div>}
        {importResult?.ok && (
          <div className="mt-3 rounded border border-green-500/30 bg-green-500/10 p-3 text-green-300 text-sm">
            Imported {importResult.filename} into {importResult.database} in {importResult.duration_ms} ms.
          </div>
        )}
      </div>

      <div className="rounded border border-gray-700 bg-primary/30 p-4 max-w-5xl">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-white font-semibold">MySQL users & permissions</h2>
            <p className="text-xs text-gray-500 mt-1">Create database users and grant privileges to one database.</p>
          </div>
          <button type="button" onClick={() => refreshUsers(userForm.database)} disabled={usersLoading} className="text-gray-400 hover:text-white disabled:opacity-50" title="Refresh users">
            <RefreshCw className={`w-4 h-4 ${usersLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm text-gray-300">
                Username
                <input value={userForm.username} onChange={(e) => setUserForm((f) => ({ ...f, username: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white" placeholder="app_user" />
              </label>
              <label className="text-sm text-gray-300">
                Host
                <input value={userForm.host} onChange={(e) => setUserForm((f) => ({ ...f, host: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white" placeholder="localhost or %" />
              </label>
              <label className="text-sm text-gray-300">
                Password
                <input type="password" value={userForm.password} onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white" placeholder="Strong password" />
              </label>
              <label className="text-sm text-gray-300">
                Grant on database
                <select value={userForm.database} onChange={(e) => setUserForm((f) => ({ ...f, database: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white">
                  <option value="">Create user only</option>
                  {databases.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Privileges</div>
              <div className="flex flex-wrap gap-2">
                {MYSQL_PRIVILEGE_OPTIONS.map((p) => (
                  <label key={p} className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-gray-700 bg-primary text-xs text-gray-300">
                    <input type="checkbox" checked={(userForm.privileges || []).includes(p)} onChange={() => togglePrivilege('user', p)} />
                    {p}
                  </label>
                ))}
              </div>
            </div>
            <button type="button" onClick={createMysqlUser} disabled={userBusy || !userForm.username.trim() || !userForm.password} className="px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
              {userBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create user
            </button>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm text-gray-300">
                Existing user
                <select value={`${grantForm.username}@${grantForm.host}`} onChange={(e) => {
                  const [username, ...hostParts] = e.target.value.split('@')
                  setGrantForm((f) => ({ ...f, username, host: hostParts.join('@') || 'localhost' }))
                }} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white">
                  <option value="@localhost">Choose user</option>
                  {mysqlUsers.map((u) => <option key={`${u.username}@${u.host}`} value={`${u.username}@${u.host}`}>{u.username}@{u.host}</option>)}
                </select>
              </label>
              <label className="text-sm text-gray-300">
                Database
                <select value={grantForm.database} onChange={(e) => setGrantForm((f) => ({ ...f, database: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white">
                  {databases.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Grant privileges</div>
              <div className="flex flex-wrap gap-2">
                {MYSQL_PRIVILEGE_OPTIONS.map((p) => (
                  <label key={p} className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-gray-700 bg-primary text-xs text-gray-300">
                    <input type="checkbox" checked={(grantForm.privileges || []).includes(p)} onChange={() => togglePrivilege('grant', p)} />
                    {p}
                  </label>
                ))}
              </div>
            </div>
            <button type="button" onClick={grantMysqlUser} disabled={userBusy || !grantForm.username || !grantForm.database} className="px-3 py-2 bg-primary hover:bg-gray-700 border border-gray-700 rounded text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
              {userBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Grant access
            </button>
          </div>
        </div>

        {usersError && <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{usersError}</div>}
        {userResult?.ok && <div className="mt-3 rounded border border-green-500/30 bg-green-500/10 p-3 text-green-300 text-sm">Updated {userResult.user?.username}@{userResult.user?.host}{userResult.database ? ` for ${userResult.database}` : ''}.</div>}

        <div className="mt-4 rounded border border-gray-700 overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-primary text-gray-300">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Host</th>
                <th className="px-3 py-2">Matching grants</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {mysqlUsers.map((u) => (
                <tr key={`${u.username}@${u.host}`} className="border-t border-gray-700">
                  <td className="px-3 py-2 text-white font-mono">{u.username}</td>
                  <td className="px-3 py-2 text-gray-300 font-mono">{u.host}</td>
                  <td className="px-3 py-2 text-gray-400 text-xs max-w-md truncate" title={(u.grants || []).join('\n')}>{(u.grants || []).length ? `${u.grants.length} grant(s)` : '-'}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => deleteMysqlUser(u)} disabled={userBusy} className="text-red-400 hover:text-red-300 text-xs font-semibold disabled:opacity-50">Delete</button>
                  </td>
                </tr>
              ))}
              {!mysqlUsers.length && (
                <tr><td colSpan={4} className="px-3 py-4 text-gray-500 text-center">{usersLoading ? 'Loading users...' : 'No users returned.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function BackupsTab({ connection }) {
  const dialog = useDialog()
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [backupDialogOpen, setBackupDialogOpen] = useState(false)
  const [backupScope, setBackupScope] = useState('all')
  const [backupDatabase, setBackupDatabase] = useState('')
  const [backupDatabases, setBackupDatabases] = useState([])
  const [backupDbLoading, setBackupDbLoading] = useState(false)
  const [shareLink, setShareLink] = useState(null)

  const refresh = async () => {
    try {
      const res = await apiClient.listDbBackups(connection.id)
      setBackups(res.data.backups || [])
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load backups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    refresh()
    const t = setInterval(refresh, 5000)  // poll while a backup may be running
    return () => clearInterval(t)
    // eslint-disable-next-line
  }, [connection.id])

  const openBackupDialog = async () => {
    setBackupDialogOpen(true)
    setBackupScope('all')
    setBackupDbLoading(true)
    try {
      const res = await apiClient.listDatabases(connection.id)
      const userDbs = res.data.databases || []
      setBackupDatabases(userDbs)
      setBackupDatabase(connection.default_database && userDbs.includes(connection.default_database) ? connection.default_database : (userDbs[0] || ''))
    } catch (err) {
      setBackupDatabases([])
      setBackupDatabase('')
      setError(err.response?.data?.error || 'Failed to load database list')
    } finally {
      setBackupDbLoading(false)
    }
  }

  const onRun = async () => {
    const targetDatabase = backupScope === 'single' ? backupDatabase.trim() : ''
    if (backupScope === 'single' && !targetDatabase) {
      await dialog.alert({ title: 'Choose a database', message: 'Select a database to back up, or choose all databases.', tone: 'warning' })
      return
    }
    setRunning(true)
    try {
      await apiClient.runDbBackup(connection.id, targetDatabase)
      setBackupDialogOpen(false)
      setTimeout(refresh, 800)
    } catch (err) {
      await dialog.alert({ title: 'Backup failed to start', message: err.response?.data?.error || 'Failed to start backup', tone: 'danger' })
    } finally {
      setRunning(false)
    }
  }

  const onDelete = async (b) => {
    const ok = await dialog.confirm({
      title: 'Delete backup?',
      message: `Delete ${b.filename}?\n\nThis cannot be undone.`,
      confirmLabel: 'Delete backup',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await apiClient.deleteDbBackup(b.id)
      refresh()
    } catch (err) {
      await dialog.alert({ title: 'Delete failed', message: err.response?.data?.error || 'Delete failed', tone: 'danger' })
    }
  }

  const onShare = async (b) => {
    const rawHours = await dialog.prompt({
      title: 'Create temporary backup link',
      message: `Share "${b.filename}" with a temporary download link.`,
      label: 'Expires after hours',
      defaultValue: '24',
      confirmLabel: 'Create link',
      required: true,
    })
    if (!rawHours) return
    const hours = Math.max(1, Math.min(parseInt(rawHours, 10) || 24, 168))
    try {
      const res = await apiClient.shareDbBackup(b.id, hours)
      setShareLink({ ...res.data, name: b.filename })
    } catch (err) {
      await dialog.alert({ title: 'Share failed', message: err.response?.data?.error || 'Could not create share link', tone: 'danger' })
    }
  }

  const copyShareLink = async () => {
    if (!shareLink?.url) return
    try {
      const ok = await copyTextToClipboard(shareLink.url)
      if (!ok) throw new Error('copy failed')
    } catch {
      await dialog.alert({ title: 'Copy failed', message: 'Could not copy automatically. Select the link and copy it manually.', tone: 'warning' })
    }
  }

  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      <BackupUploadSettings />
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">{backups.length} backup(s)</span>
        <button
          type="button"
          onClick={openBackupDialog}
          disabled={running}
          className="px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Backup now
        </button>
      </div>
      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{error}</div>
      )}
      {loading ? (
        <div className="text-gray-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded border border-gray-700">
          <table className="w-full text-sm text-left">
            <thead className="bg-primary text-gray-300 sticky top-0">
              <tr>
                <th className="px-3 py-2">Filename</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Took</th>
                <th className="px-3 py-2">Trigger</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id} className="border-t border-gray-700 hover:bg-primary/40">
                  <td className="px-3 py-1.5 text-gray-200 font-mono text-xs">{b.filename}</td>
                  <td className="px-3 py-1.5">
                    {b.status === 'success' && <span className="text-green-400 text-xs">success</span>}
                    {b.status === 'pending' && <span className="text-yellow-400 text-xs">running…</span>}
                    {b.status === 'failed' && (
                      <span className="text-red-400 text-xs" title={b.error_message || ''}>failed</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-gray-300 text-xs">{formatBytes(b.size_bytes)}</td>
                  <td className="px-3 py-1.5 text-gray-300 text-xs whitespace-nowrap">{formatTime(b.started_at)}</td>
                  <td className="px-3 py-1.5 text-gray-300 text-xs">{b.duration_seconds != null ? `${b.duration_seconds}s` : '—'}</td>
                  <td className="px-3 py-1.5 text-gray-300 text-xs">{b.triggered_by}</td>
                  <td className="px-3 py-1.5 text-right">
                    {b.status === 'success' && (
                      <a
                        href={apiClient.downloadDbBackupUrl(b.id)}
                        className="text-accent hover:underline text-xs mr-3"
                      >
                        Download
                      </a>
                    )}
                    {b.status === 'success' && (
                      <button
                        type="button"
                        onClick={() => onShare(b)}
                        className="text-accent hover:underline text-xs mr-3"
                      >
                        Share
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDelete(b)}
                      className="text-red-400 hover:underline text-xs"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {backups.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500 text-sm">No backups yet — click "Backup now" or set up a schedule.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {backupDialogOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-lg border border-gray-700 bg-secondary shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-700 px-4 py-3">
              <div>
                <h2 className="text-white font-semibold">Create database backup</h2>
                <p className="text-xs text-gray-400 mt-1">Choose whether this manual backup should include everything or one database.</p>
              </div>
              <button type="button" onClick={() => setBackupDialogOpen(false)} disabled={running} className="text-gray-400 hover:text-white disabled:opacity-50">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <label className={`block rounded border p-3 cursor-pointer ${backupScope === 'all' ? 'border-accent bg-accent/10' : 'border-gray-700 bg-primary/30 hover:border-gray-600'}`}>
                <span className="flex items-start gap-3">
                  <input type="radio" name="backup-scope" checked={backupScope === 'all'} onChange={() => setBackupScope('all')} className="mt-1" />
                  <span>
                    <span className="block text-sm font-semibold text-white">All databases</span>
                    <span className="block text-xs text-gray-400 mt-0.5">Full MySQL dump for this connection. This will usually be larger.</span>
                  </span>
                </span>
              </label>
              <label className={`block rounded border p-3 cursor-pointer ${backupScope === 'single' ? 'border-accent bg-accent/10' : 'border-gray-700 bg-primary/30 hover:border-gray-600'}`}>
                <span className="flex items-start gap-3">
                  <input type="radio" name="backup-scope" checked={backupScope === 'single'} onChange={() => setBackupScope('single')} className="mt-1" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-white">Specific database</span>
                    <span className="block text-xs text-gray-400 mt-0.5">Smaller dump for one selected database.</span>
                    <select
                      value={backupDatabase}
                      onChange={(e) => setBackupDatabase(e.target.value)}
                      disabled={backupScope !== 'single' || backupDbLoading || !backupDatabases.length}
                      className="mt-3 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white disabled:opacity-50"
                    >
                      {backupDbLoading && <option value="">Loading databases...</option>}
                      {!backupDbLoading && backupDatabases.length === 0 && <option value="">No databases available</option>}
                      {!backupDbLoading && backupDatabases.map((dbName) => <option key={dbName} value={dbName}>{dbName}</option>)}
                    </select>
                  </span>
                </span>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-700 px-4 py-3">
              <button type="button" onClick={() => setBackupDialogOpen(false)} disabled={running} className="px-3 py-2 rounded border border-gray-600 text-gray-200 hover:bg-primary text-sm disabled:opacity-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={onRun}
                disabled={running || backupDbLoading || (backupScope === 'single' && !backupDatabase)}
                className="px-3 py-2 rounded bg-accent hover:bg-accent/80 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Start backup
              </button>
            </div>
          </div>
        </div>
      )}
      {shareLink && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-lg border border-gray-700 bg-secondary shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-700 px-4 py-3">
              <div>
                <h2 className="text-white font-semibold">Public link for {shareLink.name}</h2>
                <p className="text-xs text-gray-400 mt-1">Anyone with this link can download this backup until it expires.</p>
              </div>
              <button type="button" onClick={() => setShareLink(null)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <label className="block text-sm text-gray-300">
                Temporary download link
                <div className="mt-1 flex gap-2">
                  <input readOnly value={shareLink.url || ''} className="flex-1 bg-primary border border-gray-700 rounded px-3 py-2 text-white font-mono text-xs" />
                  <button type="button" onClick={copyShareLink} className="px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold">
                    Copy
                  </button>
                </div>
              </label>
              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                Expires at {shareLink.expires_at ? new Date(shareLink.expires_at).toLocaleString() : 'the selected expiry time'}.
                Deleting the backup invalidates this link sooner.
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-700 px-4 py-3">
              <a href={shareLink.url} target="_blank" rel="noreferrer" className="px-3 py-2 rounded border border-gray-600 text-gray-200 hover:bg-primary text-sm">
                View link
              </a>
              <button type="button" onClick={() => setShareLink(null)} className="px-3 py-2 rounded bg-accent hover:bg-accent/80 text-white text-sm font-semibold">
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Schedule editor (one row per database or “all”) ──────────────

function BackupUploadSettings() {
  const [form, setForm] = useState({
    enabled: false,
    webdav_url: 'https://app.koofr.net/dav/Koofr/Ascend-Backups',
    username: '',
    password: '',
    remote_path: '',
    include_link_in_success_email: true,
    has_password: false,
  })
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await apiClient.getBackupUploadSettings()
      setForm((f) => ({ ...f, ...res.data, password: '' }))
    } catch {
      setMessage('Could not load upload settings')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    setMessage('')
    try {
      const payload = {
        enabled: !!form.enabled,
        webdav_url: form.webdav_url,
        username: form.username,
        remote_path: form.remote_path,
        include_link_in_success_email: !!form.include_link_in_success_email,
        clear_password: false,
      }
      if (form.password.trim()) payload.password = form.password.trim()
      const res = await apiClient.updateBackupUploadSettings(payload)
      setForm((f) => ({ ...f, ...res.data, password: '' }))
      setMessage('Upload settings saved')
    } catch (err) {
      setMessage(err.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setMessage('')
    try {
      const res = await apiClient.testBackupUploadSettings()
      setMessage(`Test uploaded to ${res.data.uploaded_to}`)
    } catch (err) {
      setMessage(err.response?.data?.error || 'Upload test failed')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded border border-gray-700 bg-primary/35">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full px-3 py-2 flex items-center justify-between gap-3 text-left">
        <span className="inline-flex items-center gap-2 text-sm text-white font-semibold">
          <UploadCloud className="w-4 h-4 text-accent" />
          Remote backup upload
          <span className={form.enabled ? 'text-green-400 text-xs' : 'text-gray-500 text-xs'}>{form.enabled ? 'enabled' : 'off'}</span>
        </span>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {open && (
        <div className="border-t border-gray-700 p-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="md:col-span-2 rounded border border-blue-500/25 bg-blue-500/10 p-2 text-xs text-blue-100/90">
            Koofr is a simple free option. Use your Koofr account email as the username, but do not use your normal Koofr login password here.
            Generate an application-specific WebDAV password in Koofr, paste that as the password, then use the default URL.
          </div>
          <label className="md:col-span-2 flex items-center gap-2 text-gray-300">
            <input type="checkbox" checked={!!form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
            Upload successful backups to WebDAV
          </label>
          <label className="md:col-span-2 flex items-start gap-2 text-gray-300">
            <input
              type="checkbox"
              checked={!!form.include_link_in_success_email}
              onChange={(e) => setForm((f) => ({ ...f, include_link_in_success_email: e.target.checked }))}
              className="mt-0.5"
            />
            <span>
              Include uploaded drive link in successful backup emails
              <span className="block text-[11px] text-gray-500 mt-0.5">The link points to the WebDAV upload location and may require the drive account to be signed in.</span>
            </span>
          </label>
          <label className="md:col-span-2 text-gray-300">
            WebDAV URL
            <input value={form.webdav_url} onChange={(e) => setForm((f) => ({ ...f, webdav_url: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" />
          </label>
          <label className="text-gray-300">
            Username / email
            <input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" />
          </label>
          <label className="text-gray-300">
            WebDAV app password {form.has_password && <span className="text-gray-500">(leave blank to keep)</span>}
            <input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder={form.has_password ? '********' : ''} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" />
            <span className="text-[11px] text-gray-500 mt-1 block">For Koofr, create this in Koofr app passwords/WebDAV passwords. The normal website password will return unauthorized.</span>
          </label>
          <label className="md:col-span-2 text-gray-300">
            Extra remote folder (optional)
            <input value={form.remote_path} onChange={(e) => setForm((f) => ({ ...f, remote_path: e.target.value }))} placeholder="production/mysql" className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1.5 text-white" />
          </label>
          {message && <div className="md:col-span-2 rounded border border-gray-600 bg-secondary px-2 py-1.5 text-xs text-gray-200 break-all">{message}</div>}
          <div className="md:col-span-2 flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={saving} className="px-3 py-1.5 bg-accent hover:bg-accent/80 rounded text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save upload settings
            </button>
            <button type="button" onClick={test} disabled={testing || saving} className="px-3 py-1.5 border border-gray-600 hover:bg-primary/60 rounded text-white text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
              Test upload
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function RestoreTab({ connection }) {
  const dialog = useDialog()
  const [backups, setBackups] = useState([])
  const [databases, setDatabases] = useState([])
  const [form, setForm] = useState({ backup_id: '', target_database: '', collation: 'utf8mb4_general_ci', replace_existing: true })
  const [job, setJob] = useState(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState('')
  const [downloadFilename, setDownloadFilename] = useState('')
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [downloadResult, setDownloadResult] = useState('')

  const load = useCallback(async () => {
    try {
      const [backupRes, dbRes] = await Promise.all([apiClient.listDbBackups(connection.id), apiClient.listDatabases(connection.id)])
      const good = (backupRes.data.backups || []).filter((b) => b.status === 'success')
      const all = [...(dbRes.data.databases || []), ...(dbRes.data.system_databases || [])]
      setBackups(good)
      setDatabases(all)
      setForm((f) => ({
        ...f,
        backup_id: f.backup_id || String(good[0]?.id || ''),
        target_database: f.target_database || connection.default_database || all[0] || '',
      }))
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load restore data')
    }
  }, [connection.id, connection.default_database])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!job || job.status === 'success' || job.status === 'failed') return undefined
    const t = setInterval(async () => {
      try {
        const res = await apiClient.getDbRestoreJob(job.id)
        setJob(res.data.job)
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to refresh restore progress')
      }
    }, 1500)
    return () => clearInterval(t)
  }, [job])

  const downloadBackup = async () => {
    const url = downloadUrl.trim()
    if (!url) {
      setError('Paste a public .sql file URL first.')
      return
    }
    setDownloadBusy(true)
    setError('')
    setDownloadResult('')
    try {
      const res = await apiClient.downloadDbBackupFromUrl(connection.id, {
        url,
        filename: downloadFilename.trim(),
      })
      const backup = res.data.backup
      await load()
      setForm((f) => ({ ...f, backup_id: String(backup?.id || f.backup_id) }))
      setDownloadResult(`Downloaded ${backup?.filename || 'SQL backup'} and selected it for restore.`)
      setDownloadUrl('')
      setDownloadFilename('')
    } catch (err) {
      const backup = err.response?.data?.backup
      const suffix = backup?.filename ? ` (${backup.filename})` : ''
      setError((err.response?.data?.error || 'Failed to download SQL backup from URL') + suffix)
    } finally {
      setDownloadBusy(false)
    }
  }

  const start = async () => {
    if (!form.backup_id || !form.target_database.trim()) {
      setError('Choose a backup and target database.')
      return
    }
    const target = form.target_database.trim()
    const targetExists = databases.includes(target)
    const msg = targetExists
      ? `Restore into existing database "${target}"? Ascend will take a safety backup first, then ${form.replace_existing ? 'replace it' : 'import over it'}.`
      : `Create database "${target}" and restore this backup into it?`
    const ok = await dialog.confirm({
      title: targetExists ? 'Restore into existing database?' : 'Create and restore database?',
      message: msg,
      confirmLabel: 'Start restore',
      tone: targetExists ? 'warning' : 'info',
    })
    if (!ok) return
    if (targetExists && form.replace_existing) {
      const typedOk = await dialog.typedConfirm({
        title: 'Confirm replacement',
        message: `Restore will replace "${target}" after taking a safety backup.`,
        expected: target,
        confirmLabel: 'Replace database',
        tone: 'danger',
      })
      if (!typedOk) return
    }
    const shouldReplace = targetExists && !!form.replace_existing
    setStarting(true)
    setError('')
    try {
      const res = await apiClient.startDbRestore(connection.id, {
        backup_id: Number(form.backup_id),
        target_database: target,
        collation: form.collation.trim() || 'utf8mb4_general_ci',
        replace_existing: shouldReplace,
        confirm_text: shouldReplace ? target : '',
      })
      setJob(res.data.job)
    } catch (err) {
      setError(err.response?.data?.error || 'Restore failed to start')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      <div className="rounded border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100/90 leading-relaxed max-w-4xl">
        Restoring to an existing database first creates a safety backup. New databases default to utf8mb4_general_ci.
      </div>
      {error && <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{error}</div>}
      {downloadResult && <div className="rounded border border-green-500/30 bg-green-500/10 p-3 text-green-300 text-sm">{downloadResult}</div>}
      <div className="rounded border border-gray-700 bg-primary/30 p-4 max-w-4xl">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h3 className="text-white font-semibold">Download SQL backup from URL</h3>
            <p className="text-xs text-gray-400 mt-1">Download a public .sql file, then select it below and restore it into any database.</p>
          </div>
          <button
            type="button"
            onClick={downloadBackup}
            disabled={downloadBusy || !downloadUrl.trim()}
            className="px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm inline-flex items-center gap-2 disabled:opacity-50"
          >
            {downloadBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download backup
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-3">
          <input
            value={downloadUrl}
            onChange={(e) => setDownloadUrl(e.target.value)}
            placeholder="https://example.com/backup.sql"
            className="w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white placeholder-gray-500 text-sm"
          />
          <input
            value={downloadFilename}
            onChange={(e) => setDownloadFilename(e.target.value)}
            placeholder="Optional filename.sql"
            className="w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white placeholder-gray-500 text-sm"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl">
        <label className="md:col-span-2 text-sm text-gray-300">
          Backup
          <select value={form.backup_id} onChange={(e) => setForm((f) => ({ ...f, backup_id: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white">
            {backups.map((b) => <option key={b.id} value={b.id}>{b.filename} - {formatTime(b.completed_at || b.started_at)}</option>)}
          </select>
        </label>
        <label className="text-sm text-gray-300">
          Restore to database
          <input value={form.target_database} onChange={(e) => setForm((f) => ({ ...f, target_database: e.target.value }))} list="restore-db-list" className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white" />
          <datalist id="restore-db-list">{databases.map((d) => <option key={d} value={d} />)}</datalist>
        </label>
        <label className="text-sm text-gray-300">
          Collation
          <input value={form.collation} onChange={(e) => setForm((f) => ({ ...f, collation: e.target.value }))} className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-2 text-white" />
        </label>
        <label className="md:col-span-2 flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={!!form.replace_existing} onChange={(e) => setForm((f) => ({ ...f, replace_existing: e.target.checked }))} />
          Replace existing database after the safety backup
        </label>
      </div>
      <div>
        <button type="button" onClick={start} disabled={starting || backups.length === 0} className="px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
          Start restore
        </button>
      </div>
      {job && (
        <div className="rounded border border-gray-700 bg-primary/40 p-4 max-w-3xl">
          <div className="flex items-center justify-between gap-3 text-sm mb-2">
            <span className="text-white font-semibold">{job.phase || job.status}</span>
            <span className={job.status === 'failed' ? 'text-red-400' : job.status === 'success' ? 'text-green-400' : 'text-gray-300'}>{job.status}</span>
          </div>
          <div className="h-2 bg-gray-800 rounded overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }} /></div>
          <div className="mt-2 text-xs text-gray-400">{job.progress || 0}% - target {job.target_database}</div>
          {job.safety_backup_id && <div className="mt-1 text-xs text-green-300">Safety backup id: {job.safety_backup_id}</div>}
          {job.error && <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300 text-xs font-mono whitespace-pre-wrap">{job.error}</div>}
        </div>
      )}
    </div>
  )
}

function ScheduleTab({ connection }) {
  const dialog = useDialog()
  const [rows, setRows] = useState([])
  const [dbNames, setDbNames] = useState([])
  const [serverTimezone, setServerTimezone] = useState('UTC')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [editingId, setEditingId] = useState(null)

  const load = async () => {
    try {
      const [schedRes, dbRes] = await Promise.all([
        apiClient.listDbBackupSchedules(connection.id),
        apiClient.listDatabases(connection.id),
      ])
      setServerTimezone(schedRes.data.server_timezone || 'UTC')
      setRows(schedRes.data.schedules || [])
      const all = [...(dbRes.data.databases || []), ...(dbRes.data.system_databases || [])]
      setDbNames([...new Set(all)].sort())
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load schedules')
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    setLoaded(false)
    setEditingId(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id])

  useEffect(() => {
    if (!loaded) return
    const t = setInterval(() => {
      if (editingId == null) load()
    }, 45000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id, loaded, editingId])

  const patchRow = (id, updates) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...updates } : r)))
  }

  /** Names from the server plus any target already on a schedule row (so the select always matches). */
  const databasePickList = useMemo(() => {
    const s = new Set(dbNames)
    rows.forEach((row) => {
      const t = (row.target_database || '').trim()
      if (t) s.add(t)
    })
    return [...s].sort()
  }, [dbNames, rows])

  const saveRow = async (r) => {
    const td = (r.target_database || '').trim()
    if (td && !databasePickList.includes(td)) {
      await dialog.alert({ title: 'Choose a valid database', message: 'Choose a database from the dropdown, or All databases. That name is not in the current list. Try Refresh DB list.', tone: 'warning' })
      return
    }
    setBusyId(r.id)
    try {
      await apiClient.updateDbBackupSchedule(connection.id, r.id, {
        enabled: !!r.enabled,
        every_hours: Number(r.every_hours) || 24,
        at_hour: Number(r.at_hour) || 0,
        at_minute: Number(r.at_minute) || 0,
        retention_days: Number(r.retention_days) || 14,
        target_database: td,
        schedule_timezone: (r.schedule_timezone || '').trim().replace(/\\/g, '/') || null,
      })
      setEditingId(null)
      await load()
    } catch (err) {
      await dialog.alert({ title: 'Save failed', message: err.response?.data?.error || 'Save failed', tone: 'danger' })
    } finally {
      setBusyId(null)
    }
  }

  const addSchedule = async () => {
    setBusyId(-1)
    try {
      await apiClient.createDbBackupSchedule(connection.id, {
        enabled: true,
        every_hours: 24,
        at_hour: 2,
        at_minute: 0,
        retention_days: 14,
        target_database: '',
      })
      await load()
    } catch (err) {
      await dialog.alert({ title: 'Create failed', message: err.response?.data?.error || 'Create failed', tone: 'danger' })
    } finally {
      setBusyId(null)
    }
  }

  const deleteRow = async (scheduleId) => {
    const ok = await dialog.confirm({
      title: 'Delete backup schedule?',
      message: 'Delete this backup schedule? Existing backup files will stay available.',
      confirmLabel: 'Delete schedule',
      tone: 'danger',
    })
    if (!ok) return
    setBusyId(scheduleId)
    try {
      await apiClient.deleteDbBackupSchedule(connection.id, scheduleId)
      setEditingId((eid) => (eid === scheduleId ? null : eid))
      await load()
    } catch (err) {
      await dialog.alert({ title: 'Delete failed', message: err.response?.data?.error || 'Delete failed', tone: 'danger' })
    } finally {
      setBusyId(null)
    }
  }

  if (!loaded) {
    return (
      <div className="p-4 text-gray-400 text-sm flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading schedules…
      </div>
    )
  }

  const cancelEdit = async () => {
    setEditingId(null)
    await load()
  }

  return (
    <div className="p-4 flex flex-col gap-3 h-full min-h-0">
      <div className="rounded border border-blue-500/25 bg-blue-500/10 p-2.5 text-xs text-blue-100/90 leading-relaxed max-w-4xl">
        <strong className="text-blue-200">APScheduler</strong> runs while Ascend is up. Use <strong className="text-blue-200">24</strong> h for daily runs;
        hour and minute are <strong className="text-blue-200">wall clock</strong> in the timezone column (e.g.{' '}
        <span className="font-mono text-blue-100">Asia/Beirut</span>
        ). Blank timezone → server default{' '}
        <span className="font-mono text-gray-300">{serverTimezone}</span>
        . Polling pauses while a row is open for edit.
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300 text-sm">{error}</div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-gray-400">{rows.length} schedule(s)</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-300 border border-gray-600 rounded hover:bg-primary/60"
            title="Reload schedules and database names"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={addSchedule}
            disabled={busyId === -1 || editingId != null}
            className="inline-flex items-center gap-2 px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold disabled:opacity-50"
            title={editingId != null ? 'Finish or cancel the current edit first' : ''}
          >
            {busyId === -1 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add schedule
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto rounded border border-gray-700">
        <table className="w-full text-sm text-left min-w-[920px]">
          <thead className="bg-primary text-gray-300 sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 font-medium">Database</th>
              <th className="px-3 py-2 font-medium w-14">On</th>
              <th className="px-3 py-2 font-medium">Every (h)</th>
              <th className="px-3 py-2 font-medium">Hour</th>
              <th className="px-3 py-2 font-medium">Min</th>
              <th className="px-3 py-2 font-medium">Ret. (d)</th>
              <th className="px-3 py-2 font-medium min-w-[7rem]">Timezone</th>
              <th className="px-3 py-2 font-medium min-w-[10rem]">Next run</th>
              <th className="px-3 py-2 font-medium min-w-[8rem]">Last</th>
              <th className="px-3 py-2 font-medium text-right w-36">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const daily = Number(r.every_hours) === 24
              const target = (r.target_database || '').trim()
              const displayTz = (r.schedule_timezone || '').trim() || serverTimezone || 'UTC'
              const nextLabel = !r.enabled
                ? '— (off)'
                : (r.next_run_at ? formatTimeInZone(r.next_run_at, displayTz) : '—')
              const atWall = `${String(r.at_hour ?? 0).padStart(2, '0')}:${String(r.at_minute ?? 0).padStart(2, '0')}`
              const isEdit = editingId === r.id
              const lastShort = r.last_run_at
                ? `${formatTimeInZone(r.last_run_at, displayTz)} · ${r.last_run_status || '—'}`
                : '—'
              return (
                <tr key={r.id} className={`border-t border-gray-700 ${isEdit ? 'bg-primary/50' : 'hover:bg-primary/40'}`}>
                  <td className="px-3 py-2 align-top">
                    {isEdit ? (
                      <select
                        value={target}
                        onChange={(e) => patchRow(r.id, { target_database: e.target.value })}
                        className="w-full max-w-[11rem] bg-primary border border-gray-700 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="">All databases</option>
                        {databasePickList.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    ) : (
                      <span className="text-gray-200 font-mono text-xs">{target || 'All'}</span>
                    )}
                    {isEdit && target && !dbNames.includes(target) && (
                      <div className="text-[10px] text-amber-400/90 mt-1 max-w-[11rem]">Not in latest DB list — refresh or change.</div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {isEdit ? (
                      <input
                        type="checkbox"
                        checked={!!r.enabled}
                        onChange={(e) => patchRow(r.id, { enabled: e.target.checked })}
                        className="rounded border-gray-600"
                        title="Enabled"
                      />
                    ) : (
                      <span className={r.enabled ? 'text-green-400 text-xs' : 'text-gray-500 text-xs'}>{r.enabled ? 'Yes' : 'No'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {isEdit ? (
                      <input
                        type="number"
                        min={1}
                        max={720}
                        value={r.every_hours}
                        onChange={(e) => patchRow(r.id, { every_hours: Number(e.target.value) })}
                        className="w-16 bg-primary border border-gray-700 rounded px-1.5 py-1 text-white text-xs"
                      />
                    ) : (
                      <span className="text-gray-300 text-xs">{r.every_hours ?? '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {isEdit ? (
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={r.at_hour ?? 0}
                        disabled={!daily}
                        onChange={(e) => patchRow(r.id, { at_hour: Number(e.target.value) })}
                        className="w-14 bg-primary border border-gray-700 rounded px-1.5 py-1 text-white text-xs disabled:opacity-40"
                      />
                    ) : (
                      <span className="text-gray-300 text-xs">{daily ? (r.at_hour ?? 0) : '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {isEdit ? (
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={r.at_minute ?? 0}
                        onChange={(e) => patchRow(r.id, { at_minute: Number(e.target.value) })}
                        className="w-14 bg-primary border border-gray-700 rounded px-1.5 py-1 text-white text-xs"
                      />
                    ) : (
                      <span className="text-gray-300 text-xs">{daily ? (r.at_minute ?? 0) : '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {isEdit ? (
                      <input
                        type="number"
                        min={1}
                        max={1825}
                        value={r.retention_days ?? 14}
                        onChange={(e) => patchRow(r.id, { retention_days: Number(e.target.value) })}
                        className="w-16 bg-primary border border-gray-700 rounded px-1.5 py-1 text-white text-xs"
                      />
                    ) : (
                      <span className="text-gray-300 text-xs">{r.retention_days ?? '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {isEdit ? (
                      <>
                        <input
                          type="text"
                          value={r.schedule_timezone || ''}
                          onChange={(e) => patchRow(r.id, { schedule_timezone: e.target.value })}
                          list={`tzlist-${r.id}`}
                          placeholder={serverTimezone}
                          className="w-full min-w-[6rem] max-w-[9rem] bg-primary border border-gray-700 rounded px-1.5 py-1 text-xs text-white placeholder:text-gray-600"
                        />
                        <datalist id={`tzlist-${r.id}`}>
                          <option value="" />
                          {COMMON_TIMEZONES.map((z) => <option key={z} value={z} />)}
                        </datalist>
                      </>
                    ) : (
                      <span className="text-gray-400 font-mono text-[11px] break-all" title={displayTz}>{displayTz}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs">
                    {!isEdit && (
                      <>
                        <span className="text-green-300 whitespace-nowrap">{nextLabel}</span>
                        {!r.enabled && <span className="text-gray-500 block mt-0.5">schedule off</span>}
                        {r.enabled && (
                          <span className="text-gray-500 font-mono text-[10px] block mt-0.5">{displayTz}</span>
                        )}
                      </>
                    )}
                    {isEdit && (
                      <span className="text-gray-500 text-[11px] leading-snug">
                        Save to refresh next run. Wall time when daily:{' '}
                        <span className="font-mono text-gray-400">{atWall}</span>
                        {' '}in TZ column.
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-400 max-w-[14rem]">
                    {!isEdit && (
                      <>
                        <span className="line-clamp-2" title={r.last_run_error || lastShort}>{lastShort}</span>
                        {r.last_run_error && (
                          <span className="text-red-400/90 font-mono text-[10px] block truncate mt-0.5" title={r.last_run_error}>
                            {r.last_run_error.length > 48 ? `${r.last_run_error.slice(0, 48)}…` : r.last_run_error}
                          </span>
                        )}
                      </>
                    )}
                    {isEdit && <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                    {isEdit ? (
                      <div className="inline-flex flex-col items-end gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const cur = rows.find((x) => x.id === r.id)
                            if (cur) saveRow(cur)
                          }}
                          disabled={busyId === r.id}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-accent hover:bg-accent/80 rounded text-white text-xs font-semibold disabled:opacity-50"
                        >
                          {busyId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={busyId === r.id}
                          className="text-gray-400 hover:text-white text-xs disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="inline-flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(r.id)}
                          disabled={editingId != null && editingId !== r.id}
                          className="inline-flex items-center gap-1 text-accent hover:underline text-xs disabled:opacity-40 disabled:no-underline"
                          title={editingId != null && editingId !== r.id ? 'Finish the other row first' : 'Edit this schedule'}
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRow(r.id)}
                          disabled={busyId === r.id || (editingId != null && editingId !== r.id)}
                          className="text-red-400 hover:underline text-xs disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-gray-500 text-sm">
                  No backup schedules — click &quot;Add schedule&quot; to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Connection form (used for new only — edit later) ────────────

function ConnectionForm({ onCancel, onSaved }) {
  const [defaultHost, setDefaultHost] = useState('127.0.0.1')
  const [data, setData] = useState({
    name: '', host: '', port: 3306, username: 'root', password: '', default_database: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Best-effort default the host to the server's external IP
    fetch('/api/system/stats').then((r) => r.json()).then((s) => {
      const ip = s?.public_ip || s?.host || ''
      if (ip && !data.host) {
        setDefaultHost(ip)
        setData((d) => ({ ...d, host: ip }))
      }
    }).catch(() => {})
    // eslint-disable-next-line
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await apiClient.createDbConnection({
        ...data,
        host: data.host || defaultHost,
        port: Number(data.port) || 3306,
      })
      onSaved(res.data.connection)
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded border border-gray-700 bg-secondary p-5 mb-4 max-w-xl">
      <h2 className="text-white font-semibold mb-3">New connection</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-gray-300 col-span-2">
          Name
          <input
            value={data.name}
            onChange={(e) => setData((d) => ({ ...d, name: e.target.value }))}
            className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1 text-white"
            placeholder="my-prod-db"
            required
          />
        </label>
        <label className="text-sm text-gray-300 col-span-2">
          Host
          <input
            value={data.host}
            onChange={(e) => setData((d) => ({ ...d, host: e.target.value }))}
            className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1 text-white"
            placeholder={defaultHost}
          />
        </label>
        <label className="text-sm text-gray-300">
          Port
          <input
            type="number"
            value={data.port}
            onChange={(e) => setData((d) => ({ ...d, port: e.target.value }))}
            className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1 text-white"
          />
        </label>
        <label className="text-sm text-gray-300">
          Username
          <input
            value={data.username}
            onChange={(e) => setData((d) => ({ ...d, username: e.target.value }))}
            className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1 text-white"
            required
          />
        </label>
        <label className="text-sm text-gray-300 col-span-2">
          Password
          <input
            type="password"
            value={data.password}
            onChange={(e) => setData((d) => ({ ...d, password: e.target.value }))}
            className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1 text-white"
          />
        </label>
        <label className="text-sm text-gray-300 col-span-2">
          Default database (optional)
          <input
            value={data.default_database}
            onChange={(e) => setData((d) => ({ ...d, default_database: e.target.value }))}
            className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1 text-white"
          />
        </label>
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300 text-sm mt-3">{error}</div>
      )}

      <div className="flex items-center gap-3 mt-4">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Create connection
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Tiny formatters ─────────────────────────────────────────────

function formatBytes(n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`
}

function formatTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch { return iso }
}

/** Format an ISO instant in a specific IANA zone (matches schedule hour/minute semantics). */
function formatTimeInZone(iso, timeZone) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const opts = { dateStyle: 'short', timeStyle: 'short' }
    const z = (timeZone || '').trim().replace(/\\/g, '/')
    if (z) opts.timeZone = z
    return d.toLocaleString(undefined, opts)
  } catch {
    return formatTime(iso)
  }
}
