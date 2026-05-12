import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ClipboardPaste,
  ChevronRight,
  Clock,
  Copy,
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
  FilePlus,
  FileText,
  FileVideo,
  Folder,
  FolderPlus,
  Home,
  Link2,
  MoreHorizontal,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Scissors,
  Search,
  Terminal,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useDialog } from '@/lib/dialog'

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

function isZipFile(name) {
  return (name || '').toLowerCase().endsWith('.zip')
}

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
  if (bytes === null || bytes === undefined) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatTime(iso) {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your PC time'
  } catch {
    return 'your PC time'
  }
}

function formatPcTime(iso) {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
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

function baseName(p) {
  if (!p) return ''
  const parts = p.split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

function scopeFromKey(scopeKey) {
  if (scopeKey && scopeKey.includes(':')) {
    const [scopeType, scopeIdStr] = scopeKey.split(':')
    return { scopeType, scopeId: scopeIdStr ? parseInt(scopeIdStr, 10) : null }
  }
  return { scopeType: 'server', scopeId: null }
}

function contextMenuPosition(x, y, entry) {
  if (typeof window === 'undefined') return { x, y }
  const margin = 8
  const menuWidth = 190
  const itemHeight = 37
  const itemCount = entry?.is_dir
    ? 9
    : 8 + (isPreviewable(entry?.name || '') ? 1 : 0) + (isZipFile(entry?.name) ? 1 : 0)
  const menuHeight = itemCount * itemHeight + 8
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - menuWidth - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - menuHeight - margin)),
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function editorLanguage(path) {
  const lower = (path || '').toLowerCase()
  const ext = lower.includes('.') ? lower.split('.').pop() : ''
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return 'js'
  if (['json'].includes(ext)) return 'json'
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return 'css'
  if (['html', 'htm', 'xml'].includes(ext)) return 'markup'
  if (['md', 'markdown'].includes(ext)) return 'md'
  if (['py'].includes(ext)) return 'py'
  if (['sh', 'bash', 'zsh', 'env'].includes(ext) || lower.endsWith('/.env') || baseName(lower) === '.env') return 'sh'
  return 'plain'
}

function highlightText(text, path) {
  const lang = editorLanguage(path)
  let html = escapeHtml(text)

  if (lang === 'js') {
    html = html
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, '<span class="fm-str">$1</span>')
      .replace(/\b(const|let|var|function|return|async|await|import|from|export|default|if|else|for|while|switch|case|break|continue|try|catch|throw|class|new|extends|typeof)\b/g, '<span class="fm-key">$1</span>')
      .replace(/\b(true|false|null|undefined)\b/g, '<span class="fm-lit">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="fm-num">$1</span>')
      .replace(/(\/\/.*?$)/gm, '<span class="fm-com">$1</span>')
    return html
  }
  if (lang === 'json') {
    html = html
      .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, '<span class="fm-prop">$1</span>$2')
      .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span class="fm-str">$1</span>')
      .replace(/\b(true|false|null)\b/g, '<span class="fm-lit">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="fm-num">$1</span>')
    return html
  }
  if (lang === 'css') {
    html = html
      .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="fm-com">$1</span>')
      .replace(/([.#]?[a-zA-Z_-][\w-]*)(\s*\{)/g, '<span class="fm-prop">$1</span>$2')
      .replace(/\b(color|background|display|position|padding|margin|border|font|width|height|grid|flex)\b/g, '<span class="fm-key">$1</span>')
      .replace(/(:\s*)([^;}{]+)/g, '$1<span class="fm-str">$2</span>')
    return html
  }
  if (lang === 'markup') {
    html = html
      .replace(/(&lt;\/?)([a-zA-Z0-9:-]+)/g, '$1<span class="fm-key">$2</span>')
      .replace(/([a-zA-Z-:]+)=(&quot;.*?&quot;)/g, '<span class="fm-prop">$1</span>=<span class="fm-str">$2</span>')
    return html
  }
  if (lang === 'md') {
    html = html
      .replace(/^(#{1,6}\s.*)$/gm, '<span class="fm-key">$1</span>')
      .replace(/(`[^`]+`)/g, '<span class="fm-str">$1</span>')
      .replace(/(\*\*[^*]+\*\*|__[^_]+__)/g, '<span class="fm-lit">$1</span>')
      .replace(/(\[[^\]]+\]\([^)]+\))/g, '<span class="fm-prop">$1</span>')
    return html
  }
  if (lang === 'py' || lang === 'sh') {
    html = html
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="fm-str">$1</span>')
      .replace(/\b(def|class|return|if|elif|else|for|while|try|except|import|from|as|pass|break|continue|lambda|echo|export|fi|then|do|done)\b/g, '<span class="fm-key">$1</span>')
      .replace(/\b(true|false|none|null)\b/gi, '<span class="fm-lit">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="fm-num">$1</span>')
      .replace(/(#.*?$)/gm, '<span class="fm-com">$1</span>')
    return html
  }

  return html
}

function makeEditorTab(path) {
  return {
    path,
    content: '',
    original: '',
    loading: true,
    saving: false,
    error: '',
    size: 0,
  }
}

export default function AppFileManager({
  api,
  scopeKey = 'default',
  title = 'Files',
  description = 'Browse, edit, upload, search, archive, and move files inside this deployment directory.',
  rootLabel = 'root',
  hiddenLabel = 'Show node_modules / .git',
  missingText = "The app's deploy directory does not exist yet. Deploy the app first, then files will appear here.",
}) {
  const pathStorageKey = `ascend:file-manager:path:${scopeKey}`
  const [path, setPath] = useState(() => {
    if (typeof window === 'undefined') return ''
    try {
      return window.localStorage.getItem(pathStorageKey) || ''
    } catch {
      return ''
    }
  })
  const [entries, setEntries] = useState([])
  const [basePath, setBasePath] = useState('')
  const [exists, setExists] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchContents, setSearchContents] = useState(true)
  const [searchLimited, setSearchLimited] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [clipboard, setClipboard] = useState(null) // { mode, path, name, is_dir }
  const [dragItem, setDragItem] = useState(null)
  const [dropTarget, setDropTarget] = useState('')
  const [menu, setMenu] = useState(null)
  const [editorTabs, setEditorTabs] = useState([])
  const [activeEditorPath, setActiveEditorPath] = useState(null)
  const [editorMinimized, setEditorMinimized] = useState(false)
  const [preview, setPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [urlDownloading, setUrlDownloading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null) // { percent, loaded, total, count }
  const [dragOver, setDragOver] = useState(false)
  const [status, setStatus] = useState('')
  const [shareLink, setShareLink] = useState(null)
  const [backupSchedulesOpen, setBackupSchedulesOpen] = useState(false)
  const [backupSchedules, setBackupSchedules] = useState([])
  const [backupServerTimezone, setBackupServerTimezone] = useState('UTC')
  const [backupSchedulesLoading, setBackupSchedulesLoading] = useState(false)
  const [backupSchedulesError, setBackupSchedulesError] = useState('')
  const [editingScheduleId, setEditingScheduleId] = useState(null)
  const [scheduleDrafts, setScheduleDrafts] = useState({})
  const [scheduleBusyId, setScheduleBusyId] = useState(null)
  const uploadRef = useRef(null)
  const zipRef = useRef(null)
  const editorStorageKey = `ascend:file-editor:${scopeKey}`
  const dialog = useDialog()
  const currentScope = useMemo(() => scopeFromKey(scopeKey), [scopeKey])
  const pcTimezone = useMemo(() => browserTimezone(), [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(pathStorageKey, path)
    } catch {
      // Ignore storage failures.
    }
  }, [pathStorageKey, path])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(editorStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed.editorTabs)) setEditorTabs(parsed.editorTabs)
      if (parsed.activeEditorPath) setActiveEditorPath(parsed.activeEditorPath)
      if (typeof parsed.editorMinimized === 'boolean') setEditorMinimized(parsed.editorMinimized)
    } catch {
      // Ignore bad persisted state and start fresh.
    }
  }, [editorStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(editorStorageKey, JSON.stringify({
        editorTabs,
        activeEditorPath,
        editorMinimized,
      }))
    } catch {
      // Ignore storage failures.
    }
  }, [editorStorageKey, editorTabs, activeEditorPath, editorMinimized])

  const load = useCallback(async () => {
    if (!api) return
    setLoading(true)
    setError('')
    try {
      const res = await api.list(path, showHidden, search, searchContents)
      setEntries(res.data.entries || [])
      setBasePath(res.data.base_path || '')
      setExists(res.data.exists !== false)
      setSearchLimited(!!res.data.search_limited)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to list files')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [api, path, showHidden, search, searchContents])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 200)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    setSelected(new Set())
  }, [path, search, showHidden, searchContents])

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

  const loadBackupSchedules = useCallback(async () => {
    if (!api?.listBackupSchedules) return
    setBackupSchedulesLoading(true)
    setBackupSchedulesError('')
    try {
      const res = await api.listBackupSchedules()
      const rows = Array.isArray(res.data) ? res.data : (res.data?.schedules || [])
      if (!Array.isArray(res.data) && res.data?.server_timezone) setBackupServerTimezone(res.data.server_timezone)
      setBackupSchedules(rows)
    } catch (err) {
      setBackupSchedulesError(err.response?.data?.error || 'Failed to load backup schedules')
    } finally {
      setBackupSchedulesLoading(false)
    }
  }, [api])

  useEffect(() => { loadBackupSchedules() }, [loadBackupSchedules])

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

  const visibleSelectableEntries = useMemo(() => entries.filter((entry) => entry.path), [entries])
  const selectedEntries = useMemo(
    () => visibleSelectableEntries.filter((entry) => selected.has(entry.path)),
    [visibleSelectableEntries, selected]
  )
  const scopedBackupSchedules = useMemo(
    () => backupSchedules.filter((row) => {
      const rowScopeId = row.scope_id === null || row.scope_id === undefined ? null : Number(row.scope_id)
      return row.scope_type === currentScope.scopeType && rowScopeId === currentScope.scopeId
    }),
    [backupSchedules, currentScope]
  )
  const allSelected = visibleSelectableEntries.length > 0 && selectedEntries.length === visibleSelectableEntries.length
  const activeEditor = useMemo(
    () => editorTabs.find((tab) => tab.path === activeEditorPath) || null,
    [editorTabs, activeEditorPath]
  )

  const updateEditorTab = useCallback((tabPath, updater) => {
    setEditorTabs((tabs) => tabs.map((tab) => (tab.path === tabPath ? updater(tab) : tab)))
  }, [])

  const openEntry = (entry) => {
    if (entry.is_dir) {
      setPath(entry.path)
      return
    }
    const kind = fileKind(entry.name)
    if (['image', 'video', 'audio', 'pdf'].includes(kind)) {
      openPreview(entry.path, kind)
      return
    }
    if (kind === 'text') {
      openEditor(entry.path)
      return
    }
    flash('Binary file - use Download from the menu.')
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
          : p
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
    setActiveEditorPath(relPath)
    setEditorMinimized(false)
    setEditorTabs((tabs) => (tabs.some((tab) => tab.path === relPath) ? tabs : [...tabs, makeEditorTab(relPath)]))
    try {
      const res = await api.read(relPath)
      updateEditorTab(relPath, () => ({
        path: relPath,
        content: res.data.content,
        original: res.data.content,
        size: res.data.size,
        loading: false,
        saving: false,
        error: '',
      }))
    } catch (err) {
      updateEditorTab(relPath, (tab) => ({
        ...tab,
        loading: false,
        error: err.response?.data?.error || 'Failed to read file',
      }))
    }
  }

  const closeEditorTab = (tabPath) => {
    setEditorTabs((tabs) => {
      const next = tabs.filter((tab) => tab.path !== tabPath)
      if (activeEditorPath === tabPath) {
        const idx = tabs.findIndex((tab) => tab.path === tabPath)
        const nextActive = next[idx] || next[idx - 1] || next[0] || null
        setActiveEditorPath(nextActive?.path || null)
      }
      if (next.length === 0) setEditorMinimized(false)
      return next
    })
  }

  const saveEditorTab = async (tabPath = activeEditorPath) => {
    if (!tabPath) return
    const tab = editorTabs.find((item) => item.path === tabPath)
    if (!tab) return
    updateEditorTab(tabPath, (current) => ({ ...current, saving: true, error: '' }))
    try {
      await api.write(tab.path, tab.content)
      updateEditorTab(tabPath, (current) => ({
        ...current,
        original: current.content,
        saving: false,
        error: '',
      }))
      flash(`Saved ${baseName(tab.path)}`)
      load()
    } catch (err) {
      updateEditorTab(tabPath, (current) => ({
        ...current,
        saving: false,
        error: err.response?.data?.error || 'Failed to save',
      }))
    }
  }

  const uploadFiles = async (fileList, { unzip = false } = {}) => {
    const files = Array.from(fileList || []).filter(Boolean)
    if (!files.length) return
    const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0)
    setUploading(true)
    setUploadProgress({ percent: 0, loaded: 0, total: totalBytes, count: files.length })
    setError('')
    try {
      await api.upload(path, files, {
        unzip,
        onProgress: ({ loaded, total, percent }) => {
          setUploadProgress({
            percent,
            loaded,
            total: total || totalBytes,
            count: files.length,
          })
        },
      })
      flash(unzip ? `Uploaded & unzipped ${files.length} file(s)` : `Uploaded ${files.length} file(s)`)
      load()
    } catch (err) {
      const apiMsg = err.response?.data?.error
      const status = err.response?.status
      let msg = apiMsg || err.message || 'Upload failed'
      if (!apiMsg && status === 413) msg = 'File too large for the server upload limit.'
      else if (!apiMsg && status) msg = `Upload failed (HTTP ${status})`
      setError(msg)
    } finally {
      setUploading(false)
      setUploadProgress(null)
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

  const onDropUpload = (e) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files)
  }

  const downloadFromUrl = async () => {
    const url = await dialog.prompt({
      title: 'Download from URL',
      message: 'Download a public file URL into the current folder.',
      label: 'File URL',
      placeholder: 'https://example.com/file.zip',
      confirmLabel: 'Continue',
      required: true,
    })
    if (!url || !url.trim()) return
    const filename = await dialog.prompt({
      title: 'Save as',
      message: 'Optional filename. Leave blank to use the URL filename.',
      label: 'Filename',
      placeholder: 'file.zip',
      defaultValue: '',
      confirmLabel: 'Download',
    })
    if (filename === null) return
    setUrlDownloading(true)
    setError('')
    try {
      const res = await api.downloadFromUrl(path, url.trim(), (filename || '').trim())
      flash(`Downloaded ${res.data.name || 'file'}`)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'URL download failed')
    } finally {
      setUrlDownloading(false)
    }
  }

  const newFolder = async () => {
    const name = await dialog.prompt({ title: 'New folder', label: 'Folder name', confirmLabel: 'Create folder', required: true })
    if (!name) return
    try {
      await api.mkdir(joinPath(path, name))
      flash(`Created ${name}/`)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create folder')
    }
  }

  const newFile = async () => {
    const name = await dialog.prompt({ title: 'New file', label: 'File name', confirmLabel: 'Create file', required: true })
    if (!name) return
    const target = joinPath(path, name)
    try {
      await api.write(target, '')
      flash(`Created ${name}`)
      load()
      openEditor(target)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create file')
    }
  }

  const renameEntry = async (entry) => {
    const next = await dialog.prompt({ title: 'Rename item', message: `Rename "${entry.name}" to:`, label: 'New name', defaultValue: entry.name, confirmLabel: 'Rename', required: true })
    if (!next || next === entry.name) return
    const target = joinPath(parentPath(entry.path), next)
    setError('')
    try {
      await api.rename(entry.path, target)
      flash(`Renamed to ${next}`)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Rename failed')
    }
  }

  const moveEntry = async (entry) => {
    const next = await dialog.prompt({ title: 'Move item', message: `Move "${entry.name}" to path:`, label: 'Destination path', defaultValue: joinPath(path, entry.name), confirmLabel: 'Move', required: true })
    if (!next || next === entry.path) return
    try {
      await api.rename(entry.path, next)
      flash(`Moved to ${next}`)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Move failed')
    }
  }

  const copyEntry = (entry) => {
    setClipboard({ mode: 'copy', path: entry.path, name: entry.name, is_dir: entry.is_dir })
    flash(`Copied ${entry.name}`)
  }

  const cutEntry = (entry) => {
    setClipboard({ mode: 'cut', path: entry.path, name: entry.name, is_dir: entry.is_dir })
    flash(`Cut ${entry.name}`)
  }

  const pasteClipboardTo = async (targetPath = path) => {
    if (!clipboard) return
    const destination = joinPath(targetPath, clipboard.name)
    if (destination === clipboard.path) {
      setError('Already in this folder')
      return
    }
    try {
      if (clipboard.mode === 'cut') {
        await api.rename(clipboard.path, destination)
        setClipboard(null)
        flash(`Moved ${clipboard.name}`)
      } else {
        await api.copy(clipboard.path, destination)
        flash(`Pasted ${clipboard.name}`)
      }
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Paste failed')
    }
  }

  const deleteEntry = async (entry) => {
    const label = entry.is_dir ? `folder "${entry.name}" and everything in it` : `"${entry.name}"`
    const ok = await dialog.confirm({ title: 'Delete item?', message: `Delete ${label}? This cannot be undone.`, confirmLabel: 'Delete', tone: 'danger' })
    if (!ok) return
    try {
      await api.delete(entry.path)
      flash(`Deleted ${entry.name}`)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed')
    }
  }

  const saveBlob = (blob, name) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const downloadEntry = async (entry) => {
    if (entry.is_dir) {
      try {
        const res = await api.archiveDownload([entry.path], path, `${entry.name}.zip`)
        saveBlob(res.data, `${entry.name}.zip`)
        flash(`Downloaded ${entry.name}.zip`)
      } catch (err) {
        setError(err.response?.data?.error || 'Folder zip download failed')
      }
      return
    }
    const url = api.downloadUrl(entry.path)
    window.open(url, '_blank')
  }

  const shareEntry = async (entry) => {
    const rawHours = await dialog.prompt({
      title: 'Create temporary public link',
      message: `Share "${entry.name}" with a temporary download link.`,
      label: 'Expires after hours',
      defaultValue: '24',
      confirmLabel: 'Create link',
      required: true,
    })
    if (!rawHours) return
    const hours = Math.max(1, Math.min(parseInt(rawHours, 10) || 24, 168))
    try {
      const res = await api.share(entry.path, hours)
      setShareLink({ ...res.data, name: entry.name })
      flash(`Share link created for ${entry.name}`)
    } catch (err) {
      setError(err.response?.data?.error || 'Share link failed')
    }
  }

  const copyShareLink = async () => {
    if (!shareLink?.url) return
    try {
      const ok = await copyTextToClipboard(shareLink.url)
      if (ok) flash('Share link copied')
      else setError('Could not copy link. Select and copy it manually.')
    } catch {
      setError('Could not copy link. Select and copy it manually.')
    }
  }

  const extractEntry = async (entry) => {
    setError('')
    try {
      await api.extract(entry.path)
      flash(`Unzipped ${entry.name}`)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Unzip failed')
    }
  }

  const backupEntry = async (entry) => {
    if (!entry.is_dir) {
      setError('Only folders can be backed up')
      return
    }
    
    const destPath = await dialog.prompt({
      title: 'Backup folder',
      message: `Backup "${entry.name}" to which path?`,
      label: 'Destination path (relative)',
      placeholder: 'backups',
      defaultValue: '',
      confirmLabel: 'Create backup',
      required: true,
    })
    
    if (!destPath) return
    
    setError('')
    try {
      const res = await api.backup(entry.path, destPath.trim())
      flash(`Backed up ${entry.name} to ${res.data.backup_name} (${formatSize(res.data.size)})`)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Backup failed')
    }
  }

  const scheduleBackup = async (entry) => {
    if (!entry.is_dir) {
      setError('Only folders can be backed up')
      return
    }
    
    const destPath = await dialog.prompt({
      title: 'Schedule folder backup',
      message: `Schedule regular backups for "${entry.name}". Where should backups be stored?`,
      label: 'Destination path (relative)',
      placeholder: 'backups',
      defaultValue: '',
      confirmLabel: 'Next',
      required: true,
    })
    
    if (!destPath) return
    
    const hoursStr = await dialog.prompt({
      title: 'Schedule interval',
      message: 'How often should backups run?',
      label: 'Every N hours',
      defaultValue: '2',
      placeholder: '2',
      confirmLabel: 'Create schedule',
      required: true,
    })
    
    if (!hoursStr) return
    
    const hours = Math.max(1, Math.min(parseInt(hoursStr, 10) || 2, 24 * 30))
    
    setError('')
    try {
      await (api.createBackupSchedule || api.createFolderBackupSchedule)({
        scope_type: currentScope.scopeType,
        scope_id: currentScope.scopeId,
        source_path: entry.path,
        destination_path: destPath.trim(),
        every_hours: hours,
      })
      flash(`Scheduled backups for ${entry.name} every ${hours} hour(s)`)
      loadBackupSchedules()
    } catch (err) {
      setError(err.response?.data?.error || 'Schedule failed')
    }
  }

  const openBackupSchedules = () => {
    setBackupSchedulesOpen((open) => !open)
    if (!backupSchedulesOpen) loadBackupSchedules()
  }

  const scheduleDraftFromRow = (row) => ({
    source_path: row.source_path || '',
    destination_path: row.destination_path || '',
    every_hours: String(row.every_hours || 2),
    at_hour: String(row.at_hour ?? 0),
    at_minute: String(row.at_minute ?? 0),
    retention_days: String(row.retention_days ?? 7),
    schedule_timezone: row.schedule_timezone || '',
    enabled: row.enabled !== false,
  })

  const editBackupSchedule = (row) => {
    setEditingScheduleId(row.id)
    setScheduleDrafts((drafts) => ({ ...drafts, [row.id]: scheduleDraftFromRow(row) }))
  }

  const patchScheduleDraft = (id, patch) => {
    setScheduleDrafts((drafts) => ({
      ...drafts,
      [id]: { ...(drafts[id] || {}), ...patch },
    }))
  }

  const saveBackupSchedule = async (row) => {
    const draft = scheduleDrafts[row.id] || scheduleDraftFromRow(row)
    const sourcePath = draft.source_path.trim()
    const destinationPath = draft.destination_path.trim()
    if (!sourcePath || !destinationPath) {
      setBackupSchedulesError('Source and destination paths are required.')
      return
    }
    setScheduleBusyId(row.id)
    setBackupSchedulesError('')
    try {
      await api.updateBackupSchedule(row.id, {
        source_path: sourcePath,
        destination_path: destinationPath,
        every_hours: Math.max(1, Math.min(parseInt(draft.every_hours, 10) || 2, 24 * 30)),
        at_hour: Math.max(0, Math.min(parseInt(draft.at_hour, 10) || 0, 23)),
        at_minute: Math.max(0, Math.min(parseInt(draft.at_minute, 10) || 0, 59)),
        retention_days: Math.max(0, parseInt(draft.retention_days, 10) || 0),
        schedule_timezone: draft.schedule_timezone.trim(),
        enabled: !!draft.enabled,
      })
      setEditingScheduleId(null)
      flash('Backup schedule updated')
      loadBackupSchedules()
    } catch (err) {
      setBackupSchedulesError(err.response?.data?.error || 'Failed to update backup schedule')
    } finally {
      setScheduleBusyId(null)
    }
  }

  const deleteBackupSchedule = async (row) => {
    const ok = await dialog.confirm({
      title: 'Delete backup schedule?',
      message: `Delete the scheduled backup for "${row.source_path}"? Existing backup files will stay in place.`,
      confirmLabel: 'Delete schedule',
      tone: 'danger',
    })
    if (!ok) return
    setScheduleBusyId(row.id)
    setBackupSchedulesError('')
    try {
      await api.deleteBackupSchedule(row.id)
      if (editingScheduleId === row.id) setEditingScheduleId(null)
      flash('Backup schedule deleted')
      loadBackupSchedules()
    } catch (err) {
      setBackupSchedulesError(err.response?.data?.error || 'Failed to delete backup schedule')
    } finally {
      setScheduleBusyId(null)
    }
  }

  const runBackupScheduleNow = async (row) => {
    setScheduleBusyId(row.id)
    setBackupSchedulesError('')
    try {
      const res = await api.runBackupSchedule(row.id)
      const archive = res.data.archive
      flash(`Test backup created: ${archive?.backup_name || row.source_path}`)
      await loadBackupSchedules()
      load()
    } catch (err) {
      const archive = err.response?.data?.archive
      setBackupSchedulesError(archive?.error_message || err.response?.data?.error || 'Test backup failed')
      await loadBackupSchedules()
    } finally {
      setScheduleBusyId(null)
    }
  }

  const toggleSelection = (entry, checked) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(entry.path)
      else next.delete(entry.path)
      return next
    })
  }

  const toggleSelectAll = (checked) => {
    setSelected(checked ? new Set(visibleSelectableEntries.map((entry) => entry.path)) : new Set())
  }

  const bulkDelete = async () => {
    if (!selectedEntries.length) return
    const ok = await dialog.confirm({ title: 'Delete selected items?', message: `Delete ${selectedEntries.length} selected item(s)? This cannot be undone.`, confirmLabel: 'Delete selected', tone: 'danger' })
    if (!ok) return
    try {
      await api.deleteMany(selectedEntries.map((entry) => entry.path))
      flash(`Deleted ${selectedEntries.length} item(s)`)
      setSelected(new Set())
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Bulk delete failed')
    }
  }

  const bulkDownloadZip = async () => {
    if (!selectedEntries.length) return
    try {
      const outputName = path ? `${baseName(path) || 'selection'}.zip` : 'selection.zip'
      const res = await api.archiveDownload(selectedEntries.map((entry) => entry.path), path, outputName)
      saveBlob(res.data, outputName)
      flash(`Downloaded ${selectedEntries.length} item(s) as zip`)
    } catch (err) {
      setError(err.response?.data?.error || 'Zip download failed')
    }
  }

  const bulkCreateZip = async () => {
    if (!selectedEntries.length) return
    const suggested = `${path ? baseName(path) || 'selection' : 'selection'}-${Date.now()}.zip`
    const outputName = await dialog.prompt({ title: 'Create zip', label: 'Zip file name', defaultValue: suggested, confirmLabel: 'Create zip', required: true })
    if (!outputName) return
    try {
      await api.archiveCreate(selectedEntries.map((entry) => entry.path), path, outputName)
      flash(`Created ${outputName}`)
      setSelected(new Set())
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Create zip failed')
    }
  }

  const onContextMenu = (e, entry) => {
    e.preventDefault()
    const pos = contextMenuPosition(e.clientX, e.clientY, entry)
    setMenu({ ...pos, entry })
  }

  const onEntryDragStart = (entry) => {
    setDragItem(entry)
  }

  const onEntryDragEnd = () => {
    setDragItem(null)
    setDropTarget('')
  }

  const onFolderDragOver = (e, entry) => {
    if (!dragItem || !entry.is_dir) return
    e.preventDefault()
    setDropTarget(entry.path)
  }

  const onFolderDrop = async (e, entry) => {
    e.preventDefault()
    setDropTarget('')
    if (!dragItem || !entry.is_dir) return
    const destination = joinPath(entry.path, dragItem.name)
    if (destination === dragItem.path) {
      setDragItem(null)
      return
    }
    try {
      await api.rename(dragItem.path, destination)
      flash(`Moved ${dragItem.name} to ${entry.name}`)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Drag move failed')
    } finally {
      setDragItem(null)
    }
  }

  return (
    <div className="bg-secondary rounded-lg border border-gray-700 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="min-w-[240px] flex-1">
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {description}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={searchContents ? 'Search names and text' : 'Search file names'}
              className="w-56 pl-9 pr-3 py-2 rounded bg-primary border border-gray-600 text-white placeholder-gray-500 text-sm outline-none focus:border-accent"
            />
          </div>
          <label className="flex items-center gap-2 text-gray-400 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={searchContents}
              onChange={(e) => setSearchContents(e.target.checked)}
              className="accent-accent"
            />
            Search contents
          </label>
          <label className="flex items-center gap-2 text-gray-400 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              className="accent-accent"
            />
            {hiddenLabel}
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
            onClick={newFile}
            className="inline-flex items-center gap-1 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm"
          >
            <FilePlus className="w-4 h-4" /> New file
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
            onClick={openBackupSchedules}
            className="inline-flex items-center gap-1 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm"
            title="View and edit scheduled folder backups"
          >
            <Clock className="w-4 h-4" /> Schedules
            {scopedBackupSchedules.length > 0 && (
              <span className="rounded bg-accent/20 px-1.5 py-0.5 text-xs text-accent">{scopedBackupSchedules.length}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => pasteClipboardTo(path)}
            disabled={!clipboard}
            className="inline-flex items-center gap-1 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm disabled:opacity-50"
            title={clipboard ? `Paste ${clipboard.name}` : 'Copy or cut something first'}
          >
            <ClipboardPaste className="w-4 h-4" /> Paste
          </button>
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            disabled={uploading || urlDownloading}
            className="inline-flex items-center gap-1 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm disabled:opacity-50"
          >
            <Upload className="w-4 h-4" /> Upload
          </button>
          <button
            type="button"
            onClick={downloadFromUrl}
            disabled={uploading || urlDownloading}
            className="inline-flex items-center gap-1 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm disabled:opacity-50"
            title="Download a public file URL into this folder"
          >
            {urlDownloading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download URL
          </button>
          <button
            type="button"
            onClick={() => zipRef.current?.click()}
            disabled={uploading || urlDownloading}
            className="inline-flex items-center gap-1 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm disabled:opacity-50"
            title="Upload a .zip and extract it here"
          >
            <Plus className="w-4 h-4" /> Upload & unzip
          </button>
          <input ref={uploadRef} type="file" multiple className="hidden" onChange={onPickUpload} />
          <input ref={zipRef} type="file" accept=".zip,application/zip" className="hidden" onChange={onPickZip} />
        </div>
      </div>

      {backupSchedulesOpen && (
        <div className="mb-4 rounded border border-gray-700 bg-primary/30">
          <div className="flex items-center justify-between gap-3 border-b border-gray-700 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Scheduled folder backups</h3>
              <p className="text-xs text-gray-500 mt-0.5">{scopedBackupSchedules.length} schedule(s) for this file manager</p>
            </div>
            <button
              type="button"
              onClick={loadBackupSchedules}
              className="inline-flex items-center gap-1 px-3 py-2 bg-secondary hover:bg-gray-700 rounded text-white text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${backupSchedulesLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
          {backupSchedulesError && (
            <div className="mx-4 mt-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{backupSchedulesError}</div>
          )}
          {backupSchedulesLoading && scopedBackupSchedules.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">Loading schedules...</div>
          ) : scopedBackupSchedules.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">No scheduled backups for this file manager yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Folder</th>
                    <th className="px-4 py-2 text-left font-semibold">Destination</th>
                    <th className="px-4 py-2 text-left font-semibold">Schedule</th>
                    <th className="px-4 py-2 text-left font-semibold">Status</th>
                    <th className="px-4 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedBackupSchedules.map((row) => {
                    const editing = editingScheduleId === row.id
                    const draft = scheduleDrafts[row.id] || scheduleDraftFromRow(row)
                    const daily = Number(editing ? draft.every_hours : row.every_hours) === 24
                    const tzLabel = row.schedule_timezone || backupServerTimezone || 'UTC'
                    const nextRun = row.enabled && row.next_run_at ? formatPcTime(row.next_run_at) : ''
                    return (
                      <tr key={row.id} className="border-t border-gray-800 align-top">
                        <td className="px-4 py-3">
                          {editing ? (
                            <input
                              value={draft.source_path}
                              onChange={(e) => patchScheduleDraft(row.id, { source_path: e.target.value })}
                              className="w-56 rounded border border-gray-700 bg-secondary px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-accent"
                            />
                          ) : (
                            <span className="font-mono text-xs text-gray-200">{row.source_path}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {editing ? (
                            <input
                              value={draft.destination_path}
                              onChange={(e) => patchScheduleDraft(row.id, { destination_path: e.target.value })}
                              className="w-56 rounded border border-gray-700 bg-secondary px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-accent"
                            />
                          ) : (
                            <span className="font-mono text-xs text-gray-300">{row.destination_path}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {editing ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="text-xs text-gray-500">
                                Every
                                <input
                                  type="number"
                                  min="1"
                                  max="720"
                                  value={draft.every_hours}
                                  onChange={(e) => patchScheduleDraft(row.id, { every_hours: e.target.value })}
                                  className="ml-1 w-16 rounded border border-gray-700 bg-secondary px-2 py-1.5 text-white outline-none focus:border-accent"
                                />
                                h
                              </label>
                              <label className="text-xs text-gray-500">
                                At
                                <input
                                  type="number"
                                  min="0"
                                  max="23"
                                  value={draft.at_hour}
                                  disabled={!daily}
                                  onChange={(e) => patchScheduleDraft(row.id, { at_hour: e.target.value })}
                                  className="ml-1 w-14 rounded border border-gray-700 bg-secondary px-2 py-1.5 text-white outline-none focus:border-accent disabled:opacity-40"
                                />
                                :
                                <input
                                  type="number"
                                  min="0"
                                  max="59"
                                  value={draft.at_minute}
                                  onChange={(e) => patchScheduleDraft(row.id, { at_minute: e.target.value })}
                                  className="ml-1 w-14 rounded border border-gray-700 bg-secondary px-2 py-1.5 text-white outline-none focus:border-accent"
                                />
                              </label>
                              <label className="text-xs text-gray-500">
                                Keep
                                <input
                                  type="number"
                                  min="0"
                                  value={draft.retention_days}
                                  onChange={(e) => patchScheduleDraft(row.id, { retention_days: e.target.value })}
                                  className="mx-1 w-16 rounded border border-gray-700 bg-secondary px-2 py-1.5 text-white outline-none focus:border-accent"
                                />
                                days
                              </label>
                              <input
                                value={draft.schedule_timezone}
                                onChange={(e) => patchScheduleDraft(row.id, { schedule_timezone: e.target.value })}
                                placeholder={backupServerTimezone || 'UTC'}
                                className="w-28 rounded border border-gray-700 bg-secondary px-2 py-1.5 text-xs text-white outline-none focus:border-accent"
                              />
                            </div>
                          ) : (
                            <div className="text-gray-300">
                              {Number(row.every_hours) === 24
                                ? `Daily at ${String(row.at_hour || 0).padStart(2, '0')}:${String(row.at_minute || 0).padStart(2, '0')}`
                                : `Every ${row.every_hours}h near minute ${String(row.at_minute || 0).padStart(2, '0')}`}
                              <div className="text-xs text-gray-500">Keep {row.retention_days} day(s) {tzLabel}</div>
                              <div className="text-xs text-green-300 mt-1">
                                {row.enabled ? (nextRun ? `Next: ${nextRun}` : 'Next: pending scheduler') : 'Schedule paused'}
                              </div>
                              {row.enabled && nextRun && <div className="text-[10px] text-gray-500">{pcTimezone}</div>}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {editing ? (
                            <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                              <input
                                type="checkbox"
                                checked={draft.enabled}
                                onChange={(e) => patchScheduleDraft(row.id, { enabled: e.target.checked })}
                                className="accent-accent"
                              />
                              Enabled
                            </label>
                          ) : (
                            <div>
                              <span className={row.enabled ? 'text-green-300' : 'text-gray-500'}>{row.enabled ? 'Enabled' : 'Paused'}</span>
                              <div className="text-xs text-gray-500">{row.last_run_at ? `Last ${formatTime(row.last_run_at)}` : 'Never run'}</div>
                              {row.last_run_error && <div className="mt-1 max-w-xs truncate text-xs text-red-300">{row.last_run_error}</div>}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            {editing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => saveBackupSchedule(row)}
                                  disabled={scheduleBusyId === row.id}
                                  className="p-1.5 rounded text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-50"
                                  title="Save schedule"
                                >
                                  <Save className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingScheduleId(null)}
                                  className="p-1.5 rounded text-gray-300 hover:bg-gray-700 hover:text-white"
                                  title="Cancel"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => runBackupScheduleNow(row)}
                                  disabled={scheduleBusyId === row.id}
                                  className="px-2 py-1 rounded text-xs text-green-200 hover:bg-green-500/15 disabled:opacity-50"
                                  title="Run a test backup now"
                                >
                                  {scheduleBusyId === row.id ? 'Running' : 'Test'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => editBackupSchedule(row)}
                                  className="p-1.5 rounded text-gray-300 hover:bg-gray-700 hover:text-white"
                                  title="Edit schedule"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => deleteBackupSchedule(row)}
                              disabled={scheduleBusyId === row.id}
                              className="p-1.5 rounded text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                              title="Delete schedule"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {selectedEntries.length > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap rounded border border-accent/30 bg-accent/10 px-4 py-3">
          <div className="text-sm text-gray-200">{selectedEntries.length} selected</div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={bulkDownloadZip}
              className="inline-flex items-center gap-1 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm"
            >
              <Download className="w-4 h-4" /> Download zip
            </button>
            <button
              type="button"
              onClick={bulkCreateZip}
              className="inline-flex items-center gap-1 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm"
            >
              <FileArchive className="w-4 h-4" /> Create zip here
            </button>
            <button
              type="button"
              onClick={bulkDelete}
              className="inline-flex items-center gap-1 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 rounded text-red-300 text-sm"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>
        </div>
      )}

      {clipboard && (
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap rounded border border-gray-700 bg-primary/40 px-4 py-3">
          <div className="text-sm text-gray-200">
            {clipboard.mode === 'cut' ? 'Cut' : 'Copied'}:{' '}
            <span className="font-mono text-xs">{clipboard.path}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => pasteClipboardTo(path)}
              className="inline-flex items-center gap-1 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm"
            >
              <ClipboardPaste className="w-4 h-4" /> Paste here
            </button>
            <button
              type="button"
              onClick={() => setClipboard(null)}
              className="inline-flex items-center gap-1 px-3 py-2 bg-primary hover:bg-gray-700 rounded text-white text-sm"
            >
              <X className="w-4 h-4" /> Clear
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 text-sm mb-4 flex-wrap bg-primary/50 rounded px-2 py-2">
        <button
          type="button"
          onClick={() => setPath('')}
          title={basePath}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer hover:bg-gray-700 hover:underline transition ${path ? 'text-gray-200' : 'text-accent font-semibold'}`}
        >
          <Home className="w-3.5 h-3.5" /> {rootLabel}
        </button>
        {clipboard && (
          <button
            type="button"
            onClick={() => pasteClipboardTo('')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-primary hover:bg-gray-700 text-white"
          >
            <ClipboardPaste className="w-3.5 h-3.5" /> paste here
          </button>
        )}
        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1
          return (
            <span key={crumb.path} className="inline-flex items-center gap-1">
              <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
              <button
                type="button"
                onClick={() => setPath(crumb.path)}
                className={`px-2 py-1 rounded cursor-pointer hover:bg-gray-700 hover:underline transition ${isLast ? 'text-accent font-semibold' : 'text-gray-200'}`}
              >
                {crumb.name}
              </button>
              {clipboard && (
                <button
                  type="button"
                  onClick={() => pasteClipboardTo(crumb.path)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-primary hover:bg-gray-700 text-white text-xs"
                >
                  <ClipboardPaste className="w-3 h-3" /> paste
                </button>
              )}
            </span>
          )
        })}
      </div>

      {uploading && (
        <div className="bg-accent/10 border border-accent/30 rounded p-3 mb-3">
          <div className="flex items-center justify-between text-sm text-gray-200 mb-2">
            <span className="inline-flex items-center gap-2">
              <Upload className="w-4 h-4 animate-pulse" />
              Uploading {uploadProgress?.count ?? ''} file{uploadProgress?.count === 1 ? '' : 's'}…
            </span>
            <span className="font-mono text-xs text-gray-300">
              {uploadProgress
                ? `${formatSize(uploadProgress.loaded)} / ${formatSize(uploadProgress.total)} · ${uploadProgress.percent}%`
                : 'Preparing…'}
            </span>
          </div>
          <div className="h-2 rounded bg-primary/60 overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-150"
              style={{ width: `${uploadProgress?.percent ?? 0}%` }}
            />
          </div>
          {uploadProgress?.percent === 100 && (
            <div className="mt-2 text-xs text-gray-400">Finalizing on server…</div>
          )}
        </div>
      )}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-3 mb-3 text-red-300 text-sm">{error}</div>
      )}
      {status && (
        <div className="bg-green-500/10 border border-green-500/30 rounded p-3 mb-3 text-green-300 text-sm">{status}</div>
      )}
      {search && searchLimited && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3 mb-3 text-yellow-300 text-sm">
          Search results limited to the first 250 matches.
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDropUpload}
        className={`rounded border ${dragOver ? 'border-accent bg-accent/5' : 'border-gray-700'} overflow-hidden`}
      >
        {!exists ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            {missingText}
          </div>
        ) : loading && entries.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            {search ? 'No matching files found.' : 'Empty folder. Drop files here to upload.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-primary/50 text-gray-400 text-xs uppercase">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                    className="accent-accent"
                    aria-label="Select all"
                  />
                </th>
                <th className="text-left font-semibold px-3 py-2">Name</th>
                <th className="text-right font-semibold px-3 py-2 w-28">Size</th>
                <th className="text-right font-semibold px-3 py-2 w-48">Modified</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {path && (
                <tr className="hover:bg-primary/40 cursor-pointer border-t border-gray-800" onClick={() => setPath(parentPath(path))}>
                  <td className="px-3 py-2 text-gray-300" colSpan={5}>
                    <span className="inline-flex items-center gap-2">
                      <Folder className="w-4 h-4 text-gray-500" /> ..
                    </span>
                  </td>
                </tr>
              )}
              {entries.map((entry) => {
                const { Icon, color } = entry.is_dir ? { Icon: Folder, color: 'text-accent' } : iconMeta(entry.name)
                const isDrop = dropTarget === entry.path
                return (
                  <tr
                    key={entry.path}
                    draggable={!!entry.path}
                    onDragStart={() => onEntryDragStart(entry)}
                    onDragEnd={onEntryDragEnd}
                    onDragOver={(e) => onFolderDragOver(e, entry)}
                    onDrop={(e) => onFolderDrop(e, entry)}
                    onClick={() => openEntry(entry)}
                    onContextMenu={(e) => onContextMenu(e, entry)}
                    className={`hover:bg-primary/40 cursor-pointer border-t border-gray-800 ${isDrop ? 'bg-accent/10' : ''}`}
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(entry.path)}
                        onChange={(e) => toggleSelection(entry, e.target.checked)}
                        className="accent-accent"
                        aria-label={`Select ${entry.name}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="min-w-0">
                        <span className="inline-flex items-center gap-2 text-gray-200 max-w-full">
                          <Icon className={`w-4 h-4 ${color} shrink-0`} />
                          <span className="truncate">{entry.name}</span>
                          {entry.is_dir && dragItem && dragItem.path !== entry.path && (
                            <span className="text-xs text-gray-500 shrink-0">drop to move</span>
                          )}
                        </span>
                        {search && entry.path && (
                          <div className="mt-1 space-y-0.5">
                            <div className="text-xs text-gray-500 font-mono truncate">{entry.path}</div>
                            {entry.match?.type === 'content' && (
                              <div className="text-xs text-gray-400 truncate">
                                <span className="text-accent">Line {entry.match.line}:</span>{' '}
                                <span className="font-mono">{entry.match.text}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-400 font-mono text-xs">{formatSize(entry.size)}</td>
                    <td className="px-3 py-2 text-right text-gray-500 text-xs">{formatTime(entry.mtime)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); renameEntry(entry) }}
                        className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                        title="Rename"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onContextMenu(e, entry) }}
                        className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
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

      {activeEditor && !editorMinimized && (
        <div
          className="fixed inset-0 z-20 bg-black/10 md:left-64"
          onMouseDown={() => setEditorMinimized(true)}
          aria-hidden="true"
        />
      )}

      {activeEditor && (
        <CodeEditorPanel
          tabs={editorTabs}
          activePath={activeEditorPath}
          minimized={editorMinimized}
          onActivate={(nextPath) => {
            setActiveEditorPath(nextPath)
            setEditorMinimized(false)
          }}
          onMinimize={() => setEditorMinimized((v) => !v)}
          onCloseTab={closeEditorTab}
          onChange={(content) => updateEditorTab(activeEditorPath, (tab) => ({ ...tab, content }))}
          onSave={() => saveEditorTab(activeEditorPath)}
          onCloseAll={() => {
            setEditorTabs([])
            setActiveEditorPath(null)
            setEditorMinimized(false)
          }}
        />
      )}

      {menu && (
        <div
          style={{ left: menu.x, top: menu.y, maxHeight: 'calc(100vh - 16px)' }}
          className="fixed z-50 bg-secondary border border-gray-700 rounded shadow-lg py-1 min-w-[180px] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {!menu.entry.is_dir && (
            <>
              {isPreviewable(menu.entry.name) && (
                <MenuItem
                  icon={<Eye className="w-4 h-4" />}
                  onClick={() => {
                    const entry = menu.entry
                    setMenu(null)
                    openPreview(entry.path, fileKind(entry.name))
                  }}
                >
                  Preview
                </MenuItem>
              )}
              <MenuItem
                icon={<Edit3 className="w-4 h-4" />}
                onClick={() => {
                  const entry = menu.entry
                  setMenu(null)
                  openEditor(entry.path)
                }}
                disabled={fileKind(menu.entry.name) !== 'text'}
              >
                Edit
              </MenuItem>
              <MenuItem
                icon={<Download className="w-4 h-4" />}
                onClick={() => {
                  const entry = menu.entry
                  setMenu(null)
                  downloadEntry(entry)
                }}
              >
                Download
              </MenuItem>
              <MenuItem
                icon={<Link2 className="w-4 h-4" />}
                onClick={() => {
                  const entry = menu.entry
                  setMenu(null)
                  shareEntry(entry)
                }}
              >
                Share temporary link
              </MenuItem>
              {isZipFile(menu.entry.name) && (
                <MenuItem
                  icon={<FileArchive className="w-4 h-4" />}
                  onClick={() => {
                    const entry = menu.entry
                    setMenu(null)
                    extractEntry(entry)
                  }}
                >
                  Unzip here
                </MenuItem>
              )}
            </>
          )}
          {menu.entry.is_dir && (
            <MenuItem
              icon={<FileArchive className="w-4 h-4" />}
              onClick={() => {
                const entry = menu.entry
                setMenu(null)
                downloadEntry(entry)
              }}
            >
              Download zip
            </MenuItem>
          )}
          {menu.entry.is_dir && (
            <MenuItem
              icon={<Link2 className="w-4 h-4" />}
              onClick={() => {
                const entry = menu.entry
                setMenu(null)
                shareEntry(entry)
              }}
            >
              Share temporary link
            </MenuItem>
          )}
          {menu.entry.is_dir && (
            <MenuItem
              icon={<Download className="w-4 h-4" />}
              onClick={() => {
                const entry = menu.entry
                setMenu(null)
                backupEntry(entry)
              }}
            >
              Backup folder
            </MenuItem>
          )}
          {menu.entry.is_dir && (
            <MenuItem
              icon={<Clock className="w-4 h-4" />}
              onClick={() => {
                const entry = menu.entry
                setMenu(null)
                scheduleBackup(entry)
              }}
            >
              Schedule backups
            </MenuItem>
          )}
          <MenuItem
            icon={<Copy className="w-4 h-4" />}
            onClick={() => {
              const entry = menu.entry
              setMenu(null)
              copyEntry(entry)
            }}
          >
            Copy
          </MenuItem>
          <MenuItem
            icon={<Scissors className="w-4 h-4" />}
            onClick={() => {
              const entry = menu.entry
              setMenu(null)
              cutEntry(entry)
            }}
          >
            Cut
          </MenuItem>
          <MenuItem
            icon={<ClipboardPaste className="w-4 h-4" />}
            onClick={() => {
              const target = menu.entry.is_dir ? menu.entry.path : parentPath(menu.entry.path)
              setMenu(null)
              pasteClipboardTo(target)
            }}
            disabled={!clipboard}
          >
            Paste into folder
          </MenuItem>
          <MenuItem
            icon={<Edit3 className="w-4 h-4" />}
            onClick={() => {
              const entry = menu.entry
              setMenu(null)
              renameEntry(entry)
            }}
          >
            Rename
          </MenuItem>
          <MenuItem
            icon={<ChevronRight className="w-4 h-4" />}
            onClick={() => {
              const entry = menu.entry
              setMenu(null)
              moveEntry(entry)
            }}
          >
            Move
          </MenuItem>
          <MenuItem
            icon={<Trash2 className="w-4 h-4" />}
            onClick={() => {
              const entry = menu.entry
              setMenu(null)
              deleteEntry(entry)
            }}
            danger
          >
            Delete
          </MenuItem>
        </div>
      )}

      {preview && (
        <PreviewModal
          preview={preview}
          onClose={closePreview}
          onDownload={() => downloadEntry({ path: preview.path, name: baseName(preview.path), is_dir: false })}
        />
      )}

      {shareLink && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-lg border border-gray-700 bg-secondary shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-700 px-4 py-3">
              <div>
                <h2 className="text-white font-semibold">Public link for {shareLink.name}</h2>
                <p className="text-xs text-gray-400 mt-1">Anyone with this link can download it until the expiry time.</p>
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
                Delete or rename the source file to invalidate the link sooner.
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

function PreviewModal({ preview, onClose, onDownload }) {
  const fileName = baseName(preview.path)
  return (
    <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center p-4" onMouseDown={onClose}>
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
            <button type="button" onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded text-gray-400" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto flex items-center justify-center bg-primary/40 p-4 min-h-[40vh]">
          {preview.loading ? (
            <div className="text-gray-400 text-sm">Loading preview...</div>
          ) : preview.error ? (
            <div className="text-red-400 text-sm">{preview.error}</div>
          ) : preview.kind === 'image' ? (
            <img src={preview.url} alt={fileName} className="max-w-full max-h-[75vh] object-contain" />
          ) : preview.kind === 'video' ? (
            <video src={preview.url} controls className="max-w-full max-h-[75vh]" />
          ) : preview.kind === 'audio' ? (
            <audio src={preview.url} controls className="w-full max-w-xl" />
          ) : preview.kind === 'pdf' ? (
            <iframe src={preview.url} title={fileName} className="w-full h-[75vh] bg-white rounded" />
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

function CodeEditorPanel({ tabs, activePath, minimized, onActivate, onMinimize, onCloseTab, onChange, onSave, onCloseAll }) {
  const activeTab = tabs.find((tab) => tab.path === activePath) || tabs[0] || null
  const textareaRef = useRef(null)
  const gutterRef = useRef(null)
  const highlightRef = useRef(null)

  const lineCount = Math.max(1, (activeTab?.content || '').split('\n').length)
  const highlighted = `${highlightText(activeTab?.content || '', activeTab?.path || '')}\n`

  const syncScroll = () => {
    const top = textareaRef.current?.scrollTop || 0
    const left = textareaRef.current?.scrollLeft || 0
    if (gutterRef.current) gutterRef.current.scrollTop = top
    if (highlightRef.current) {
      highlightRef.current.scrollTop = top
      highlightRef.current.scrollLeft = left
    }
  }

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      onSave()
    }
  }

  if (!activeTab) return null

  if (minimized) {
    return (
      <div className="fixed z-30 bottom-0 right-0 md:left-64">
        <div className="ml-auto flex max-w-xl items-center gap-3 rounded-lg border border-gray-700 bg-secondary/95 px-3 py-2 shadow-2xl backdrop-blur">
          <button
            type="button"
            onClick={onMinimize}
            className="inline-flex items-center gap-2 text-sm text-gray-200 hover:text-white"
          >
            <ChevronRight className="h-4 w-4 -rotate-90" />
            <span className="font-mono truncate max-w-[14rem]">{baseName(activeTab.path)}</span>
          </button>
          {tabs.length > 1 && (
            <span className="rounded bg-primary px-2 py-0.5 text-xs text-gray-300">
              {tabs.length} tabs
            </span>
          )}
          <button
            type="button"
            onClick={onCloseAll}
            className="ml-auto p-1.5 hover:bg-gray-700 rounded text-gray-400"
            title="Close editor"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

    return (
    <div
      className="fixed inset-y-0 right-0 left-0 z-30 overflow-hidden border-l border-gray-700 bg-secondary shadow-2xl md:left-64"
      onMouseDown={(e) => e.stopPropagation()}
    >
        <div className="border-b border-gray-700">
          <div className="flex items-center justify-between px-3 pt-3 gap-3">
            <div>
              <p className="text-sm text-gray-300 font-mono truncate">{activeTab.path}</p>
              <p className="text-xs text-gray-500 mt-1">{editorLanguage(activeTab.path)} mode</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onSave}
                disabled={activeTab.loading || activeTab.saving || activeTab.content === activeTab.original}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-blue-600 rounded text-white text-sm disabled:opacity-50"
              >
                <Save className="w-4 h-4" /> {activeTab.saving ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={onMinimize} className="p-1.5 hover:bg-gray-700 rounded text-gray-400" title={minimized ? 'Expand editor' : 'Minimize editor'}>
                <ChevronRight className={`w-4 h-4 transition ${minimized ? '-rotate-90' : 'rotate-90'}`} />
              </button>
              <button type="button" onClick={onCloseAll} className="p-1.5 hover:bg-gray-700 rounded text-gray-400" title="Close editor">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex items-end gap-1 px-3 pt-3 overflow-x-auto">
            {tabs.map((tab) => {
              const dirty = tab.content !== tab.original
              const isActive = tab.path === activeTab.path
              return (
                <button
                  key={tab.path}
                  type="button"
                  onClick={() => onActivate(tab.path)}
                  className={`group inline-flex items-center gap-2 px-3 py-2 rounded-t-md border border-b-0 text-sm whitespace-nowrap ${
                    isActive
                      ? 'bg-primary border-gray-600 text-white'
                      : 'bg-primary/40 border-gray-800 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <span className="font-mono text-xs">{baseName(tab.path)}</span>
                  {dirty && <span className="text-accent">*</span>}
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      onCloseTab(tab.path)
                    }}
                    className="p-0.5 rounded hover:bg-gray-700"
                  >
                    <X className="w-3 h-3" />
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {activeTab.error && (
          <div className="bg-red-500/10 border-b border-red-500/30 px-3 py-2 text-red-300 text-sm">{activeTab.error}</div>
        )}

        <div className="h-[calc(100%-7.25rem)] overflow-hidden">
          {activeTab.loading ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">Loading...</div>
          ) : (
            <div className="h-full flex bg-primary text-sm font-mono">
              <div
                ref={gutterRef}
                className="w-14 shrink-0 overflow-hidden border-r border-gray-800 bg-black/20 text-right text-gray-500 select-none"
              >
                <div className="px-3 py-4 leading-6">
                  {Array.from({ length: lineCount }, (_, i) => (
                    <div key={i + 1}>{i + 1}</div>
                  ))}
                </div>
              </div>
              <div className="relative flex-1 overflow-hidden">
                <pre
                  ref={highlightRef}
                  aria-hidden="true"
                  className="absolute inset-0 m-0 overflow-auto px-4 py-4 leading-6 text-gray-100 pointer-events-none whitespace-pre"
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                />
                <textarea
                  ref={textareaRef}
                  value={activeTab.content}
                  onChange={(e) => onChange(e.target.value)}
                  onKeyDown={onKeyDown}
                  onScroll={syncScroll}
                  spellCheck={false}
                  wrap="off"
                  className="absolute inset-0 w-full h-full bg-transparent text-transparent caret-white px-4 py-4 resize-none outline-none border-0 leading-6 overflow-auto whitespace-pre"
                />
              </div>
            </div>
          )}
        </div>
    </div>
  )
}
