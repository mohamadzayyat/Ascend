import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  Download,
  Edit3,
  Eye,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileLock,
  FileText,
  FileVideo,
  Folder,
  FolderPlus,
  Home,
  MoreHorizontal,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Terminal,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

const TEXT_EXT = new Set([
  'txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'css', 'scss',
  'sass', 'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'env',
  'sh', 'bash', 'zsh', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp',
  'sql', 'php', 'vue', 'svelte', 'conf', 'log', 'gitignore', 'dockerfile',
  'prettierrc', 'eslintrc', 'babelrc', 'editorconfig', 'lock', 'csv', 'tsv',
  'patch', 'diff', 'rst',
])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'ogv', 'm4v'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'])
const ARCHIVE_EXT = new Set(['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz'])
const CODE_EXT = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java',
  'c', 'h', 'cpp', 'hpp', 'php', 'vue', 'svelte', 'sql', 'kt', 'swift',
])
const SHELL_EXT = new Set(['sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'fish'])
const STYLE_EXT = new Set(['css', 'scss', 'sass', 'less'])
const DATA_EXT = new Set(['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf'])

function fileKind(name) {
  if (!name) return 'other'
  const lower = name.toLowerCase()
  const ext = lower.includes('.') ? lower.split('.').pop() : ''
  if (IMAGE_EXT.has(ext)) return 'image'
  if (VIDEO_EXT.has(ext)) return 'video'
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (ext === 'pdf') return 'pdf'
  if (!ext || TEXT_EXT.has(ext)) return 'text'
  return 'other'
}

function isPreviewable(name) {
  return ['image', 'video', 'audio', 'pdf'].includes(fileKind(name))
}

function iconMeta(name) {
  const lower = name.toLowerCase()
  const ext = lower.includes('.') ? lower.split('.').pop() : ''
  if (IMAGE_EXT.has(ext)) return { Icon: FileImage, color: 'text-purple-400' }
  if (VIDEO_EXT.has(ext)) return { Icon: FileVideo, color: 'text-pink-400' }
  if (AUDIO_EXT.has(ext)) return { Icon: FileAudio, color: 'text-pink-300' }
  if (ARCHIVE_EXT.has(ext)) return { Icon: FileArchive, color: 'text-yellow-400' }
  if (CODE_EXT.has(ext)) return { Icon: FileCode, color: 'text-blue-400' }
  if (SHELL_EXT.has(ext)) return { Icon: Terminal, color: 'text-green-400' }
  if (STYLE_EXT.has(ext)) return { Icon: Palette, color: 'text-cyan-400' }
  if (DATA_EXT.has(ext)) return { Icon: FileJson, color: 'text-orange-400' }
  if (lower === '.env' || lower.startsWith('.env.')) return { Icon: FileLock, color: 'text-emerald-400' }
  if (ext === 'pdf') return { Icon: FileText, color: 'text-red-400' }
  if (['md', 'markdown'].includes(ext)) return { Icon: FileText, color: 'text-gray-300' }
  if (['txt', 'log', 'rst', 'csv', 'tsv'].includes(ext)) return { Icon: FileText, color: 'text-gray-400' }
  if (['dockerfile', 'makefile'].includes(lower) || lower === 'readme' || lower === 'license') {
    return { Icon: FileText, color: 'text-gray-300' }
  }
  return { Icon: FileIcon, color: 'text-gray-400' }
}

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function joinPath(base, name) {
  if (!base) return name
  return `${base}/${name}`
}

function parentPath(p) {
  if (!p) return ''
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

export default function AppFileManager({ api }) {
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState([])
  const [basePath, setBasePath] = useState('')
  const [exists, setExists] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [menu, setMenu] = useState(null) // { x, y, entry }
  const [editor, setEditor] = useState(null) // { path, content, original, saving, error, size }
  const [preview, setPreview] = useState(null) // { path, kind, url, loading, error }
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [status, setStatus] = useState('')
  const uploadRef = useRef(null)
  const zipRef = useRef(null)

  const load = useCallback(async () => {
    if (!api) return
    setLoading(true)
    setError('')
    try {
      const res = await api.list(path, showHidden)
      setEntries(res.data.entries || [])
      setBasePath(res.data.base_path || '')
      setExists(res.data.exists !== false)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to list files')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [api, path, showHidden])

  useEffect(() => { load() }, [load])

  // close right-click menu on any outside interaction
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  const flash = (msg) => {
    setStatus(msg)
    setTimeout(() => setStatus((s) => (s === msg ? '' : s)), 2500)
  }

  const breadcrumbs = useMemo(() => {
    if (!path) return []
    const parts = path.split('/').filter(Boolean)
    const crumbs = []
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      crumbs.push({ name: part, path: acc })
    }
    return crumbs
  }, [path])

  const openEntry = (entry) => {
    if (entry.is_dir) {
      setPath(entry.path)
      return
    }
    const kind = fileKind(entry.name)
    if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') {
      openPreview(entry.path, kind)
      return
    }
    if (kind === 'text') {
      openEditor(entry.path)
      return
    }
    flash('Binary file — use Download from right-click.')
  }

  const openPreview = async (relPath, kind) => {
    setPreview({ path: relPath, kind, url: null, loading: true, error: '' })
    try {
      const res = await api.fetchBlob(relPath)
      const url = URL.createObjectURL(res.data)
      setPreview((p) => (p && p.path === relPath ? { ...p, url, loading: false } : p))
    } catch (err) {
      setPreview((p) =>
        p && p.path === relPath
          ? { ...p, loading: false, error: err.response?.data?.error || 'Failed to load preview' }
          : p,
      )
    }
  }

  const closePreview = () => {
    setPreview((p) => {
      if (p?.url) URL.revokeObjectURL(p.url)
      return null
    })
  }

  const openEditor = async (relPath) => {
    setEditor({ path: relPath, content: '', original: '', loading: true, saving: false, error: '', size: 0 })
    try {
      const res = await api.read(relPath)
      setEditor({
        path: relPath,
        content: res.data.content,
        original: res.data.content,
        size: res.data.size,
        loading: false,
        saving: false,
        error: '',
      })
    } catch (err) {
      setEditor((e) => e && { ...e, loading: false, error: err.response?.data?.error || 'Failed to read file' })
    }
  }

  const saveEditor = async () => {
    if (!editor) return
    setEditor((e) => ({ ...e, saving: true, error: '' }))
    try {
      await api.write(editor.path, editor.content)
      setEditor(null)
      flash('Saved')
      load()
    } catch (err) {
      setEditor((e) => ({ ...e, saving: false, error: err.response?.data?.error || 'Failed to save' }))
    }
  }

  const uploadFiles = async (fileList, { unzip = false } = {}) => {
    const files = Array.from(fileList || []).filter(Boolean)
    if (!files.length) return
    setUploading(true)
    setError('')
    try {
      await api.upload(path, files, { unzip })
      flash(unzip ? `Uploaded & unzipped ${files.length} file(s)` : `Uploaded ${files.length} file(s)`)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const onPickUpload = (e) => {
    uploadFiles(e.target.files, { unzip: false })
    e.target.value = ''
  }
  const onPickZip = (e) => {
    uploadFiles(e.target.files, { unzip: true })
    e.target.value = ''
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files)
  }

  const newFolder = async () => {
    const name = window.prompt('New folder name')
    if (!name) return
    try {
      await api.mkdir(joinPath(path, name))
      flash(`Created ${name}/`)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create folder')
    }
  }

  const renameEntry = async (entry) => {
    const current = entry.name
    const next = window.prompt(`Rename "${current}" to:`, current)
    if (!next || next === current) return
    const parent = parentPath(entry.path)
    const target = joinPath(parent, next)
    try {
      await api.rename(entry.path, target)
      flash(`Renamed to ${next}`)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Rename failed')
    }
  }

  const deleteEntry = async (entry) => {
    const label = entry.is_dir ? `folder "${entry.name}" and everything in it` : `"${entry.name}"`
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return
    try {
      await api.delete(entry.path)
      flash(`Deleted ${entry.name}`)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed')
    }
  }

  const downloadEntry = (entry) => {
    if (entry.is_dir) {
      flash('Folder download not supported.')
      return
    }
    const url = api.downloadUrl(entry.path)
    window.open(url, '_blank')
  }

  const onContextMenu = (e, entry) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, entry })
  }

  return (
    <div className="bg-secondary rounded-lg border border-gray-700 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="text-xl font-bold text-white">Files</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-gray-400 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              className="accent-accent"
            />
            Show node_modules / .git
          </label>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={newFolder}
            className="inline-flex items-center gap-1 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm"
          >
            <FolderPlus className="w-4 h-4" /> New folder
          </button>
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm disabled:opacity-50"
          >
            <Upload className="w-4 h-4" /> Upload
          </button>
          <button
            type="button"
            onClick={() => zipRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm disabled:opacity-50"
            title="Upload a .zip and extract it here"
          >
            <Plus className="w-4 h-4" /> Upload &amp; unzip
          </button>
          <input ref={uploadRef} type="file" multiple className="hidden" onChange={onPickUpload} />
          <input ref={zipRef} type="file" accept=".zip,application/zip" className="hidden" onChange={onPickZip} />
        </div>
      </div>

      <div className="flex items-center gap-1 text-sm mb-4 flex-wrap bg-primary/50 rounded px-2 py-2">
        <button
          type="button"
          onClick={() => setPath('')}
          title={basePath}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer hover:bg-gray-700 hover:underline transition ${path ? 'text-gray-200' : 'text-accent font-semibold'}`}
        >
          <Home className="w-3.5 h-3.5" /> root
        </button>
        {breadcrumbs.map((c, i) => {
          const isLast = i === breadcrumbs.length - 1
          return (
            <span key={c.path} className="inline-flex items-center gap-1">
              <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
              <button
                type="button"
                onClick={() => setPath(c.path)}
                className={`px-2 py-1 rounded cursor-pointer hover:bg-gray-700 hover:underline transition ${isLast ? 'text-accent font-semibold' : 'text-gray-200'}`}
              >
                {c.name}
              </button>
            </span>
          )
        })}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-3 mb-3 text-red-300 text-sm">{error}</div>
      )}
      {status && (
        <div className="bg-green-500/10 border border-green-500/30 rounded p-3 mb-3 text-green-300 text-sm">{status}</div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded border ${dragOver ? 'border-accent bg-accent/5' : 'border-gray-700'} overflow-hidden`}
      >
        {!exists ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            The app's deploy directory does not exist yet. Deploy the app first, then files will appear here.
          </div>
        ) : loading && entries.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            Empty folder. Drop files here to upload.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-primary/50 text-gray-400 text-xs uppercase">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Name</th>
                <th className="text-right font-semibold px-3 py-2 w-28">Size</th>
                <th className="text-right font-semibold px-3 py-2 w-48">Modified</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {path && (
                <tr
                  className="hover:bg-primary/40 cursor-pointer border-t border-gray-800"
                  onClick={() => setPath(parentPath(path))}
                >
                  <td className="px-3 py-2 text-gray-300" colSpan={4}>
                    <span className="inline-flex items-center gap-2">
                      <Folder className="w-4 h-4 text-gray-500" /> ..
                    </span>
                  </td>
                </tr>
              )}
              {entries.map((entry) => {
                const { Icon, color } = entry.is_dir
                  ? { Icon: Folder, color: 'text-accent' }
                  : iconMeta(entry.name)
                return (
                <tr
                  key={entry.path}
                  onClick={() => openEntry(entry)}
                  onContextMenu={(e) => onContextMenu(e, entry)}
                  className="hover:bg-primary/40 cursor-pointer border-t border-gray-800"
                >
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2 text-gray-200">
                      <Icon className={`w-4 h-4 ${color}`} />
                      {entry.name}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-400 font-mono text-xs">{formatSize(entry.size)}</td>
                  <td className="px-3 py-2 text-right text-gray-500 text-xs">{formatTime(entry.mtime)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onContextMenu(e, entry) }}
                      className="p-1 hover:bg-gray-700 rounded text-gray-400"
                      title="Actions"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {menu && (
        <div
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-50 bg-secondary border border-gray-700 rounded shadow-lg py-1 min-w-[160px]"
          onClick={(e) => e.stopPropagation()}
        >
          {!menu.entry.is_dir && (
            <>
              {isPreviewable(menu.entry.name) && (
                <MenuItem
                  icon={<Eye className="w-4 h-4" />}
                  onClick={() => {
                    const e = menu.entry
                    setMenu(null)
                    openPreview(e.path, fileKind(e.name))
                  }}
                >
                  Preview
                </MenuItem>
              )}
              <MenuItem
                icon={<Edit3 className="w-4 h-4" />}
                onClick={() => { setMenu(null); openEditor(menu.entry.path) }}
                disabled={fileKind(menu.entry.name) !== 'text'}
              >
                Edit
              </MenuItem>
              <MenuItem
                icon={<Download className="w-4 h-4" />}
                onClick={() => { setMenu(null); downloadEntry(menu.entry) }}
              >
                Download
              </MenuItem>
            </>
          )}
          <MenuItem
            icon={<Edit3 className="w-4 h-4" />}
            onClick={() => { const e = menu.entry; setMenu(null); renameEntry(e) }}
          >
            Rename
          </MenuItem>
          <MenuItem
            icon={<Trash2 className="w-4 h-4" />}
            onClick={() => { const e = menu.entry; setMenu(null); deleteEntry(e) }}
            danger
          >
            Delete
          </MenuItem>
        </div>
      )}

      {editor && (
        <EditorModal
          editor={editor}
          onChange={(content) => setEditor((e) => ({ ...e, content }))}
          onSave={saveEditor}
          onClose={() => setEditor(null)}
        />
      )}

      {preview && (
        <PreviewModal
          preview={preview}
          onClose={closePreview}
          onDownload={() => downloadEntry({ path: preview.path, name: preview.path.split('/').pop(), is_dir: false })}
        />
      )}
    </div>
  )
}

function PreviewModal({ preview, onClose, onDownload }) {
  const fileName = preview.path.split('/').pop()
  return (
    <div
      className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        className="bg-secondary border border-gray-700 rounded-lg w-full max-w-5xl max-h-[90vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700 p-3 gap-3">
          <p className="font-mono text-sm text-gray-300 truncate">{preview.path}</p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary hover:bg-gray-700 rounded text-white text-sm"
            >
              <Download className="w-4 h-4" /> Download
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 hover:bg-gray-700 rounded text-gray-400"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto flex items-center justify-center bg-primary/40 p-4 min-h-[40vh]">
          {preview.loading ? (
            <div className="text-gray-400 text-sm">Loading preview…</div>
          ) : preview.error ? (
            <div className="text-red-400 text-sm">{preview.error}</div>
          ) : preview.kind === 'image' ? (
            <img
              src={preview.url}
              alt={fileName}
              className="max-w-full max-h-[75vh] object-contain"
            />
          ) : preview.kind === 'video' ? (
            <video
              src={preview.url}
              controls
              className="max-w-full max-h-[75vh]"
            />
          ) : preview.kind === 'audio' ? (
            <audio src={preview.url} controls className="w-full max-w-xl" />
          ) : preview.kind === 'pdf' ? (
            <iframe
              src={preview.url}
              title={fileName}
              className="w-full h-[75vh] bg-white rounded"
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function MenuItem({ icon, children, onClick, disabled, danger }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-primary disabled:opacity-40 disabled:cursor-not-allowed ${
        danger ? 'text-red-400 hover:text-red-300' : 'text-gray-200'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function EditorModal({ editor, onChange, onSave, onClose }) {
  const dirty = editor.content !== editor.original
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      onSave()
    }
  }
  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="bg-secondary border border-gray-700 rounded-lg w-full max-w-4xl h-[80vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700 p-3">
          <p className="font-mono text-sm text-gray-300 truncate">
            {editor.path}{dirty ? ' •' : ''}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || editor.saving || editor.loading}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-blue-600 rounded text-white text-sm disabled:opacity-50"
            >
              <Save className="w-4 h-4" /> {editor.saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 hover:bg-gray-700 rounded text-gray-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {editor.error && (
          <div className="bg-red-500/10 border-b border-red-500/30 px-3 py-2 text-red-300 text-sm">{editor.error}</div>
        )}
        <div className="flex-1 overflow-hidden">
          {editor.loading ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">Loading…</div>
          ) : (
            <textarea
              value={editor.content}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
              className="w-full h-full bg-primary text-gray-100 font-mono text-sm p-4 resize-none outline-none border-0"
            />
          )}
        </div>
      </div>
    </div>
  )
}
