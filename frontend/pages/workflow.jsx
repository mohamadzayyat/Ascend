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
  access: { label: 'Access', tone: 'border-sky-500/40 bg-sky-500/10 text-sky-200', stroke: '#38bdf8' },
  source: { label: 'Source', tone: 'border-violet-500/40 bg-violet-500/10 text-violet-200', stroke: '#a78bfa' },
  app: { label: 'App Setup', tone: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200', stroke: '#22d3ee' },
  deploy: { label: 'Deploy', tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200', stroke: '#34d399' },
  operate: { label: 'Operate', tone: 'border-amber-500/40 bg-amber-500/10 text-amber-200', stroke: '#fbbf24' },
  files: { label: 'Files', tone: 'border-rose-500/40 bg-rose-500/10 text-rose-200', stroke: '#fb7185' },
}

const icons = {
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
  archive: Archive,
  terminal: Terminal,
  system: Server,
  dashboard: LayoutDashboard,
  done: CheckCircle2,
}

const journey = [
  ['1', 'Secure access', 'Install Ascend, create the admin, then save GitHub credentials.'],
  ['2', 'Model the repo', 'Create a project, then split it into one or more deployable apps.'],
  ['3', 'Configure runtime', 'Set domains, ports, commands, environment variables, SSL, and upload limits.'],
  ['4', 'Deploy safely', 'Clone or pull the repo, install dependencies, build, run PM2, and write nginx config.'],
  ['5', 'Operate daily', 'Use files, terminal, runtime health, logs, DNS checks, and dashboard history.'],
]

function WorkflowNode({ data }) {
  const Icon = icons[data.icon] || Workflow
  const group = groups[data.group] || groups.operate
  return (
    <div className="w-[230px] overflow-hidden rounded border border-gray-700 bg-secondary shadow-xl shadow-black/25">
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-primary !bg-accent" />
      <div className={`h-1.5 ${group.tone}`} />
      <div className="p-3">
        <div className="flex items-start gap-3">
          <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border ${group.tone}`}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-5 text-white">{data.title}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-500">{group.label}</div>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-gray-300">{data.body}</p>
        <div className="mt-3 rounded bg-primary/60 px-2 py-1.5 font-mono text-[10px] leading-4 text-gray-500">
          {data.detail}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-primary !bg-accent" />
    </div>
  )
}

const nodeTypes = { workflow: WorkflowNode }

const baseNodes = [
  ['setup', 0, 150, 'Install & Admin', 'Installer prepares system packages, services, nginx, database, and the first admin account.', 'install.sh -> systemd + nginx', 'setup', 'access'],
  ['github', 280, 40, 'GitHub Credentials', 'Save a username/token for repo clones and webhook synchronization.', 'Settings -> GitHub Credentials', 'github', 'source'],
  ['project', 280, 260, 'Project', 'Define repository, branch, folder name, and repo-level deployment settings.', 'Projects -> New Project', 'project', 'source'],
  ['app', 560, 150, 'App', 'Create deployable units with subdirectories, commands, PM2 names, ports, and domains.', 'Project -> Add App', 'app', 'app'],
  ['env', 840, 40, 'Runtime Settings', 'Configure SSL, client body size, app port, .env content, and domain routing inputs.', 'App -> Settings', 'env', 'app'],
  ['deploy', 840, 260, 'Deploy Trigger', 'Manual deploys, webhooks, SSL retry, and restarts create tracked deployment records.', 'Deployments + live log', 'deploy', 'deploy'],
  ['repo', 1120, 40, 'Clone / Pull', 'The backend locks the repo, clones or updates the branch, and selects the app subdirectory.', '/root/<project-folder>', 'repo', 'deploy'],
  ['build', 1120, 260, 'Install & Build', 'If package.json exists, dependencies install and the configured build command runs.', 'npm/yarn/pnpm + build', 'build', 'deploy'],
  ['process', 1400, 150, 'PM2 Process', 'The app starts or restarts with PM2; PORT is exported and saved when needed.', 'pm2 start / save', 'process', 'deploy'],
  ['nginx', 1680, 150, 'Nginx & SSL', 'Writes routing, websocket headers, upload limits, and optional Certbot SSL config.', 'sites-available + certbot', 'nginx', 'deploy'],
  ['files', 560, 470, 'File Manager', 'Browse, edit, upload 5GB files, rename, copy, move, archive, and delete.', 'App or project scope', 'files', 'files'],
  ['archive', 840, 500, 'Zip & Extract', 'Download folders as zip, create zips, and safely extract existing .zip files.', 'safe zip validation', 'archive', 'files'],
  ['terminal', 1120, 500, 'Terminal', 'Unlock a websocket PTY shell with resize, copy, paste, and font-size controls.', 'xterm.js + flask-sock', 'terminal', 'operate'],
  ['system', 1400, 500, 'System', 'Inspect CPU, memory, ports, PM2, nginx sites, certificates, DNS, and runtime health.', 'System + app runtime', 'system', 'operate'],
  ['dashboard', 1680, 500, 'Dashboard', 'Deployment status, logs, project/app history, and cached disk usage remain visible.', 'SQLite persistence', 'dashboard', 'operate'],
].map(([id, x, y, title, body, detail, icon, group]) => ({
  id,
  type: 'workflow',
  position: { x, y },
  data: { title, body, detail, icon, group },
}))

function edge(id, source, target, label, group = 'deploy') {
  return {
    id,
    source,
    target,
    label,
    type: 'smoothstep',
    animated: ['deploy-repo', 'build-process', 'process-nginx'].includes(id),
    markerEnd: { type: MarkerType.ArrowClosed, color: groups[group].stroke },
    style: { stroke: groups[group].stroke, strokeWidth: 2 },
    labelStyle: { fill: '#cbd5e1', fontSize: 10 },
    labelBgStyle: { fill: '#111827', fillOpacity: 0.92 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 4,
  }
}

const baseEdges = [
  edge('setup-github', 'setup', 'github', 'token', 'source'),
  edge('setup-project', 'setup', 'project', 'create', 'source'),
  edge('github-app', 'github', 'app', 'credential', 'app'),
  edge('project-app', 'project', 'app', 'apps', 'app'),
  edge('app-env', 'app', 'env', 'configure', 'app'),
  edge('app-deploy', 'app', 'deploy', 'deploy', 'deploy'),
  edge('env-deploy', 'env', 'deploy', 'runtime', 'deploy'),
  edge('deploy-repo', 'deploy', 'repo', 'clone/pull', 'deploy'),
  edge('repo-build', 'repo', 'build', 'subdir', 'deploy'),
  edge('build-process', 'build', 'process', 'start', 'deploy'),
  edge('process-nginx', 'process', 'nginx', 'route', 'deploy'),
  edge('project-files', 'project', 'files', 'repo files', 'files'),
  edge('app-files', 'app', 'files', 'deploy dir', 'files'),
  edge('files-archive', 'files', 'archive', 'zip/unzip', 'files'),
  edge('archive-dashboard', 'archive', 'dashboard', 'refresh', 'operate'),
  edge('terminal-system', 'terminal', 'system', 'admin ops', 'operate'),
  edge('deploy-system', 'deploy', 'system', 'health', 'operate'),
  edge('nginx-dashboard', 'nginx', 'dashboard', 'status', 'operate'),
  edge('system-dashboard', 'system', 'dashboard', 'observe', 'operate'),
]

export default function WorkflowPage() {
  const nodes = useMemo(() => baseNodes, [])
  const edges = useMemo(() => baseEdges, [])

  return (
    <>
      <Head><title>Workflow - Ascend</title></Head>
      <div className="h-full bg-primary p-6 overflow-auto">
        <div className="mx-auto flex max-w-7xl flex-col gap-5">
          <header className="rounded border border-gray-800 bg-secondary p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h1 className="flex items-center gap-3 text-2xl font-bold text-white">
                  <Workflow className="h-7 w-7 text-accent" /> Workflow Documentation
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
                  A visual map of how Ascend moves from GitHub credentials to projects, apps, deployments,
                  file operations, terminal access, monitoring, and dashboard history.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(groups).map(([key, group]) => (
                  <span key={key} className={`rounded border px-2.5 py-1 ${group.tone}`}>{group.label}</span>
                ))}
              </div>
            </div>
          </header>

          <section className="grid gap-3 md:grid-cols-5">
            {journey.map(([step, title, text]) => (
              <div key={step} className="rounded border border-gray-800 bg-secondary p-4">
                <div className="mb-3 inline-flex h-7 w-7 items-center justify-center rounded bg-accent text-sm font-bold text-white">
                  {step}
                </div>
                <h2 className="text-sm font-semibold text-white">{title}</h2>
                <p className="mt-2 text-xs leading-5 text-gray-400">{text}</p>
              </div>
            ))}
          </section>

          <section className="overflow-hidden rounded border border-gray-800 bg-secondary">
            <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Interactive System Map</h2>
                <p className="text-xs text-gray-500">Drag the canvas, zoom with the controls, and use the minimap to jump between areas.</p>
              </div>
            </div>
            <div className="h-[620px] min-h-[520px]">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.08 }}
                minZoom={0.35}
                maxZoom={1.25}
                nodesDraggable={false}
                nodesConnectable={false}
                proOptions={{ hideAttribution: true }}
                className="bg-[#0b0f17]"
              >
                <Background color="#263244" gap={20} size={1} />
                <MiniMap
                  pannable
                  zoomable
                  nodeColor="#1f2937"
                  maskColor="rgba(15, 23, 42, 0.72)"
                  className="!hidden !bg-secondary !border !border-gray-700 md:!block"
                />
                <Controls className="!bg-secondary !border !border-gray-700 [&_button]:!bg-secondary [&_button]:!border-gray-700 [&_button_svg]:!fill-gray-200" />
              </ReactFlow>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
