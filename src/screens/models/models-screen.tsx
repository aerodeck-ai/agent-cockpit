/**
 * ModelsScreen — two tabs
 *  • "Routing rules" — per-profile model editor (tier-annotated)
 *  • "Cost by model" — sortable 7-day aggregate table from harness.db
 */
import { useEffect, useState, useCallback } from 'react'

// ─── Tier metadata ────────────────────────────────────────────────────────────

export const TIER_LABELS: Record<string, string> = {
  'top-thought': 'Top-thought',
  specialist: 'Specialist',
  classifier: 'Classifier',
  voice: 'Voice',
  embed: 'Embed',
}

// Recommended model sets per tier (from model-allocation-audit-2026-05-12)
const TIER_MODELS: Record<string, string[]> = {
  'top-thought': ['claude-opus-4-5', 'gpt-4o', 'gemini-2.5-pro', 'gpt-5.5'],
  specialist: ['claude-sonnet-4-5', 'gemini-2.5-flash', 'gpt-4o-mini', 'gpt-5.3-codex'],
  classifier: ['claude-haiku-4-5', 'gemini-flash-lite', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b:free'],
  voice: ['whisper-1', 'tts-1', 'tts-1-hd'],
  embed: ['bge-m3', 'mxbai-embed-large', 'voyage-3-large', 'text-embedding-ada-002'],
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ProfileModelEntry = {
  profile: string
  model: string | null
  provider: string | null
  cost_cap_usd_daily: number | null
}

type CostRow = {
  model_used: string
  calls_7d: number
  tokens_7d: number
  total_cost_7d: number
  top_caller_profile: string | null
}

type SortKey = keyof Omit<CostRow, 'top_caller_profile'>
type SortDir = 'asc' | 'desc'

// ─── Routing rules tab ───────────────────────────────────────────────────────

function RoutingRulesTab({ canEdit }: { canEdit: boolean }) {
  const [profiles, setProfiles] = useState<ProfileModelEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null) // profile being saved
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})

  const showToast = (message: string, ok: boolean) => {
    setToast({ message, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/models/profiles')
      const data = (await res.json()) as { ok: boolean; profiles: ProfileModelEntry[]; error?: string }
      if (!data.ok) throw new Error(data.error ?? 'Failed to load profiles')
      setProfiles(data.profiles)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleSave = async (profile: string) => {
    const newModel = edits[profile]
    if (!newModel) return
    setSaving(profile)
    try {
      const res = await fetch('/api/models/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, model: newModel }),
      })
      const data = (await res.json()) as {
        ok: boolean
        restart?: { ok: boolean; output: string }
        error?: string
      }
      if (!data.ok) throw new Error(data.error ?? 'Write failed')
      const restartMsg = data.restart?.ok
        ? 'gateway restarted'
        : `gateway restart skipped: ${data.restart?.output?.slice(0, 80) ?? 'n/a'}`
      showToast(`${profile}: model updated, ${restartMsg}`, true)
      setEdits((prev) => { const n = { ...prev }; delete n[profile]; return n })
      void load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), false)
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-primary-400">Loading profiles…</div>
  }
  if (error) {
    return <div className="py-8 text-center text-sm text-red-500">{error}</div>
  }

  return (
    <div className="space-y-3">
      {toast && (
        <div
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            toast.ok ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-primary-200 dark:border-neutral-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-primary-200 bg-primary-50/60 dark:border-neutral-700 dark:bg-neutral-800/60">
              <th className="px-4 py-2 text-left font-medium text-primary-600 dark:text-neutral-400">Profile</th>
              <th className="px-4 py-2 text-left font-medium text-primary-600 dark:text-neutral-400">Current model</th>
              <th className="px-4 py-2 text-left font-medium text-primary-600 dark:text-neutral-400">Daily cap (USD)</th>
              {canEdit && (
                <th className="px-4 py-2 text-left font-medium text-primary-600 dark:text-neutral-400">New model</th>
              )}
              {canEdit && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const editVal = edits[p.profile]
              const isDirty = editVal !== undefined && editVal !== (p.model ?? '')
              return (
                <tr
                  key={p.profile}
                  className="border-b border-primary-100 last:border-0 dark:border-neutral-800 hover:bg-primary-50/40 dark:hover:bg-neutral-800/40 transition-colors"
                >
                  <td className="px-4 py-2 font-mono text-xs font-medium text-ink">{p.profile}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-mono ${
                      p.model === 'gpt-5.5'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                        : 'bg-primary-100 text-primary-700 dark:bg-neutral-700 dark:text-neutral-200'
                    }`}>
                      {p.model ?? '(unset)'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-primary-500 dark:text-neutral-400">
                    {p.cost_cap_usd_daily != null ? `$${p.cost_cap_usd_daily}` : '—'}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2">
                      <TierModelPicker
                        value={editVal ?? p.model ?? ''}
                        onChange={(v) => setEdits((prev) => ({ ...prev, [p.profile]: v }))}
                      />
                    </td>
                  )}
                  {canEdit && (
                    <td className="px-4 py-2">
                      <button
                        onClick={() => { void handleSave(p.profile) }}
                        disabled={!isDirty || saving === p.profile}
                        className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                          isDirty && saving !== p.profile
                            ? 'bg-primary-500 text-white hover:bg-primary-600'
                            : 'cursor-not-allowed bg-primary-100 text-primary-300 dark:bg-neutral-700 dark:text-neutral-500'
                        }`}
                      >
                        {saving === p.profile ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Tier legend */}
      <div className="mt-4 rounded-lg border border-primary-200 bg-primary-50/40 p-4 dark:border-neutral-700 dark:bg-neutral-800/30">
        <p className="mb-2 text-xs font-semibold text-primary-600 dark:text-neutral-400">Tier recommendations (model-allocation-audit-2026-05-12)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {Object.entries(TIER_LABELS).map(([tier, label]) => (
            <div key={tier} className="space-y-1">
              <p className="text-xs font-medium text-ink">{label}</p>
              {TIER_MODELS[tier]?.map((m) => (
                <p key={m} className="text-xs font-mono text-primary-500 dark:text-neutral-400">{m}</p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TierModelPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const allModels = Object.values(TIER_MODELS).flat()
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="model id"
        className="w-44 rounded border border-primary-200 bg-surface px-2 py-1 text-xs font-mono text-ink focus:outline-none focus:ring-1 focus:ring-primary-400 dark:border-neutral-700"
        list="tier-models-datalist"
      />
      <datalist id="tier-models-datalist">
        {allModels.map((m) => <option key={m} value={m} />)}
      </datalist>
    </div>
  )
}

// ─── Cost by model tab ────────────────────────────────────────────────────────

function CostByModelTab() {
  const [rows, setRows] = useState<CostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cachedAt, setCachedAt] = useState<number | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('total_cost_7d')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/models/cost')
      const data = (await res.json()) as { ok: boolean; rows: CostRow[]; cachedAt: number; error?: string }
      if (!data.ok) throw new Error(data.error ?? 'Failed to load cost data')
      setRows(data.rows)
      setCachedAt(data.cachedAt)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const va = a[sortKey]
    const vb = b[sortKey]
    if (typeof va === 'string' && typeof vb === 'string') {
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    }
    const na = Number(va)
    const nb = Number(vb)
    return sortDir === 'asc' ? na - nb : nb - na
  })

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (
      <span className="ml-1 text-primary-500">{sortDir === 'asc' ? '↑' : '↓'}</span>
    ) : (
      <span className="ml-1 text-primary-300">↕</span>
    )

  if (loading) return <div className="py-8 text-center text-sm text-primary-400">Loading cost data…</div>
  if (error) return <div className="py-8 text-center text-sm text-red-500">{error}</div>
  if (rows.length === 0) {
    return <div className="py-8 text-center text-sm text-primary-400">No LLM calls in the last 7 days.</div>
  }

  return (
    <div className="space-y-3">
      {cachedAt && (
        <p className="text-xs text-primary-400">
          Data cached at {new Date(cachedAt).toLocaleTimeString()} — refreshes every 60s
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-primary-200 dark:border-neutral-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-primary-200 bg-primary-50/60 dark:border-neutral-700 dark:bg-neutral-800/60">
              <th
                className="cursor-pointer px-4 py-2 text-left font-medium text-primary-600 dark:text-neutral-400 hover:text-ink"
                onClick={() => handleSort('model_used')}
              >
                Model <SortIcon k="model_used" />
              </th>
              <th
                className="cursor-pointer px-4 py-2 text-right font-medium text-primary-600 dark:text-neutral-400 hover:text-ink"
                onClick={() => handleSort('calls_7d')}
              >
                Calls (7d) <SortIcon k="calls_7d" />
              </th>
              <th
                className="cursor-pointer px-4 py-2 text-right font-medium text-primary-600 dark:text-neutral-400 hover:text-ink"
                onClick={() => handleSort('tokens_7d')}
              >
                Tokens (7d) <SortIcon k="tokens_7d" />
              </th>
              <th
                className="cursor-pointer px-4 py-2 text-right font-medium text-primary-600 dark:text-neutral-400 hover:text-ink"
                onClick={() => handleSort('total_cost_7d')}
              >
                Cost (7d) <SortIcon k="total_cost_7d" />
              </th>
              <th className="px-4 py-2 text-left font-medium text-primary-600 dark:text-neutral-400">Top caller</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.model_used}
                className="border-b border-primary-100 last:border-0 dark:border-neutral-800 hover:bg-primary-50/40 dark:hover:bg-neutral-800/40 transition-colors"
              >
                <td className="px-4 py-2 font-mono text-xs font-medium text-ink">{row.model_used}</td>
                <td className="px-4 py-2 text-right text-xs text-primary-600 dark:text-neutral-300">{row.calls_7d.toLocaleString()}</td>
                <td className="px-4 py-2 text-right text-xs text-primary-600 dark:text-neutral-300">{row.tokens_7d.toLocaleString()}</td>
                <td className="px-4 py-2 text-right text-xs font-semibold text-ink">
                  ${row.total_cost_7d.toFixed(4)}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-primary-500 dark:text-neutral-400">
                  {row.top_caller_profile ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function ModelsScreen({ canEdit = false }: { canEdit?: boolean }) {
  const [tab, setTab] = useState<'routing' | 'cost'>('routing')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Model Control</h1>
        <p className="mt-1 text-sm text-primary-500 dark:text-neutral-400">
          Tier-aware routing rules and 7-day cost breakdown per model.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-primary-200 bg-primary-50/85 p-1 backdrop-blur-xl dark:border-neutral-700 dark:bg-neutral-800/60">
        <button
          onClick={() => setTab('routing')}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'routing'
              ? 'bg-primary-100 text-ink shadow-sm dark:bg-neutral-800'
              : 'text-primary-500 hover:text-ink'
          }`}
        >
          Routing rules
        </button>
        <button
          onClick={() => setTab('cost')}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'cost'
              ? 'bg-primary-100 text-ink shadow-sm dark:bg-neutral-800'
              : 'text-primary-500 hover:text-ink'
          }`}
        >
          Cost by model
        </button>
      </div>

      {tab === 'routing' ? <RoutingRulesTab canEdit={canEdit} /> : <CostByModelTab />}
    </div>
  )
}
