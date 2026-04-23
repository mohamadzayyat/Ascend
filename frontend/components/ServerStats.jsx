import { Cpu, MemoryStick, HardDrive, Clock, Gauge, Network, Server } from 'lucide-react'
import { useServerStats } from '@/lib/hooks/useAuth'

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  return `${(bytes / 1024 / 1024 / 1024 / 1024).toFixed(2)} TB`
}

function formatRate(bytesPerSec) {
  if (bytesPerSec === null || bytesPerSec === undefined) return '—'
  return `${formatBytes(bytesPerSec)}/s`
}

function formatUptime(sec) {
  if (!sec) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m`
  return `${sec}s`
}

function barColor(percent) {
  if (percent >= 90) return 'bg-red-500'
  if (percent >= 75) return 'bg-yellow-500'
  return 'bg-accent'
}

function Bar({ percent }) {
  const clamped = Math.min(100, Math.max(0, percent || 0))
  return (
    <div className="w-full h-1.5 bg-primary rounded-full overflow-hidden mt-1">
      <div
        className={`h-full ${barColor(clamped)} transition-all`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

function Metric({ icon, label, value, sub, percent }) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 text-gray-400 text-xs uppercase mb-1">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
      {percent !== undefined && percent !== null && <Bar percent={percent} />}
    </div>
  )
}

export default function ServerStats() {
  const { stats, isLoading } = useServerStats()

  if (isLoading && !stats) {
    return (
      <div className="bg-secondary rounded-lg border border-gray-700 p-6 mb-8">
        <p className="text-gray-400">Loading server stats…</p>
      </div>
    )
  }
  if (!stats) return null

  const { cpu, memory, swap, disk, network, load_average, uptime_seconds, process_count } = stats

  return (
    <div className="bg-secondary rounded-lg border border-gray-700 overflow-hidden mb-8">
      <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-accent" />
            Server
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {stats.hostname} · {stats.platform} · kernel {stats.kernel}
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> up {formatUptime(uptime_seconds)}
          </span>
          {process_count != null && (
            <span>{process_count} processes</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 divide-x divide-y divide-gray-700 md:divide-y-0">
        <Metric
          icon={<Cpu className="w-4 h-4" />}
          label="CPU"
          value={`${(cpu.percent ?? 0).toFixed(1)}%`}
          sub={`${cpu.cores_logical} vCPU${cpu.cores_physical ? ` · ${cpu.cores_physical} physical` : ''}`}
          percent={cpu.percent}
        />
        <Metric
          icon={<MemoryStick className="w-4 h-4" />}
          label="Memory"
          value={`${memory.percent.toFixed(0)}%`}
          sub={`${formatBytes(memory.used)} / ${formatBytes(memory.total)}`}
          percent={memory.percent}
        />
        {swap && swap.total > 0 ? (
          <Metric
            icon={<MemoryStick className="w-4 h-4" />}
            label="Swap"
            value={`${swap.percent.toFixed(0)}%`}
            sub={`${formatBytes(swap.used)} / ${formatBytes(swap.total)}`}
            percent={swap.percent}
          />
        ) : (
          <Metric
            icon={<MemoryStick className="w-4 h-4" />}
            label="Swap"
            value="—"
            sub="not configured"
          />
        )}
        {disk && (
          <Metric
            icon={<HardDrive className="w-4 h-4" />}
            label="Disk"
            value={`${disk.percent.toFixed(0)}%`}
            sub={`${formatBytes(disk.used)} / ${formatBytes(disk.total)}`}
            percent={disk.percent}
          />
        )}
        <Metric
          icon={<Network className="w-4 h-4" />}
          label="Network"
          value={`↓ ${formatRate(network.recv_rate_bps)}`}
          sub={`↑ ${formatRate(network.send_rate_bps)}`}
        />
        {load_average ? (
          <Metric
            icon={<Gauge className="w-4 h-4" />}
            label="Load avg"
            value={load_average['1m'].toFixed(2)}
            sub={`5m ${load_average['5m'].toFixed(2)} · 15m ${load_average['15m'].toFixed(2)}`}
          />
        ) : (
          <Metric
            icon={<Gauge className="w-4 h-4" />}
            label="Load avg"
            value="—"
            sub="unsupported"
          />
        )}
      </div>
    </div>
  )
}
