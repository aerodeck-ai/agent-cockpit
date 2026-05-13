/**
 * GuardrailsScreen
 *
 * Three-tab panel:
 *   1. Scope filter   — scope_deny_keywords per profile (Henry rw, Mally ro)
 *   2. PII classifier — Haiku-based output redactor toggle + status stub
 *   3. Tirith policy  — read-only table with fail-open risk warnings
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScopeDenyData {
  profiles: Record<string, string[]>
  tenant: string
}

interface PiiClassifierData {
  enabled: boolean
  integration_status: string
  note?: string
}

interface TirithProfile {
  name: string
  tirith_enabled: boolean | null
  tirith_fail_open: boolean | null
  tirith_timeout: number | null
  fail_open_risk: boolean
}

interface TirithData {
  profiles: TirithProfile[]
  risk_summary: { fail_open_count: number; has_risk: boolean }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function BoolCell({ value }: { value: boolean | null }) {
  if (value === null)
    return <span className="text-primary-400 dark:text-neutral-500">—</span>
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        value
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
      )}
    >
      {value ? 'yes' : 'no'}
    </span>
  )
}

// ─── Scope Filter Tab ─────────────────────────────────────────────────────────

function ScopeFilterTab({ isOwner }: { isOwner: boolean }) {
  const [data, setData] = useState<ScopeDenyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [addInputs, setAddInputs] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/guardrails/scope-deny')
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const json = (await res.json()) as ScopeDenyData
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = useCallback(
    async (profile: string, keywords: string[]) => {
      setSaving(profile)
      setSaveMsg(null)
      try {
        const res = await fetch('/api/guardrails/scope-deny', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ profile, keywords }),
        })
        const body = (await res.json()) as { ok?: boolean; error?: string; restart?: { ok: boolean; msg: string } }
        if (!res.ok) throw new Error(body.error ?? `${res.status}`)
        const restartMsg = body.restart?.ok ? 'Gateway restarted.' : `Restart failed: ${body.restart?.msg}`
        setSaveMsg(`Saved. ${restartMsg}`)
        // refresh
        await load()
      } catch (err) {
        setSaveMsg(err instanceof Error ? `Error: ${err.message}` : 'Save failed')
      } finally {
        setSaving(null)
      }
    },
    [load],
  )

  const removeKeyword = (profile: string, kw: string) => {
    if (!data) return
    const current = data.profiles[profile] ?? []
    void save(profile, current.filter((k) => k !== kw))
  }

  const addKeyword = (profile: string) => {
    if (!data) return
    const input = (addInputs[profile] ?? '').trim()
    if (!input) return
    const current = data.profiles[profile] ?? []
    if (current.includes(input)) return
    setAddInputs((prev) => ({ ...prev, [profile]: '' }))
    void save(profile, [...current, input])
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-primary-400">
        Loading scope filters…
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
        {error}
      </div>
    )
  }
  if (!data) return null

  const profiles = Object.keys(data.profiles).sort()

  return (
    <div className="space-y-6">
      {saveMsg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-400">
          {saveMsg}
        </div>
      )}
      {profiles.length === 0 && (
        <p className="text-sm text-primary-400">No profiles found.</p>
      )}
      {profiles.map((profile) => {
        const keywords = data.profiles[profile] ?? []
        const canEdit = isOwner
        return (
          <div
            key={profile}
            className="rounded-xl border border-primary-200 bg-primary-50/50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-mono text-sm font-semibold text-ink">{profile}</h3>
              {!canEdit && (
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  read-only
                </span>
              )}
            </div>

            {/* Keywords chips */}
            <div className="flex flex-wrap gap-2">
              {keywords.length === 0 && (
                <span className="text-xs text-primary-400 italic">No keywords set</span>
              )}
              {keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400"
                >
                  {kw}
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Remove ${kw}`}
                      disabled={saving === profile}
                      onClick={() => removeKeyword(profile, kw)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-red-200 dark:hover:bg-red-900/60 disabled:opacity-40"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>

            {/* Add keyword */}
            {canEdit && (
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  placeholder="Add keyword…"
                  value={addInputs[profile] ?? ''}
                  onChange={(e) =>
                    setAddInputs((prev) => ({ ...prev, [profile]: e.target.value }))
                  }
                  onKeyDown={(e) => e.key === 'Enter' && addKeyword(profile)}
                  className="flex-1 rounded-lg border border-primary-200 bg-white px-3 py-1.5 text-sm text-ink placeholder:text-primary-400 focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-neutral-700 dark:bg-neutral-900 dark:placeholder:text-neutral-500"
                />
                <button
                  type="button"
                  disabled={saving === profile || !(addInputs[profile] ?? '').trim()}
                  onClick={() => addKeyword(profile)}
                  className="rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-40"
                >
                  {saving === profile ? 'Saving…' : 'Add'}
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* Recent denials stub */}
      <RecentDenialsPanel />
    </div>
  )
}

function RecentDenialsPanel() {
  const [rows, setRows] = useState<unknown[] | null>(null)
  const [stub, setStub] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/guardrails/scope-deny?denials=1', { signal: controller.signal })
      .then((r) => r.json())
      .then((data: unknown) => {
        const d = data as { denials?: unknown[]; stub?: boolean }
        if (d?.stub) {
          setStub(true)
        } else {
          setRows(d?.denials ?? [])
        }
      })
      .catch(() => setStub(true))
    return () => controller.abort()
  }, [])

  if (stub || rows === null) {
    return (
      <div className="rounded-xl border border-dashed border-primary-200 bg-primary-50/30 p-4 dark:border-neutral-700 dark:bg-neutral-900/30">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-400">
          Recent denials
        </p>
        <p className="mt-1 text-sm text-primary-400 italic">
          No <code>scope_deny.enforcer</code> events in hermes_findings yet.
          Denied turns will appear here once Hermes populates the source.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50/30 p-4 dark:border-neutral-800 dark:bg-neutral-900/30">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary-400">
        Recent denials ({rows.length})
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-primary-400 italic">None yet.</p>
      ) : (
        <pre className="max-h-40 overflow-auto rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-800">
          {JSON.stringify(rows, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ─── PII Classifier Tab ───────────────────────────────────────────────────────

function PiiClassifierTab({ isOwner }: { isOwner: boolean }) {
  const [data, setData] = useState<PiiClassifierData | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/guardrails/pii-classifier')
      .then((r) => r.json())
      .then((d: unknown) => setData(d as PiiClassifierData))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  const toggle = async () => {
    if (!data || !isOwner) return
    setToggling(true)
    setMsg(null)
    try {
      const res = await fetch('/api/guardrails/pii-classifier', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !data.enabled }),
      })
      const body = (await res.json()) as { ok?: boolean; enabled?: boolean; error?: string }
      if (!res.ok) throw new Error(body.error ?? `${res.status}`)
      setData((prev) => prev ? { ...prev, enabled: body.enabled ?? !prev.enabled } : prev)
      setMsg(body.enabled ? 'PII classifier enabled.' : 'PII classifier disabled.')
    } catch (err) {
      setMsg(err instanceof Error ? `Error: ${err.message}` : 'Toggle failed')
    } finally {
      setToggling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-primary-400">
        Loading PII classifier status…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {msg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-400">
          {msg}
        </div>
      )}

      <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-5 dark:border-neutral-800 dark:bg-neutral-900/50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-ink">PII output classifier</h3>
            <p className="mt-0.5 text-sm text-primary-500 dark:text-neutral-400">
              Haiku-based post-LLM redactor. Scans model output before delivery and
              strips PII (names, emails, phone numbers, financial identifiers).
            </p>
          </div>
          {isOwner ? (
            <button
              type="button"
              disabled={toggling || !data}
              onClick={toggle}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-40',
                data?.enabled
                  ? 'bg-accent-500'
                  : 'bg-neutral-300 dark:bg-neutral-600',
              )}
              aria-label="Toggle PII classifier"
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                  data?.enabled ? 'translate-x-[22px]' : 'translate-x-0.5',
                )}
              />
            </button>
          ) : (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold',
                data?.enabled
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
              )}
            >
              {data?.enabled ? 'Enabled' : 'Disabled'}
            </span>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-900/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Integration status: stub
          </p>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            The Hermes post-LLM hook is not yet wired. This toggle persists the
            flag and surfaces the status — the actual redaction pipeline ships in
            a follow-up PR. See the route docstring for the integration spec.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-primary-200 bg-primary-50/30 p-4 dark:border-neutral-800 dark:bg-neutral-900/30">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-400">
          Classifier script
        </p>
        <p className="mt-1 font-mono text-xs text-primary-500 dark:text-neutral-400">
          ~/mcp-infra/scripts/pii-output-classifier.py
        </p>
        <p className="mt-1 text-xs text-primary-400">
          Takes <code>--text &lt;string&gt;</code>, returns JSON redactions list.
          Calls Claude Haiku for speed. Not yet deployed.
        </p>
      </div>
    </div>
  )
}

// ─── Tirith Policy Tab ────────────────────────────────────────────────────────

function TirithPolicyTab() {
  const [data, setData] = useState<TirithData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/guardrails/tirith')
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json()
      })
      .then((d: unknown) => setData(d as TirithData))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Load failed'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-primary-400">
        Loading Tirith policy…
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
        {error}
      </div>
    )
  }
  if (!data) return null

  const { profiles, risk_summary } = data

  return (
    <div className="space-y-4">
      {risk_summary.has_risk && (
        <div className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 dark:border-orange-800/50 dark:bg-orange-900/20">
          <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">
            ⚠ {risk_summary.fail_open_count} profile
            {risk_summary.fail_open_count > 1 ? 's have' : ' has'}{' '}
            <code>tirith_fail_open: true</code>
          </p>
          <p className="mt-0.5 text-xs text-orange-600 dark:text-orange-400">
            Policy engine crash = bypass — consider tightening to
            <code className="ml-1">tirith_fail_open: false</code> on production profiles.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-primary-200 dark:border-neutral-800">
        <table className="min-w-full divide-y divide-primary-200 text-sm dark:divide-neutral-800">
          <thead className="bg-primary-50 dark:bg-neutral-900">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-primary-700 dark:text-neutral-300">
                Profile
              </th>
              <th className="px-4 py-3 text-left font-semibold text-primary-700 dark:text-neutral-300">
                Tirith enabled
              </th>
              <th className="px-4 py-3 text-left font-semibold text-primary-700 dark:text-neutral-300">
                Fail open
              </th>
              <th className="px-4 py-3 text-left font-semibold text-primary-700 dark:text-neutral-300">
                Timeout (s)
              </th>
              <th className="px-4 py-3 text-left font-semibold text-primary-700 dark:text-neutral-300">
                Risk
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-primary-100 bg-white dark:divide-neutral-800/60 dark:bg-neutral-900/40">
            {profiles.map((p) => (
              <tr
                key={p.name}
                className={cn(
                  'transition-colors',
                  p.fail_open_risk
                    ? 'bg-orange-50/60 dark:bg-orange-900/10'
                    : 'hover:bg-primary-50/50 dark:hover:bg-neutral-800/30',
                )}
              >
                <td className="px-4 py-2.5 font-mono text-xs font-medium text-ink">
                  {p.name}
                </td>
                <td className="px-4 py-2.5">
                  <BoolCell value={p.tirith_enabled} />
                </td>
                <td className="px-4 py-2.5">
                  <BoolCell value={p.tirith_fail_open} />
                </td>
                <td className="px-4 py-2.5 text-xs text-primary-500 dark:text-neutral-400">
                  {p.tirith_timeout ?? '—'}
                </td>
                <td className="px-4 py-2.5">
                  {p.fail_open_risk ? (
                    <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                      ⚠ fail-open
                    </span>
                  ) : (
                    <span className="text-xs text-primary-300 dark:text-neutral-600">—</span>
                  )}
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

type Tab = 'scope' | 'pii' | 'tirith'

export function GuardrailsScreen() {
  const [tab, setTab] = useState<Tab>('scope')
  const [tenant, setTenant] = useState<string | null>(null)

  useEffect(() => {
    // Determine tenant from scope-deny endpoint (returns tenant field)
    fetch('/api/guardrails/scope-deny')
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { tenant?: string }
        setTenant(data?.tenant ?? null)
      })
      .catch(() => setTenant(null))
  }, [])

  const isOwner = tenant === 'henry_cos'

  const tabs: { id: Tab; label: string }[] = [
    { id: 'scope', label: 'Scope filter' },
    { id: 'pii', label: 'PII classifier' },
    { id: 'tirith', label: 'Tirith policy' },
  ]

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Guardrails</h1>
        <p className="mt-1 text-sm text-primary-500 dark:text-neutral-400">
          Scope filters, PII output classification, and Tirith policy configuration.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="mb-5 flex gap-1 rounded-lg border border-primary-200 bg-primary-50/85 p-1 backdrop-blur-xl dark:border-neutral-800 dark:bg-neutral-900/85">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-primary-100 text-ink shadow-sm dark:bg-neutral-800'
                : 'text-primary-500 hover:text-ink dark:text-neutral-400 dark:hover:text-neutral-200',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'scope' && <ScopeFilterTab isOwner={isOwner} />}
      {tab === 'pii' && <PiiClassifierTab isOwner={isOwner} />}
      {tab === 'tirith' && <TirithPolicyTab />}
    </div>
  )
}
