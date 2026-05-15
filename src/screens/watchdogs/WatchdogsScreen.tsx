import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertCircleIcon,
  Clock01Icon,
  RefreshIcon,
  SecurityCheckIcon,
  Shield01Icon,
  ShieldKeyIcon,
  TimeScheduleIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

// ── Types (mirrors api/watchdogs.ts) ──────────────────────────────────────

type WatchdogStatus = 'green' | 'amber' | 'red'

type WatchdogInfo = {
  id: string
  displayName: string
  host: 'mac-launchd' | 'oracle-systemd' | 'cron'
  label: string
  intervalSeconds: number | null
  lastFire: string | null
  runCount24h: number
  driftCount24h: number
  lastError: string | null
  nextRun: string | null
  pid: number | null
  lastExitStatus: number | null
  status: WatchdogStatus
}

type WatchdogsResponse = {
  watchdogs: WatchdogInfo[]
  fetchedAt: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const diffMs = Date.now() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  return `${diffDays}d ago`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function formatInterval(seconds: number | null): string {
  if (seconds === null) return 'always-on'
  if (seconds < 60) return `${seconds}s`
  const min = Math.floor(seconds / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  return `${hr}h`
}

async function fetchWatchdogs(): Promise<WatchdogsResponse> {
  const res = await fetch('/api/watchdogs')
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Request failed (${res.status})`)
  }
  return (await res.json()) as WatchdogsResponse
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: WatchdogStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider',
        status === 'green' &&
          'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
        status === 'amber' &&
          'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
        status === 'red' &&
          'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'green' && 'bg-emerald-500',
          status === 'amber' && 'bg-amber-500',
          status === 'red' && 'bg-red-500',
        )}
      />
      {status === 'green' ? 'Active' : status === 'amber' ? 'Stale' : 'Down'}
    </span>
  )
}

function HostBadge({ host }: { host: WatchdogInfo['host'] }) {
  const label =
    host === 'mac-launchd' ? 'Mac launchd' : host === 'oracle-systemd' ? 'Oracle systemd' : 'cron'
  return (
    <span className="rounded-md border border-primary-200 bg-primary-100/60 px-2 py-0.5 text-[10px] font-medium text-primary-600 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400">
      {label}
    </span>
  )
}

function StatCell({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="flex flex-col items-center py-2.5 px-1">
      <div
        className={cn(
          'text-sm font-bold text-primary-900 dark:text-neutral-100',
          mono && 'font-mono text-xs',
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-primary-400 dark:text-neutral-500">
        {label}
      </div>
    </div>
  )
}

function WatchdogCard({ wd }: { wd: WatchdogInfo }) {
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-primary-200 bg-primary-50/80 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
      {/* Top accent bar */}
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-1',
          wd.status === 'green' &&
            'bg-gradient-to-r from-emerald-400 via-accent-500 to-emerald-400',
          wd.status === 'amber' &&
            'bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400',
          wd.status === 'red' &&
            'bg-gradient-to-r from-red-400 via-red-500 to-red-400',
        )}
      />

      <div className="px-5 pt-5 pb-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-xl border',
                wd.status === 'green'
                  ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20'
                  : wd.status === 'amber'
                    ? 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20'
                    : 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20',
              )}
            >
              <HugeiconsIcon
                icon={
                  wd.status === 'green'
                    ? SecurityCheckIcon
                    : wd.status === 'amber'
                      ? ShieldKeyIcon
                      : Shield01Icon
                }
                size={18}
                strokeWidth={1.7}
                className={cn(
                  wd.status === 'green' && 'text-emerald-600 dark:text-emerald-400',
                  wd.status === 'amber' && 'text-amber-600 dark:text-amber-400',
                  wd.status === 'red' && 'text-red-600 dark:text-red-400',
                )}
              />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-primary-900 dark:text-neutral-100">
                {wd.displayName}
              </h2>
              <HostBadge host={wd.host} />
            </div>
          </div>
          <StatusBadge status={wd.status} />
        </div>

        {/* Stats row */}
        <div className="mx-0 mt-4 grid grid-cols-4 divide-x divide-primary-200 rounded-xl border border-primary-200 bg-primary-100/50 dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900/50">
          <StatCell label="Runs 24h" value={wd.runCount24h} />
          <StatCell label="Drifts 24h" value={wd.driftCount24h} />
          <StatCell label="Interval" value={formatInterval(wd.intervalSeconds)} />
          <StatCell
            label="Exit"
            value={wd.lastExitStatus !== null ? String(wd.lastExitStatus) : '—'}
          />
        </div>

        {/* Timestamps */}
        <div className="mt-4 grid gap-1.5">
          <div className="flex items-center gap-1.5 text-xs text-primary-500 dark:text-neutral-400">
            <HugeiconsIcon icon={Clock01Icon} size={12} strokeWidth={1.7} />
            <span className="font-medium">Last fire:</span>
            <span className="ml-auto font-semibold text-primary-700 dark:text-neutral-300">
              {formatRelative(wd.lastFire)}
            </span>
            {wd.lastFire && (
              <span className="text-primary-400 dark:text-neutral-500">
                ({formatDate(wd.lastFire)})
              </span>
            )}
          </div>

          {wd.nextRun && (
            <div className="flex items-center gap-1.5 text-xs text-primary-500 dark:text-neutral-400">
              <HugeiconsIcon icon={TimeScheduleIcon} size={12} strokeWidth={1.7} />
              <span className="font-medium">Next run:</span>
              <span className="ml-auto font-semibold text-primary-700 dark:text-neutral-300">
                {formatRelative(wd.nextRun).startsWith('-')
                  ? 'overdue'
                  : formatRelative(wd.nextRun)}
              </span>
            </div>
          )}

          {wd.pid !== null && (
            <div className="flex items-center gap-1.5 text-xs text-primary-500 dark:text-neutral-400">
              <span className="font-medium">PID:</span>
              <span className="ml-auto font-mono text-xs font-semibold text-primary-700 dark:text-neutral-300">
                {wd.pid}
              </span>
            </div>
          )}
        </div>

        {/* Label */}
        <div className="mt-3">
          <p className="truncate font-mono text-[10px] text-primary-400 dark:text-neutral-600">
            {wd.label}
          </p>
        </div>

        {/* Last error */}
        {wd.lastError && (
          <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50/70 px-2.5 py-2 dark:border-red-900/30 dark:bg-red-950/20">
            <HugeiconsIcon
              icon={AlertCircleIcon}
              size={13}
              strokeWidth={1.7}
              className="mt-0.5 shrink-0 text-red-500"
            />
            <p className="line-clamp-2 text-[11px] text-red-700 dark:text-red-400">
              {wd.lastError}
            </p>
          </div>
        )}
      </div>
    </article>
  )
}

function SummaryBar({ watchdogs }: { watchdogs: WatchdogInfo[] }) {
  const green = watchdogs.filter((w) => w.status === 'green').length
  const amber = watchdogs.filter((w) => w.status === 'amber').length
  const red = watchdogs.filter((w) => w.status === 'red').length

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
        <span className="size-2 rounded-full bg-emerald-500" />
        {green} active
      </span>
      {amber > 0 && (
        <span className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
          <span className="size-2 rounded-full bg-amber-500" />
          {amber} stale
        </span>
      )}
      {red > 0 && (
        <span className="flex items-center gap-1.5 font-semibold text-red-700 dark:text-red-400">
          <span className="size-2 rounded-full bg-red-500" />
          {red} down
        </span>
      )}
    </div>
  )
}

// ── Main screen ────────────────────────────────────────────────────────────

export function WatchdogsScreen() {
  const query = useQuery<WatchdogsResponse>({
    queryKey: ['watchdogs'],
    queryFn: fetchWatchdogs,
    refetchInterval: 30_000,
  })

  const watchdogs = query.data?.watchdogs ?? []
  const fetchedAt = query.data?.fetchedAt

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 md:px-6">
      {/* Page header */}
      <div className="flex flex-col gap-3 rounded-2xl border border-primary-200 bg-primary-50/80 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={Shield01Icon} size={22} strokeWidth={1.7} />
            <h1 className="text-lg font-semibold text-primary-900">Watchdogs</h1>
          </div>
          <p className="mt-1 text-sm text-primary-600">
            Automated monitors running on Mac launchd, Oracle systemd, and cron.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {watchdogs.length > 0 && <SummaryBar watchdogs={watchdogs} />}
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="inline-flex items-center gap-1.5 rounded-xl border border-primary-200 bg-primary-100/60 px-3 py-1.5 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-200 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              size={13}
              strokeWidth={1.8}
              className={cn(query.isFetching && 'animate-spin')}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Loading state */}
      {query.isLoading && (
        <div className="rounded-2xl border border-primary-200 bg-primary-50/70 p-8 text-center text-sm text-primary-500">
          Loading watchdog status…
        </div>
      )}

      {/* Error state */}
      {query.isError && (
        <div className="rounded-2xl border border-red-200 bg-red-50/70 p-6 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={AlertCircleIcon} size={16} strokeWidth={1.7} />
            <span>
              {query.error instanceof Error
                ? query.error.message
                : 'Failed to load watchdog status'}
            </span>
          </div>
        </div>
      )}

      {/* Cards grid */}
      {watchdogs.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {watchdogs.map((wd) => (
            <WatchdogCard key={wd.id} wd={wd} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!query.isLoading && !query.isError && watchdogs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-primary-200 bg-primary-50/70 p-8 text-center text-sm text-primary-600">
          No watchdog data returned.
        </div>
      )}

      {/* Footer timestamp */}
      {fetchedAt && (
        <p className="text-center text-[11px] text-primary-400 dark:text-neutral-600">
          Last fetched {new Date(fetchedAt).toLocaleTimeString()} — auto-refreshes every 30s
        </p>
      )}
    </div>
  )
}
