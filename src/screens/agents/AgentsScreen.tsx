import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  BotIcon,
  FilterIcon,
  Refresh01Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentType =
  | 'hermes-profile'
  | 'mastra'
  | 'voice-bot'
  | 'classifier'
  | 'archon'
  | 'service'

type AgentHost = 'mac' | 'oracle'

type AgentEntry = {
  id: string
  name: string
  type: AgentType
  model: string
  host: AgentHost
  live: boolean
  process?: string
  lastActiveMs: number | null
  langfuseSpans24h: number | null
  henryAccessible: boolean
  mallyAccessible: boolean
  notes?: string
}

type AgentsListResponse = {
  agents: Array<AgentEntry>
  checkedAt: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<AgentType, string> = {
  'hermes-profile': 'Hermes Profile',
  mastra: 'Mastra',
  'voice-bot': 'Voice',
  classifier: 'Classifier',
  archon: 'Archon',
  service: 'Service',
}

const TYPE_ORDER: Array<AgentType> = [
  'hermes-profile',
  'mastra',
  'voice-bot',
  'classifier',
  'archon',
  'service',
]

const TYPE_COLORS: Record<AgentType, string> = {
  'hermes-profile': 'bg-accent-500/10 text-accent-600 border-accent-500/20',
  mastra: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  'voice-bot': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  classifier: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  archon: 'bg-pink-500/10 text-pink-600 border-pink-500/20',
  service: 'bg-primary-200/60 text-primary-600 border-primary-300/40',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(ms: number | null): string {
  if (!ms) return '—'
  const diffS = Math.round((Date.now() - ms) / 1000)
  if (diffS < 60) return `${diffS}s ago`
  if (diffS < 3600) return `${Math.round(diffS / 60)}m ago`
  if (diffS < 86400) return `${Math.round(diffS / 3600)}h ago`
  return `${Math.round(diffS / 86400)}d ago`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LiveBadge({ live }: { live: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        live
          ? 'bg-emerald-500/10 text-emerald-600'
          : 'bg-primary-200/60 text-primary-400',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          live ? 'bg-emerald-500' : 'bg-primary-400',
        )}
      />
      {live ? 'Live' : 'Dark'}
    </span>
  )
}

function AccessChip({ label, yes }: { label: string; yes: boolean }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-medium',
        yes
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
          : 'bg-primary-100 text-primary-400 line-through dark:bg-neutral-800 dark:text-neutral-600',
      )}
    >
      {label}
    </span>
  )
}

function AgentRow({ agent }: { agent: AgentEntry }) {
  return (
    <tr className="group border-b border-primary-100 last:border-0 hover:bg-primary-50/50 dark:border-neutral-800 dark:hover:bg-neutral-900/50">
      {/* Name + process */}
      <td className="py-2.5 pl-4 pr-3">
        <div className="flex items-center gap-2">
          <LiveBadge live={agent.live} />
          <span className="font-medium text-primary-900 dark:text-neutral-100">
            {agent.name}
          </span>
        </div>
        {agent.process && (
          <div className="mt-0.5 font-mono text-[10px] text-primary-400 dark:text-neutral-600">
            {agent.process}
          </div>
        )}
      </td>

      {/* Type */}
      <td className="px-3 py-2.5">
        <span
          className={cn(
            'inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            TYPE_COLORS[agent.type],
          )}
        >
          {TYPE_LABELS[agent.type]}
        </span>
      </td>

      {/* Model */}
      <td className="hidden px-3 py-2.5 sm:table-cell">
        <span className="font-mono text-xs text-primary-700 dark:text-neutral-300">
          {agent.model}
        </span>
      </td>

      {/* Host */}
      <td className="hidden px-3 py-2.5 md:table-cell">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            agent.host === 'oracle'
              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
              : 'bg-primary-100 text-primary-600 dark:bg-neutral-800 dark:text-neutral-400',
          )}
        >
          {agent.host}
        </span>
      </td>

      {/* Last active */}
      <td className="hidden px-3 py-2.5 lg:table-cell">
        <span className="text-xs text-primary-500 dark:text-neutral-500">
          {formatRelativeTime(agent.lastActiveMs)}
        </span>
      </td>

      {/* Langfuse spans 24h */}
      <td className="hidden px-3 py-2.5 xl:table-cell">
        <span className="text-xs text-primary-500 dark:text-neutral-500">
          {agent.langfuseSpans24h === null ? '—' : agent.langfuseSpans24h.toLocaleString()}
        </span>
      </td>

      {/* Access */}
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap gap-1">
          <AccessChip label="Henry" yes={agent.henryAccessible} />
          <AccessChip label="Mally" yes={agent.mallyAccessible} />
        </div>
      </td>
    </tr>
  )
}

