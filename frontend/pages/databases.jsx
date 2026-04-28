import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Head from 'next/head'
import {
  Database, Plus, Trash2, Play, Download, RefreshCw, Loader2,
  CheckCircle2, XCircle, AlertTriangle, Save, Calendar, Table as TableIcon,
  ChevronDown, ChevronRight, Folder, Server, Eye, Code2, ScrollText, Search, X,
} from 'lucide-react'
import { apiClient } from '@/lib/api'

const TABS = [
  { id: 'browse',   label: 'Browse',   icon: TableIcon },
  { id: 'sql',      label: 'SQL',      icon: Play },
  { id: 'backups',  label: 'Backups',  icon: Download },
  { id: 'schedule', label: 'Schedule', icon: Calendar },
]

const COMMON_TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Tokyo', 'Asia/Singapore',
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
    <>
      <Head><title>Databases · Ascend</title></Head>
      <div className="p-8 h-full flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Database className="w-8 h-8 text-accent" /> Databases
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Manage MySQL/MariaDB connections, browse tables, run queries, and schedule backups.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-2 px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold"
          >
            <Plus className="w-4 h-4" /> New connection
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
    </>
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
    if (!window.confirm(`Delete connection "${c.name}"? Backups on disk will also be removed.`)) return
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
      alert(err.response?.data?.error || 'Delete failed')
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
            <TableViewer
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
        {tab === 'backups' && <BackupsTab connection={connection} />}
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

function BrowseTab({ connection, browseSelection, onBrowseSelectionChange, onOpenTableTab }) {
  const [databases, setDatabases] = useState([])
  const [database, setDatabase] = useState('')
  const [tables, setTables] = useState([])
  const [table, setTable] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const treeSel = browseSelection?.connectionId === connection.id ? browseSelection : null
  const folderMode = treeSel && (treeSel.folder === 'tables' || treeSel.folder === 'views')
  const browseRef = useRef(browseSelection)
  browseRef.current = browseSelection

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
    apiClient.listTables(connection.id, database)
      .then((res) => {
        if (cancelled) return
        const tlist = res.data.tables || []
        setTables(tlist)
        const ts = browseRef.current?.connectionId === connection.id ? browseRef.current : null
        const fromTree = ts
          && ts.database === database
          && (ts.kind === 'table' || ts.kind === 'view')
        if (fromTree) setTable(ts.name)
        else setTable(tlist[0]?.name || '')
      })
      .catch((err) => !cancelled && setError(err.response?.data?.error || 'Failed to load tables'))
    return () => { cancelled = true }
  }, [connection.id, database, folderMode])

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
      </div>

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
        <TableViewer connectionId={connection.id} database={database} table={table} showSearch />
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

function BackupsTab({ connection }) {
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

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

  const onRun = async () => {
    setRunning(true)
    try {
      await apiClient.runDbBackup(connection.id)
      setTimeout(refresh, 800)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to start backup')
    } finally {
      setRunning(false)
    }
  }

  const onDelete = async (b) => {
    if (!window.confirm(`Delete backup ${b.filename}?`)) return
    try {
      await apiClient.deleteDbBackup(b.id)
      refresh()
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed')
    }
  }

  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">{backups.length} backup(s)</span>
        <button
          type="button"
          onClick={onRun}
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
    </div>
  )
}

// ── Schedule editor ─────────────────────────────────────────────

