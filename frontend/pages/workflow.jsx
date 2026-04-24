import { useMemo } from 'react'
import Head from 'next/head'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
} from '@xyflow/react'
import {
  Archive,
  Box,
  CheckCircle2,
  FileCode2,
  FolderGit2,
  Github,
  Globe2,
  KeyRound,
  LayoutDashboard,
  PlayCircle,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  Terminal,
  UploadCloud,
  Workflow,
} from 'lucide-react'

const groups = {
  auth: { label: 'Access', tone: 'border-blue-500/40 bg-blue-500/10 text-blue-200' },
  source: { label: 'Source', tone: 'border-purple-500/40 bg-purple-500/10 text-purple-200' },
  app: { label: 'App Setup', tone: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200' },
  deploy: { label: 'Deploy', tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' },
  operate: { label: 'Operate', tone: 'border-amber-500/40 bg-amber-500/10 text-amber-200' },
  files: { label: 'Files', tone: 'border-pink-500/40 bg-pink-500/10 text-pink-200' },
}

const nodeIcons = {
  setup: ShieldCheck,
  github: KeyRound,
  project: FolderGit2,
  app: Box,
  env: Settings2,
  deploy: PlayCircle,
  repo: Github,
  build: FileCode2,
  process: RefreshCw,
  nginx: Globe2,
  files: UploadCloud,
  terminal: Terminal,
  system: Server,
  dashboard: LayoutDashboard,
  archive: Archive,
  done: CheckCircle2,
}

function WorkflowNode({ data }) {
  const Icon = nodeIcons[data.icon] || Workflow
  const group = groups[data.group] || groups.operate
  return (
    <div className="w-[260px] rounded border border-gray-700 bg-secondary shadow-xl shadow-black/20 overflow-hidden">
      <Handle type="target" position={Position.Left} className="!bg-accent" />
      <div className="p-3 border-b border-gray-700 flex items-start gap-3">
        <span className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded border ${group.tone}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-white font-semibold leading-5">{data.title}</div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mt-0.5">{group.label}</div>
        </div>
      </div>
      <div className="p-3 text-xs text-gray-300 leading-5">
        {data.body}
      </div>
      {data.detail && (
        <div className="px-3 pb-3 text-[11px] text-gray-500 font-mono leading-5">
          {data.detail}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-accent" />
    </div>
  )
}

const nodeTypes = { workflow: WorkflowNode }

const baseNodes = [
  {
    id: 'setup',
    position: { x: 0, y: 120 },
    data: {
      title: 'Install & Create Admin',
      body: 'Installer prepares system packages, Python, Node, services, nginx, database, and the first admin account.',
      detail: 'install.sh -> systemd + nginx',
      icon: 'setup',
      group: 'auth',
    },
  },
  {
    id: 'github',
    position: { x: 360, y: 0 },
    data: {
      title: 'GitHub Credentials',
      body: 'Add a GitHub username/token once. The panel stores credentials for cloning repos and syncing webhooks.',
      detail: 'Settings -> GitHub Credentials',
      icon: 'github',
      group: 'source',
    },
  },
  {
    id: 'project',
    position: { x: 360, y: 240 },
    data: {
      title: 'Create Project',
      body: 'Define the repository, branch, folder name, and optional auto-deploy behavior for the repo-level workspace.',
      detail: 'Projects -> New Project',
      icon: 'project',
      group: 'source',
    },
  },
  {
    id: 'app',
    position: { x: 720, y: 120 },
    data: {
      title: 'Create App',
      body: 'Split a project into deployable apps. Each app can have its own subdirectory, package manager, commands, port, and domain.',
      detail: 'Project -> Add App',
      icon: 'app',
      group: 'app',
    },
  },
  {
    id: 'env',
    position: { x: 1080, y: 0 },
    data: {
      title: 'Runtime Settings',
      body: 'Configure domain, SSL, client upload body size, app port, PM2 name, and .env content for the app.',
      detail: 'App -> Settings',
      icon: 'env',
      group: 'app',
    },
  },
  {
    id: 'deploy',
    position: { x: 1080, y: 240 },
    data: {
      title: 'Deploy Trigger',
      body: 'Manual deploy, webhook deploy, SSL retry, and restart flows all create tracked deployment records.',
      detail: 'Deployment row + live log',
      icon: 'deploy',
      group: 'deploy',
    },
  },
  {
    id: 'repo',
    position: { x: 1440, y: 0 },
    data: {
      title: 'Clone / Update Repo',
      body: 'The backend locks the repo per project, clones or pulls the selected branch, and resolves the app subdirectory.',
      detail: '/root/<project-folder>',
      icon: 'repo',
      group: 'deploy',
    },
  },
  {
    id: 'build',
    position: { x: 1440, y: 240 },
    data: {
      title: 'Install & Build',
      body: 'If package.json exists, dependencies install with npm/yarn/pnpm, then the configured build command runs.',
      detail: 'package manager + build command',
      icon: 'build',
      group: 'deploy',
    },
  },
  {
    id: 'process',
    position: { x: 1800, y: 120 },
    data: {
      title: 'PM2 Process',
      body: 'The app starts or restarts with PM2. PORT is exported and written into .env when needed.',
      detail: 'pm2 start / restart / save',
      icon: 'process',
      group: 'deploy',
    },
  },
  {
    id: 'nginx',
    position: { x: 2160, y: 120 },
    data: {
      title: 'Nginx & SSL',
      body: 'Domain routing, websocket upgrade headers, large upload limits, and Certbot SSL are configured for the app.',
      detail: 'sites-available + certbot',
      icon: 'nginx',
      group: 'deploy',
    },
  },
  {
    id: 'files',
    position: { x: 720, y: 440 },
    data: {
      title: 'File Manager',
      body: 'Browse, edit text files, upload up to 5GB, upload and unzip, extract existing zips, rename, copy, move, archive, and delete.',
      detail: 'App or project file scope',
      icon: 'files',
      group: 'files',
    },
  },
  {
    id: 'archive',
    position: { x: 1080, y: 520 },
    data: {
      title: 'Archive Operations',
      body: 'Download folders as zip, create zip files in place, and safely extract zip contents without leaving the app directory.',
      detail: 'safe zip path validation',
      icon: 'archive',
      group: 'files',
    },
  },
  {
    id: 'terminal',
    position: { x: 1440, y: 520 },
    data: {
      title: 'Server Terminal',
      body: 'Unlock a websocket-backed PTY shell for server operations. Font size, copy, paste, and resize are handled in the panel.',
      detail: 'xterm.js + flask-sock',
      icon: 'terminal',
      group: 'operate',
    },
  },
  {
    id: 'system',
    position: { x: 1800, y: 520 },
    data: {
      title: 'System Observability',
      body: 'Inspect CPU, memory, ports, PM2 processes, nginx sites, certificates, DNS checks, and app runtime health.',
      detail: 'System page + app runtime',
      icon: 'system',
      group: 'operate',
    },
  },
  {
    id: 'dashboard',
    position: { x: 2160, y: 520 },
    data: {
      title: 'Dashboard & History',
      body: 'Projects, apps, deployment status, logs, disk usage, and recovery actions stay visible after each operation.',
      detail: 'SQLite persistence',
      icon: 'dashboard',
      group: 'operate',
    },
  },
]

function edge(id, source, target, label) {
  return {
    id,
    source,
    target,
    label,
    type: 'smoothstep',
    animated: id.includes('deploy') || id.includes('ops'),
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: '#60a5fa', strokeWidth: 2 },
    labelStyle: { fill: '#cbd5e1', fontSize: 11 },
    labelBgStyle: { fill: '#111827', fillOpacity: 0.9 },
  }
}

const baseEdges = [
  edge('setup-github', 'setup', 'github', 'add token'),
  edge('setup-project', 'setup', 'project', 'create project'),
  edge('github-app', 'github', 'app', 'credential available'),
  edge('project-app', 'project', 'app', 'repo workspace'),
  edge('app-env', 'app', 'env', 'configure'),
  edge('app-deploy', 'app', 'deploy', 'deploy'),
  edge('env-deploy', 'env', 'deploy', 'runtime config'),
  edge('deploy-repo', 'deploy', 'repo', 'clone/pull'),
  edge('repo-build', 'repo', 'build', 'subdirectory'),
  edge('build-process', 'build', 'process', 'start'),
  edge('process-nginx', 'process', 'nginx', 'route'),
  edge('project-files', 'project', 'files', 'browse repo'),
  edge('app-files', 'app', 'files', 'browse deploy dir'),
  edge('files-archive', 'files', 'archive', 'zip/unzip'),
  edge('archive-dashboard', 'archive', 'dashboard', 'refresh state'),
  edge('deploy-system', 'deploy', 'system', 'health checks'),
  edge('terminal-system', 'terminal', 'system', 'admin ops'),
  edge('nginx-dashboard', 'nginx', 'dashboard', 'status'),
  edge('system-dashboard', 'system', 'dashboard', 'observe'),
]

export default function WorkflowPage() {
  const nodes = useMemo(() => baseNodes.map((node) => ({ ...node, type: 'workflow' })), [])
  const edges = useMemo(() => baseEdges, [])

  return (
    <>
      <Head><title>Workflow Documentation - Ascend</title></Head>
      <div className="h-full flex flex-col bg-primary">
        <div className="px-6 py-5 border-b border-gray-800 bg-primary">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                <Workflow className="h-7 w-7 text-accent" /> Workflow
              </h1>
              <p className="text-sm text-gray-400 mt-1 max-w-4xl">
                A living map of how Ascend moves from GitHub credentials to projects, apps, deployment, file operations, terminal access, and system monitoring.
              </p>
            </div>
            <div className="hidden lg:flex items-center gap-2 text-xs text-gray-400">
              {Object.entries(groups).map(([key, value]) => (
                <span key={key} className={`px-2 py-1 rounded border ${value.tone}`}>{value.label}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.25}
            maxZoom={1.2}
            nodesDraggable={false}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
            className="bg-[#0b0f17]"
          >
            <Background color="#334155" gap={20} size={1} />
            <MiniMap
              pannable
              zoomable
              nodeColor="#1f2937"
              maskColor="rgba(15, 23, 42, 0.65)"
              className="!bg-secondary !border !border-gray-700"
            />
            <Controls className="!bg-secondary !border !border-gray-700 [&_button]:!bg-secondary [&_button]:!border-gray-700 [&_button_svg]:!fill-gray-200" />
          </ReactFlow>
        </div>
      </div>
    </>
  )
}