function AgentGroup({
  type,
  agents,
}: {
  type: AgentType
  agents: Array<AgentEntry>
}) {
  const liveCount = agents.filter((a) => a.live).length

  return (
    <section className="overflow-hidden rounded-xl border border-primary-200 bg-[var(--theme-card)] shadow-sm dark:border-neutral-800">
      {/* Group header */}
      <div className="flex items-center justify-between border-b border-primary-100 bg-primary-50/60 px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              TYPE_COLORS[type],
            )}
          >
            {TYPE_LABELS[type]}
          </span>
          <span className="text-xs text-primary-500 dark:text-neutral-500">
            {agents.length} total
          </span>
        </div>
        <span className="text-xs text-emerald-600 dark:text-emerald-400">
          {liveCount} live
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-primary-100 text-left dark:border-neutral-800">
              <th className="py-2 pl-4 pr-3 text-[10px] font-semibold uppercase tracking-wider text-primary-400 dark:text-neutral-500">
                Name / Process
              </th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-primary-400 dark:text-neutral-500">
                Type
              </th>
              <th className="hidden px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-primary-400 sm:table-cell dark:text-neutral-500">
                Model
              </th>
              <th className="hidden px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-primary-400 md:table-cell dark:text-neutral-500">
                Host
              </th>
              <th className="hidden px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-primary-400 lg:table-cell dark:text-neutral-500">
                Last Active
              </th>
              <th className="hidden px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-primary-400 xl:table-cell dark:text-neutral-500">
                Spans 24h
              </th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-primary-400 dark:text-neutral-500">
                Access
              </th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export function AgentsScreen() {
  const [search, setSearch] = useState('')
  const [filterLive, setFilterLive] = useState<'all' | 'live' | 'dark'>('all')

  const query = useQuery<AgentsListResponse>({
    queryKey: ['agents', 'list'],
    queryFn: async () => {
      const res = await fetch('/api/agents/list')
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      return (await res.json()) as AgentsListResponse
    },
    refetchInterval: 60_000,
    staleTime: 55_000,
  })

  const agents = query.data?.agents ?? []
  const checkedAt = query.data?.checkedAt ?? null

  // Filter
  const filtered = agents.filter((a) => {
    const matchSearch =
      search.trim().length === 0 ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.model.toLowerCase().includes(search.toLowerCase()) ||
      a.type.toLowerCase().includes(search.toLowerCase())

    const matchLive =
      filterLive === 'all' ||
      (filterLive === 'live' && a.live) ||
      (filterLive === 'dark' && !a.live)

    return matchSearch && matchLive
  })

  // Group by type in canonical order
  const grouped = TYPE_ORDER.map((type) => ({
    type,
    agents: filtered.filter((a) => a.type === type),
  })).filter((g) => g.agents.length > 0)

  const liveTotal = agents.filter((a) => a.live).length
  const darkTotal = agents.length - liveTotal

  return (
    <main className="min-h-full bg-surface px-4 pb-24 pt-5 text-primary-900 md:px-6 md:pt-8">
      <section className="mx-auto w-full max-w-[1480px] space-y-5">
        {/* ── Page header ── */}
        <header className="flex flex-col gap-4 rounded-xl border border-primary-200 bg-primary-50/80 px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-accent-500/30 bg-accent-500/10 text-accent-500">
              <HugeiconsIcon icon={BotIcon} size={24} strokeWidth={1.6} />
            </div>
            <div>
              <h1 className="text-base font-semibold text-primary-900">
                Agent Catalogue
              </h1>
              <p className="mt-1 text-sm text-primary-600">
                Every Hermes profile, Mastra service, voice bot, and classifier across Mac + Oracle.
              </p>
            </div>
          </div>

          {/* Stat chips */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-lg border border-primary-200 bg-white/60 px-3 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900">
              <span className="font-bold text-primary-900 dark:text-neutral-100">{agents.length}</span>
              <span className="ml-1 text-primary-500 dark:text-neutral-500">total</span>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-1.5 text-xs dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <span className="font-bold text-emerald-700 dark:text-emerald-400">{liveTotal}</span>
              <span className="ml-1 text-emerald-600 dark:text-emerald-500">live</span>
            </div>
            <div className="rounded-lg border border-primary-200 bg-primary-50/60 px-3 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900/40">
              <span className="font-bold text-primary-600 dark:text-neutral-400">{darkTotal}</span>
              <span className="ml-1 text-primary-500 dark:text-neutral-500">dark</span>
            </div>
            {checkedAt && (
              <div className="text-xs text-primary-400 dark:text-neutral-600">
                Updated {formatRelativeTime(checkedAt)}
              </div>
            )}
            <button
              type="button"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              className="flex items-center gap-1.5 rounded-lg border border-primary-200 bg-white/60 px-3 py-1.5 text-xs text-primary-700 transition-colors hover:bg-primary-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            >
              <HugeiconsIcon
                icon={Refresh01Icon}
                size={12}
                strokeWidth={1.8}
                className={cn(query.isFetching && 'animate-spin')}
              />
              Refresh
            </button>
          </div>
        </header>

        {/* ── Filters ── */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
              <HugeiconsIcon
                icon={Search01Icon}
                size={14}
                strokeWidth={1.8}
                className="text-primary-400"
              />
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, model, or type..."
              className="h-9 w-full rounded-lg border border-primary-200 bg-white/80 pl-8 pr-3 text-sm text-primary-900 placeholder-primary-400 outline-none transition-colors focus:border-accent-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder-neutral-600"
            />
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-primary-200 bg-white/80 px-2 dark:border-neutral-700 dark:bg-neutral-900">
            <HugeiconsIcon
              icon={FilterIcon}
              size={13}
              strokeWidth={1.8}
              className="text-primary-400"
            />
            {(['all', 'live', 'dark'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setFilterLive(opt)}
                className={cn(
                  'rounded px-2 py-1 text-xs font-medium capitalize transition-colors',
                  filterLive === opt
                    ? 'bg-accent-500 text-white'
                    : 'text-primary-600 hover:bg-primary-100 dark:text-neutral-400 dark:hover:bg-neutral-800',
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {/* ── Loading state ── */}
        {query.isLoading && (
          <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-primary-200 bg-[var(--theme-card)] shadow-sm dark:border-neutral-800">
            <span className="text-sm text-primary-500 dark:text-neutral-400">
              Probing agents across Mac + Oracle…
            </span>
          </div>
        )}

        {/* ── Error state ── */}
        {query.isError && (
          <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
            Failed to load agent inventory. Check that the API is reachable.
          </div>
        )}

        {/* ── Groups ── */}
        {!query.isLoading &&
          grouped.map(({ type, agents: groupAgents }) => (
            <AgentGroup key={type} type={type} agents={groupAgents} />
          ))}

        {/* ── Empty state ── */}
        {!query.isLoading && !query.isError && filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-primary-200 bg-primary-50/70 p-8 text-center text-sm text-primary-600 dark:border-neutral-700 dark:bg-neutral-900/40">
            No agents match the current filter.
          </div>
        )}
      </section>
    </main>
  )
}