function ScheduleTab({ connection }) {
  const [schedule, setSchedule] = useState({
    enabled: true,
    every_hours: 24,
    at_hour: 2,
    at_minute: 0,
    schedule_timezone: null,
    retention_days: 14,
    databases: [],
  })
  const [serverTimezone, setServerTimezone] = useState('UTC')
  const [tzInput, setTzInput] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    apiClient.getDbSchedule(connection.id)
      .then((res) => {
        if (res.data.server_timezone) setServerTimezone(res.data.server_timezone)
        if (res.data.schedule) {
          const s = res.data.schedule
          setSchedule({
            enabled: s.enabled !== false,
            every_hours: s.every_hours ?? 24,
            at_hour: s.at_hour ?? 2,
            at_minute: s.at_minute ?? 0,
            schedule_timezone: s.schedule_timezone ?? null,
            retention_days: s.retention_days ?? 14,
            databases: s.databases || [],
            last_run_at: s.last_run_at,
            last_run_status: s.last_run_status,
            last_run_error: s.last_run_error,
          })
          setTzInput(s.schedule_timezone || '')
        }
        setLoaded(true)
      })
      .catch((err) => {
        setError(err.response?.data?.error || 'Failed to load schedule')
        setLoaded(true)
      })
  }, [connection.id])

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...schedule,
        schedule_timezone: tzInput.trim() || null,
      }
      await apiClient.upsertDbSchedule(connection.id, payload)
      setSavedAt(new Date().toLocaleTimeString())
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return <div className="p-4 text-gray-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>

  const daily = Number(schedule.every_hours) === 24

  return (
    <div className="p-4 max-w-2xl space-y-4">
      <div className="rounded border border-blue-500/25 bg-blue-500/10 p-3 text-sm text-blue-100/90">
        <strong className="text-blue-200">Real scheduled backups:</strong> Ascend registers your job with{' '}
        <span className="font-mono text-xs">APScheduler</span> in this server process. Runs fire at the
        configured clock time while the app is running. After a full restart, jobs reload from the database
        on boot.
      </div>
      <label className="flex items-center gap-2 text-white text-sm">
        <input
          type="checkbox"
          checked={!!schedule.enabled}
          onChange={(e) => setSchedule((s) => ({ ...s, enabled: e.target.checked }))}
        />
        Enable scheduled backups
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-gray-300">
          Run every (hours)
          <input
            type="number" min={1} max={720}
            value={schedule.every_hours}
            onChange={(e) => setSchedule((s) => ({ ...s, every_hours: Number(e.target.value) }))}
            className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1 text-white"
          />
          <span className="text-xs text-gray-500 mt-1 block">Use 24 for once per day at the time below.</span>
        </label>
        <label className="text-sm text-gray-300">
          At hour (0–23){daily ? '' : ' (used when every 24 h)'}
          <input
            type="number" min={0} max={23}
            value={schedule.at_hour ?? 2}
            onChange={(e) => setSchedule((s) => ({ ...s, at_hour: Number(e.target.value) }))}
            className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1 text-white"
            disabled={!daily}
          />
          {!daily && (
            <span className="text-xs text-gray-500 mt-1 block">Hour + timezone apply when interval is 24 h (daily cron).</span>
          )}
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-gray-300">
          At minute (0–59)
          <input
            type="number" min={0} max={59}
            value={schedule.at_minute}
            onChange={(e) => setSchedule((s) => ({ ...s, at_minute: Number(e.target.value) }))}
            className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1 text-white"
          />
        </label>
        <label className="text-sm text-gray-300">
          Timezone (IANA)
          <input
            type="text"
            value={tzInput}
            onChange={(e) => setTzInput(e.target.value)}
            list="ascend-tz-list"
            placeholder={serverTimezone}
            className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1 text-white placeholder:text-gray-500"
          />
          <datalist id="ascend-tz-list">
            <option value="" label={`Server default (${serverTimezone})`} />
            {COMMON_TIMEZONES.map((z) => <option key={z} value={z} />)}
          </datalist>
          <span className="text-xs text-gray-500 mt-1 block">
            Leave blank for server default: <span className="text-gray-400 font-mono">{serverTimezone}</span>
          </span>
        </label>
      </div>
      <label className="block text-sm text-gray-300">
        Retention (days) — older backups are auto-deleted
        <input
          type="number" min={1} max={1825}
          value={schedule.retention_days}
          onChange={(e) => setSchedule((s) => ({ ...s, retention_days: Number(e.target.value) }))}
          className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1 text-white"
        />
      </label>
      <label className="block text-sm text-gray-300">
        Databases to back up (comma-separated; leave blank for ALL)
        <input
          type="text"
          value={(schedule.databases || []).join(', ')}
          onChange={(e) => setSchedule((s) => ({
            ...s,
            databases: e.target.value.split(',').map((x) => x.trim()).filter(Boolean),
          }))}
          className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1 text-white"
          placeholder="leave blank to back up every database"
        />
      </label>

      {schedule.last_run_at && (
        <div className="rounded border border-gray-700 bg-primary/40 p-3 text-xs text-gray-300">
          Last run: {formatTime(schedule.last_run_at)} — <strong>{schedule.last_run_status}</strong>
          {schedule.last_run_error && (
            <div className="text-red-400 mt-1 font-mono">{schedule.last_run_error}</div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{error}</div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-2 bg-accent hover:bg-accent/80 rounded text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save schedule
        </button>
        {savedAt && <span className="text-xs text-green-400">Saved at {savedAt}</span>}
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
