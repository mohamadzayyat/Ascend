import { useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import {
  Database, Plus, Trash2, Play, Download, RefreshCw, Loader2,
  CheckCircle2, XCircle, AlertTriangle, Save, Calendar, Table as TableIcon,
} from 'lucide-react'
import { apiClient } from '@/lib/api'

const TABS = [
  { id: 'browse',   label: 'Browse',   icon: TableIcon },
  { id: 'sql',      label: 'SQL',      icon: Play },
  { id: 'backups',  label: 'Backups',  icon: Download },
  { id: 'schedule', label: 'Schedule', icon: Calendar },
]

export default function DatabasesPage() {
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
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
      if (activeId === id) setActiveId(next[0]?.id || null)
      return next
    })
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
            <ConnectionList
              connections={connections}
              activeId={activeId}
              onSelect={setActiveId}
              onDeleted={onConnectionDeleted}
              onRefresh={refresh}
            />
            {active && <ConnectionPanel connection={active} />}
          </div>
        )}
      </div>
    </>
  )
}

// ── Sidebar list ─────────────────────────────────────────────────

function ConnectionList({ connections, activeId, onSelect, onDeleted, onRefresh }) {
  const [busyId, setBusyId] = useState(null)
  const [testResults, setTestResults] = useState({})

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
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="w-72 shrink-0 rounded border border-gray-700 bg-secondary overflow-y-auto">
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-gray-400">Connections</span>
        <button onClick={onRefresh} className="text-gray-400 hover:text-white" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      <ul>
        {connections.map((c) => {
          const isActive = c.id === activeId
          const test = testResults[c.id]
          return (
            <li
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`px-3 py-3 cursor-pointer border-b border-gray-700 ${
                isActive ? 'bg-primary' : 'hover:bg-primary/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-white text-sm font-semibold truncate">{c.name}</div>
                  <div className="text-gray-400 text-xs truncate">
                    {c.username}@{c.host}:{c.port}
                  </div>
                </div>
                {test?.ok && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                {test?.ok === false && <XCircle className="w-4 h-4 text-red-400" />}
              </div>
              {test?.ok && (
                <div className="text-green-400/80 text-xs mt-1">{test.server_version}</div>
              )}
              {test?.ok === false && (
                <div className="text-red-400/80 text-xs mt-1 truncate" title={test.error}>{test.error}</div>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onTest(c) }}
                  disabled={busyId === c.id}
                  className="text-xs text-accent hover:underline disabled:opacity-50"
                >
                  Test
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(c) }}
                  disabled={busyId === c.id}
                  className="text-xs text-red-400 hover:underline disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── Right-side panel with tabs ───────────────────────────────────

function ConnectionPanel({ connection }) {
  const [tab, setTab] = useState('browse')
  return (
    <div className="flex-1 min-w-0 rounded border border-gray-700 bg-secondary flex flex-col">
      <div className="border-b border-gray-700 flex items-center gap-1 px-2">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm flex items-center gap-2 border-b-2 ${
                active
                  ? 'border-accent text-white'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          )
        })}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'browse' && <BrowseTab connection={connection} />}
        {tab === 'sql' && <SqlTab connection={connection} />}
        {tab === 'backups' && <BackupsTab connection={connection} />}
        {tab === 'schedule' && <ScheduleTab connection={connection} />}
      </div>
    </div>
  )
}

// ── Browse: pick a DB → pick a table → paginated rows ───────────

function BrowseTab({ connection }) {
  const [databases, setDatabases] = useState([])
  const [database, setDatabase] = useState('')
  const [tables, setTables] = useState([])
  const [table, setTable] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiClient.listDatabases(connection.id)
      .then((res) => {
        if (cancelled) return
        const all = [...(res.data.databases || []), ...(res.data.system_databases || [])]
        setDatabases(all)
        const def = connection.default_database && all.includes(connection.default_database)
          ? connection.default_database
          : (res.data.databases?.[0] || '')
        setDatabase(def)
        setError('')
      })
      .catch((err) => !cancelled && setError(err.response?.data?.error || 'Failed to load databases'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [connection.id, connection.default_database])

  useEffect(() => {
    if (!database) { setTables([]); setTable(''); return }
    let cancelled = false
    apiClient.listTables(connection.id, database)
      .then((res) => {
        if (cancelled) return
        setTables(res.data.tables || [])
        setTable(res.data.tables?.[0]?.name || '')
      })
      .catch((err) => !cancelled && setError(err.response?.data?.error || 'Failed to load tables'))
    return () => { cancelled = true }
  }, [connection.id, database])

  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-400">Database</label>
        <select
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
          className="bg-primary border border-gray-700 text-white text-sm px-2 py-1 rounded"
        >
          {databases.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <label className="text-sm text-gray-400 ml-4">Table</label>
        <select
          value={table}
          onChange={(e) => setTable(e.target.value)}
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

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {database && table && (
        <TableViewer connectionId={connection.id} database={database} table={table} />
      )}
    </div>
  )
}

function TableViewer({ connectionId, database, table }) {
  const [data, setData] = useState(null)
  const [page, setPage] = useState(1)
  const [perPage] = useState(50)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setPage(1) }, [database, table])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiClient.getTableRows(connectionId, database, table, page, perPage)
      .then((res) => !cancelled && setData(res.data))
      .catch((err) => !cancelled && setError(err.response?.data?.error || 'Failed to load rows'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [connectionId, database, table, page, perPage])

  if (error) {
    return <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{error}</div>
  }
  if (!data) {
    return <div className="text-gray-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.per_page))

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
        <span>{data.total.toLocaleString()} rows total · page {data.page} of {totalPages}</span>
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

function SqlTab({ connection }) {
  const [databases, setDatabases] = useState([])
  const [database, setDatabase] = useState('')
  const [sql, setSql] = useState('SHOW DATABASES;')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState(null) // { reason }
  const [running, setRunning] = useState(false)

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
    enabled: true, every_hours: 24, at_minute: 0, retention_days: 14, databases: [],
  })
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    apiClient.getDbSchedule(connection.id)
      .then((res) => {
        if (res.data.schedule) setSchedule(res.data.schedule)
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
      await apiClient.upsertDbSchedule(connection.id, schedule)
      setSavedAt(new Date().toLocaleTimeString())
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return <div className="p-4 text-gray-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>

  return (
    <div className="p-4 max-w-xl space-y-4">
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
        </label>
        <label className="text-sm text-gray-300">
          At minute past the hour (0–59)
          <input
            type="number" min={0} max={59}
            value={schedule.at_minute}
            onChange={(e) => setSchedule((s) => ({ ...s, at_minute: Number(e.target.value) }))}
            className="mt-1 w-full bg-primary border border-gray-700 rounded px-2 py-1 text-white"
          />
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
