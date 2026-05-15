import type { DecisionMeta } from '@/server/decisions-browser'

type Props = {
  decision: DecisionMeta
  isSelected: boolean
  onClick: () => void
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

function statusColor(status: string | null): string {
  if (!status) return 'text-primary-400'
  const s = status.toLowerCase()
  if (s.startsWith('complet') || s === 'decided' || s === 'approved' || s === 'done' || s === 'live') {
    return 'text-emerald-600 dark:text-emerald-400'
  }
  if (s.startsWith('in-progress') || s.startsWith('proposed') || s.startsWith('ready')) {
    return 'text-amber-600 dark:text-amber-400'
  }
  if (s.startsWith('blocked') || s.startsWith('draft')) {
    return 'text-rose-500 dark:text-rose-400'
  }
  return 'text-primary-400'
}

function statusLabel(status: string | null): string {
  if (!status) return ''
  // Normalise some verbose statuses
  if (status === 'completed-investigation') return 'completed'
  if (status === 'design-proposed') return 'proposed'
  if (status.startsWith('prereq-met')) return 'ready'
  if (status === 'spike-complete') return 'spike done'
  return status
}

export function DecisionCard({ decision, isSelected, onClick }: Props) {
  const { title, date, status, dashboard_surface, last_verified_at, wire_verified, wire_failed, wire_total } = decision

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left rounded-lg border px-4 py-3 transition-colors',
        isSelected
          ? 'border-primary-400 bg-primary-100 dark:border-primary-600 dark:bg-primary-800/60'
          : 'border-primary-200 bg-primary-50/60 hover:border-primary-300 hover:bg-primary-100/70 dark:border-primary-800 dark:bg-primary-900/30 dark:hover:border-primary-700 dark:hover:bg-primary-800/40',
      ].join(' ')}
    >
      <p className="text-sm font-medium text-ink line-clamp-2 text-left">{title}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {date && (
          <span className="text-xs text-primary-400 shrink-0">
            {formatDate(date)}
          </span>
        )}

        {status && (
          <span className={`text-xs font-medium shrink-0 ${statusColor(status)}`}>
            {statusLabel(status)}
          </span>
        )}

        {dashboard_surface && dashboard_surface !== 'internal-only' && (
          <span className="text-xs text-primary-400 truncate shrink-0">
            {dashboard_surface}
          </span>
        )}

        {dashboard_surface === 'internal-only' && (
          <span className="text-xs text-primary-300 dark:text-primary-600 shrink-0">
            internal-only
          </span>
        )}
      </div>

      {(wire_total != null || last_verified_at) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {wire_total != null && wire_total > 0 && (
            <span className="text-xs tabular-nums shrink-0">
              <span className="text-emerald-600 dark:text-emerald-400">
                ✓{wire_verified ?? 0}
              </span>
              {(wire_failed ?? 0) > 0 && (
                <span className="text-rose-500 dark:text-rose-400 ml-1">
                  ✗{wire_failed}
                </span>
              )}
              <span className="text-primary-400 ml-1">wire</span>
            </span>
          )}
          {last_verified_at && (
            <span className="text-xs text-primary-400 shrink-0 truncate">
              verified {formatDate(last_verified_at)}
            </span>
          )}
        </div>
      )}
    </button>
  )
}
