import { useEffect, useMemo, useState } from 'react'
import type { DecisionMeta } from '@/server/decisions-browser'
import { DecisionCard } from './DecisionCard'
import { DecisionDetail } from './DecisionDetail'

type ListResponse = {
  decisions?: Array<DecisionMeta>
  exists?: boolean
  error?: string
}

type SortKey = 'date' | 'status'
type StatusFilter = 'all' | 'completed' | 'in-progress' | 'proposed' | 'blocked' | 'other'

const STATUS_GROUPS: Record<StatusFilter, (s: string | null) => boolean> = {
  all: () => true,
  completed: (s) => {
    if (!s) return false
    const l = s.toLowerCase()
    return l.startsWith('complet') || l === 'decided' || l === 'approved' || l === 'done' || l === 'live' || l === 'spike-complete'
  },
  'in-progress': (s) => {
    if (!s) return false
    const l = s.toLowerCase()
    return l.startsWith('in-progress') || l.startsWith('prereq') || l.startsWith('ready')
  },
  proposed: (s) => !!s && s.toLowerCase().startsWith('proposed'),
  blocked: (s) => !!s && (s.toLowerCase().startsWith('blocked') || s.toLowerCase().startsWith('draft')),
  other: (s) => {
    if (!s) return true
    const l = s.toLowerCase()
    return (
      !l.startsWith('complet') && l !== 'decided' && l !== 'approved' && l !== 'done' && l !== 'live' &&
      !l.startsWith('in-progress') && !l.startsWith('prereq') && !l.startsWith('ready') &&
      !l.startsWith('proposed') && !l.startsWith('blocked') && !l.startsWith('draft') && l !== 'spike-complete'
    )
  },
}

export function DecisionsScreen() {
  const [decisions, setDecisions] = useState<Array<DecisionMeta>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exists, setExists] = useState(true)

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showInternal, setShowInternal] = useState(false)
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null)

  function load(withInternal: boolean) {
    setLoading(true)
    setError(null)
    void fetch(`/api/decisions/list${withInternal ? '?includeInternal=1' : ''}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as ListResponse
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<ListResponse>
      })
      .then((data) => {
        setDecisions(data.decisions ?? [])
        setExists(data.exists ?? true)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load decisions')
        setLoading(false)
      })
  }

  useEffect(() => {
    load(showInternal)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInternal])

  const filtered = useMemo(() => {
    let list = decisions

    // Status filter
    const matcher = STATUS_GROUPS[statusFilter]
    list = list.filter((d) => matcher(d.status))

    // Search
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.filename.toLowerCase().includes(q) ||
          d.tags.some((t) => t.toLowerCase().includes(q)) ||
          (d.type?.toLowerCase().includes(q) ?? false),
      )
    }

    // Sort
    if (sortKey === 'date') {
      list = [...list].sort((a, b) => {
        const ad = a.date ?? a.filename
        const bd = b.date ?? b.filename
        return bd.localeCompare(ad)
      })
    } else if (sortKey === 'status') {
      const order: Record<string, number> = { completed: 0, decided: 0, approved: 0, done: 0, live: 0, 'in-progress': 1, proposed: 2, blocked: 3, draft: 4 }
      list = [...list].sort((a, b) => {
        const ao = order[a.status?.toLowerCase() ?? ''] ?? 5
        const bo = order[b.status?.toLowerCase() ?? ''] ?? 5
        if (ao !== bo) return ao - bo
        return (b.date ?? b.filename).localeCompare(a.date ?? a.filename)
      })
    }

    return list
  }, [decisions, search, statusFilter, sortKey])

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (!exists) {
    return (
      <div className="p-6 text-sm text-primary-400">
        Decisions directory not found at{' '}
        <code className="text-xs">~/Obsidian/Henry/AI Infrastructure/decisions/</code>.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 gap-0">
      {/* ── Left panel: list ──────────────────────────────────────────────────── */}
      <div
        className={[
          'flex flex-col min-h-0 border-r border-primary-200 dark:border-primary-800 shrink-0',
          selectedFilename ? 'w-80' : 'flex-1',
        ].join(' ')}
      >
        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-primary-200 dark:border-primary-800 flex flex-col gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <input
              type="search"
              placeholder="Search titles, tags…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-0 rounded-md border border-primary-300 bg-white px-3 py-1.5 text-sm text-ink placeholder:text-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400 dark:border-primary-700 dark:bg-primary-900 dark:text-ink"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="shrink-0 rounded-md border border-primary-300 bg-white px-2 py-1.5 text-xs text-ink dark:border-primary-700 dark:bg-primary-900 focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              <option value="date">Date ↓</option>
              <option value="status">Status</option>
            </select>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {(['all', 'completed', 'in-progress', 'proposed', 'blocked', 'other'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={[
                  'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                  statusFilter === s
                    ? 'bg-primary-700 text-white dark:bg-primary-400 dark:text-primary-900'
                    : 'bg-primary-100 text-primary-600 hover:bg-primary-200 dark:bg-primary-800 dark:text-primary-300 dark:hover:bg-primary-700',
                ].join(' ')}
              >
                {s}
              </button>
            ))}

            <label className="ml-auto flex items-center gap-1.5 text-xs text-primary-500 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={showInternal}
                onChange={(e) => setShowInternal(e.target.checked)}
                className="rounded"
              />
              show internal-only
            </label>
          </div>
        </div>

        {/* Count */}
        {!loading && !error && (
          <p className="px-4 pt-2 pb-1 text-xs text-primary-400 shrink-0">
            {filtered.length} of {decisions.length} decision{decisions.length !== 1 ? 's' : ''}
          </p>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {loading && (
            <div className="flex flex-col gap-2 animate-pulse">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-16 rounded-lg bg-primary-100/60 dark:bg-primary-800/40" />
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <p className="font-medium mb-1">Failed to load decisions</p>
              <p className="text-xs opacity-80">{error}</p>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <p className="text-sm text-primary-400 py-4">
              No decisions match the current filters.
            </p>
          )}

          {!loading && !error && (
            <div className="flex flex-col gap-1.5 pb-4">
              {filtered.map((d) => (
                <DecisionCard
                  key={d.filename}
                  decision={d}
                  isSelected={selectedFilename === d.filename}
                  onClick={() =>
                    setSelectedFilename(
                      selectedFilename === d.filename ? null : d.filename,
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel: detail ───────────────────────────────────────────────── */}
      {selectedFilename && (
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <DecisionDetail
            filename={selectedFilename}
            onClose={() => setSelectedFilename(null)}
          />
        </div>
      )}
    </div>
  )
}
