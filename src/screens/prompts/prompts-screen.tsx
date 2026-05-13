import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  ArrowLeft01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Delete02Icon,
  Edit02Icon,
  FileEditIcon,
  Search01Icon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons'
import MonacoEditor from '@monaco-editor/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type PromptRow = {
  id: number
  name: string
  current_version: number
  created_at: string
  created_by: string | null
  body: string
  profile: string | null
  assigned_version: number | null
}

type AssignmentRow = {
  profile: string
  prompt_id: number
  version: number
  assigned_at: string
  assigned_by: string | null
}

type VersionRow = {
  version: number
  body: string
  committed_at: string
  committed_by: string | null
  notes: string | null
}

type PromptsData = {
  prompts: PromptRow[]
  assignments: AssignmentRow[]
  tenant: string
  readonly: boolean
}

type PromptDetail = {
  prompt: Omit<PromptRow, 'body' | 'profile' | 'assigned_version'>
  versions: VersionRow[]
  assignment: AssignmentRow | null
}

// ─────────────────────────────────────────────────────────────
// Fetch helpers
// ─────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(parsed))
}

// ─────────────────────────────────────────────────────────────
// Simple inline diff renderer (no external lib)
// ─────────────────────────────────────────────────────────────

function SimpleDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const maxLen = Math.max(oldLines.length, newLines.length)
  const rows: { type: 'same' | 'add' | 'remove' | 'change'; old: string; new: string; i: number }[] = []

  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i] ?? ''
    const n = newLines[i] ?? ''
    if (o === n) {
      rows.push({ type: 'same', old: o, new: n, i })
    } else if (i >= oldLines.length) {
      rows.push({ type: 'add', old: '', new: n, i })
    } else if (i >= newLines.length) {
      rows.push({ type: 'remove', old: o, new: '', i })
    } else {
      rows.push({ type: 'change', old: o, new: n, i })
    }
  }

  // Only show changed lines + ±2 context
  const changedIndexes = new Set(rows.filter(r => r.type !== 'same').map(r => r.i))
  const showIndexes = new Set<number>()
  changedIndexes.forEach(i => {
    for (let j = Math.max(0, i - 2); j <= Math.min(maxLen - 1, i + 2); j++) {
      showIndexes.add(j)
    }
  })

  if (showIndexes.size === 0) {
    return <p className="text-sm text-primary-400">No differences</p>
  }

  const sortedIndexes = Array.from(showIndexes).sort((a, b) => a - b)
  const result: React.ReactNode[] = []
  let prevIdx = -1

  sortedIndexes.forEach(i => {
    if (prevIdx !== -1 && i > prevIdx + 1) {
      result.push(
        <div key={`ellipsis-${i}`} className="py-0.5 px-3 text-xs text-primary-400">
          ···
        </div>
      )
    }
    prevIdx = i
    const row = rows[i]!
    if (row.type === 'same') {
      result.push(
        <div key={`same-${i}`} className="flex gap-0 font-mono text-xs leading-5">
          <span className="w-8 shrink-0 select-none text-right pr-2 text-primary-400">{i + 1}</span>
          <span className="w-full px-2">{row.old || ' '}</span>
        </div>
      )
    } else if (row.type === 'remove' || row.type === 'change') {
      result.push(
        <div key={`remove-${i}`} className="flex gap-0 font-mono text-xs leading-5 bg-red-950/30 text-red-300">
          <span className="w-8 shrink-0 select-none text-right pr-2 text-red-400">{i + 1}</span>
          <span className="px-2 w-3 shrink-0">−</span>
          <span className="w-full px-1">{row.old || ' '}</span>
        </div>
      )
    }
    if (row.type === 'add' || row.type === 'change') {
      result.push(
        <div key={`add-${i}`} className="flex gap-0 font-mono text-xs leading-5 bg-green-950/30 text-green-300">
          <span className="w-8 shrink-0 select-none text-right pr-2 text-green-400">{i + 1}</span>
          <span className="px-2 w-3 shrink-0">+</span>
          <span className="w-full px-1">{row.new || ' '}</span>
        </div>
      )
    }
  })

  return (
    <div className="rounded-md border border-primary-200 bg-neutral-950 dark:border-neutral-700 overflow-auto max-h-60 text-xs">
      {result}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Library tab
// ─────────────────────────────────────────────────────────────

function LibraryTab({
  prompts,
  assignments,
  readonly,
  onSelectPrompt,
  onCreatePrompt,
}: {
  prompts: PromptRow[]
  assignments: AssignmentRow[]
  readonly: boolean
  onSelectPrompt: (id: number) => void
  onCreatePrompt: () => void
}) {
  const [search, setSearch] = useState('')

  const assignmentByPromptId = useMemo(() => {
    const map = new Map<number, AssignmentRow>()
    assignments.forEach(a => map.set(a.prompt_id, a))
    return map
  }, [assignments])

  const filtered = useMemo(() => {
    if (!search.trim()) return prompts
    const q = search.toLowerCase()
    return prompts.filter(p => p.name.toLowerCase().includes(q))
  }, [prompts, search])

  // Group by assigned profile
  const groups = useMemo(() => {
    const map = new Map<string, PromptRow[]>()
    filtered.forEach(p => {
      const key = p.profile ?? 'Unassigned'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    })
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <HugeiconsIcon icon={Search01Icon} size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-primary-400" />
          <Input
            placeholder="Search prompts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        {!readonly && (
          <Button size="sm" onClick={onCreatePrompt}>
            <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
            New
          </Button>
        )}
      </div>

      {groups.length === 0 && (
        <p className="text-sm text-primary-400">No prompts found.</p>
      )}

      {groups.map(([profile, rows]) => (
        <div key={profile} className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary-400">
            <HugeiconsIcon icon={UserMultipleIcon} size={12} />
            {profile}
          </div>
          <div className="space-y-1 pl-4">
            {rows.map(prompt => {
              const asgn = assignmentByPromptId.get(prompt.id)
              return (
                <button
                  key={prompt.id}
                  onClick={() => onSelectPrompt(prompt.id)}
                  className="flex w-full items-center justify-between rounded-md border border-primary-200 bg-primary-50/50 px-3 py-2 text-left text-sm hover:bg-primary-100 dark:border-neutral-700 dark:bg-neutral-800/50 dark:hover:bg-neutral-800 transition-colors"
                >
                  <span className="font-medium text-ink">{prompt.name}</span>
                  <div className="flex items-center gap-3 text-xs text-primary-400">
                    <span className="flex items-center gap-1">
                      <HugeiconsIcon icon={Clock01Icon} size={11} />
                      v{prompt.current_version}
                    </span>
                    {asgn && (
                      <span className="flex items-center gap-1 text-emerald-500">
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} />
                        assigned
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Editor tab
// ─────────────────────────────────────────────────────────────

function EditorTab({
  prompts,
  readonly,
  initialPromptId,
  onSaved,
}: {
  prompts: PromptRow[]
  readonly: boolean
  initialPromptId?: number
  onSaved?: () => void
}) {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(initialPromptId ?? null)
  const [editorContent, setEditorContent] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [showDiff, setShowDiff] = useState(false)

  const { data: detail, isLoading } = useQuery<PromptDetail>({
    queryKey: ['prompt-detail', selectedId],
    queryFn: () => apiFetch<PromptDetail>(`/api/prompts/${selectedId}`),
    enabled: selectedId !== null,
  })

  useEffect(() => {
    if (detail) {
      const currentVersion = detail.versions.find(v => v.version === detail.prompt.current_version)
      setEditorContent(currentVersion?.body ?? '')
      setNotes('')
    }
  }, [detail])

  const currentVersionBody = useMemo(() => {
    if (!detail) return ''
    return detail.versions.find(v => v.version === detail.prompt.current_version)?.body ?? ''
  }, [detail])

  const previousVersionBody = useMemo(() => {
    if (!detail || detail.versions.length < 2) return null
    const sorted = [...detail.versions].sort((a, b) => b.version - a.version)
    return sorted[1]?.body ?? null
  }, [detail])

  const hasChanges = editorContent !== currentVersionBody

  const handleSave = async () => {
    if (!selectedId || !hasChanges || saving) return
    setSaving(true)
    try {
      await apiFetch('/api/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, body: editorContent, notes: notes.trim() || undefined }),
      })
      await qc.invalidateQueries({ queryKey: ['prompts'] })
      await qc.invalidateQueries({ queryKey: ['prompt-detail', selectedId] })
      toast.success('New version saved')
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const isDark = typeof document !== 'undefined'
    ? !document.documentElement.classList.contains('light')
    : true

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={selectedId ?? ''}
          onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : null)}
          className="rounded-md border border-primary-200 bg-surface px-3 py-2 text-sm text-ink dark:border-neutral-700"
        >
          <option value="">— Select a prompt —</option>
          {prompts.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {detail && (
          <span className="text-xs text-primary-400">
            v{detail.prompt.current_version} · {detail.versions.length} version{detail.versions.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {selectedId && isLoading && (
        <p className="text-sm text-primary-400">Loading…</p>
      )}

      {detail && (
        <>
          {/* Version history */}
          {detail.versions.length > 0 && (
            <div className="rounded-md border border-primary-200 dark:border-neutral-700 overflow-hidden">
              <div className="flex items-center justify-between bg-primary-50/50 px-3 py-2 dark:bg-neutral-800/50">
                <span className="text-xs font-medium text-primary-400">Version history</span>
                {previousVersionBody && (
                  <button
                    onClick={() => setShowDiff(!showDiff)}
                    className="text-xs text-primary-500 hover:text-ink transition-colors"
                  >
                    {showDiff ? 'Hide diff' : 'Show diff vs prev'}
                  </button>
                )}
              </div>
              <div className="divide-y divide-primary-100 dark:divide-neutral-700/50 max-h-40 overflow-y-auto">
                {detail.versions.map(v => (
                  <div key={v.version} className="flex items-start gap-3 px-3 py-2">
                    <span className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-xs font-mono',
                      v.version === detail.prompt.current_version
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-primary-100 text-primary-500 dark:bg-neutral-700 dark:text-primary-400'
                    )}>
                      v{v.version}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-primary-400">{formatDate(v.committed_at)}</p>
                      {v.notes && <p className="mt-0.5 text-xs text-ink">{v.notes}</p>}
                    </div>
                    <button
                      onClick={() => setEditorContent(v.body)}
                      className="shrink-0 text-xs text-primary-500 hover:text-ink transition-colors"
                    >
                      Load
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Diff */}
          {showDiff && previousVersionBody && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-primary-400">Diff: previous → current</p>
              <SimpleDiff oldText={previousVersionBody} newText={currentVersionBody} />
            </div>
          )}

          {/* Monaco editor */}
          {!readonly && (
            <div className="rounded-md border border-primary-200 dark:border-neutral-700 overflow-hidden" style={{ height: 420 }}>
              <MonacoEditor
                height="420px"
                defaultLanguage="markdown"
                value={editorContent}
                onChange={v => setEditorContent(v ?? '')}
                theme={isDark ? 'vs-dark' : 'light'}
                options={{
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  fontSize: 13,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                }}
              />
            </div>
          )}

          {readonly && (
            <pre className="max-h-[420px] overflow-auto rounded-md border border-primary-200 bg-neutral-900 p-3 text-xs text-ink dark:border-neutral-700 whitespace-pre-wrap">
              {currentVersionBody}
            </pre>
          )}

          {/* Save bar */}
          {!readonly && (
            <div className="flex items-center gap-3">
              <Input
                placeholder="Version notes (optional)"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="flex-1"
              />
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!hasChanges || saving}
              >
                {saving ? 'Saving…' : 'Save new version'}
              </Button>
              {hasChanges && (
                <button
                  onClick={() => setEditorContent(currentVersionBody)}
                  className="text-xs text-primary-400 hover:text-ink"
                >
                  Reset
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Assignment tab
// ─────────────────────────────────────────────────────────────

const KNOWN_PROFILES = [
  'ares', 'berlos', 'chief-orchestrator', 'code-reviewer', 'default',
  'henry-personal', 'hermes-auditor', 'infra-watcher', 'jiddlers', 'mally',
  'mally-second', 'miranda', 'opportunity-scanner', 'vectos', 'work-ops',
  'worker', 'yt-route-supervisor', 'yt-strategist',
]

function AssignmentTab({
  prompts,
  assignments,
  readonly,
}: {
  prompts: PromptRow[]
  assignments: AssignmentRow[]
  readonly: boolean
}) {
  const qc = useQueryClient()
  const [assigning, setAssigning] = useState<string | null>(null)
  const [selections, setSelections] = useState<Record<string, { promptId: number; version: number }>>({})

  const assignmentByProfile = useMemo(() => {
    const map = new Map<string, AssignmentRow>()
    assignments.forEach(a => map.set(a.profile, a))
    return map
  }, [assignments])

  const promptById = useMemo(() => {
    const map = new Map<number, PromptRow>()
    prompts.forEach(p => map.set(p.id, p))
    return map
  }, [prompts])

  const getPromptVersions = async (promptId: number) => {
    const detail = await apiFetch<PromptDetail>(`/api/prompts/${promptId}`)
    return detail.versions
  }

  const [versionsByPrompt, setVersionsByPrompt] = useState<Record<number, VersionRow[]>>({})

  const handlePromptChange = async (profile: string, promptId: number) => {
    setSelections(s => ({ ...s, [profile]: { promptId, version: 0 } }))
    if (!versionsByPrompt[promptId]) {
      const versions = await getPromptVersions(promptId)
      setVersionsByPrompt(v => ({ ...v, [promptId]: versions }))
    }
    const versions = versionsByPrompt[promptId] ?? []
    const latestVersion = versions[0]?.version ?? 1
    setSelections(s => ({ ...s, [profile]: { promptId, version: latestVersion } }))
  }

  const handleAssign = async (profile: string) => {
    const sel = selections[profile]
    if (!sel?.promptId || !sel.version) return
    setAssigning(profile)
    try {
      await apiFetch('/api/prompts/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, prompt_id: sel.promptId, version: sel.version }),
      })
      await qc.invalidateQueries({ queryKey: ['prompts'] })
      toast.success(`Assigned to ${profile}`)
      setSelections(s => { const n = { ...s }; delete n[profile]; return n })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Assignment failed')
    } finally {
      setAssigning(null)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-primary-400">
        Each profile can have one assigned prompt (its "SOUL"). Assignments are written to prompts.db only — hot-reload into Hermes is a follow-up integration.
      </p>
      <div className="overflow-hidden rounded-md border border-primary-200 dark:border-neutral-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-primary-200 bg-primary-50/50 dark:border-neutral-700 dark:bg-neutral-800/50">
              <th className="px-4 py-2 text-left text-xs font-medium text-primary-400">Profile</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-primary-400">Current prompt</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-primary-400">Ver</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-primary-400">Assigned</th>
              {!readonly && <th className="px-4 py-2 text-left text-xs font-medium text-primary-400">Re-assign</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-primary-100 dark:divide-neutral-700/50">
            {KNOWN_PROFILES.map(profile => {
              const asgn = assignmentByProfile.get(profile)
              const prompt = asgn ? promptById.get(asgn.prompt_id) : null
              const sel = selections[profile]
              const versions = sel ? (versionsByPrompt[sel.promptId] ?? []) : []

              return (
                <tr key={profile} className="hover:bg-primary-50/30 dark:hover:bg-neutral-800/30 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs text-ink">{profile}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {prompt ? (
                      <span className="text-ink">{prompt.name}</span>
                    ) : (
                      <span className="text-primary-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-primary-400">
                    {asgn ? `v${asgn.version}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-primary-400">
                    {asgn ? formatDate(asgn.assigned_at) : '—'}
                  </td>
                  {!readonly && (
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <select
                          value={sel?.promptId ?? ''}
                          onChange={e => e.target.value && handlePromptChange(profile, Number(e.target.value))}
                          className="rounded border border-primary-200 bg-surface px-2 py-1 text-xs dark:border-neutral-700"
                        >
                          <option value="">Pick prompt…</option>
                          {prompts.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        {sel?.promptId > 0 && (
                          <select
                            value={sel.version}
                            onChange={e => setSelections(s => ({
                              ...s,
                              [profile]: { ...s[profile]!, version: Number(e.target.value) },
                            }))}
                            className="rounded border border-primary-200 bg-surface px-2 py-1 text-xs dark:border-neutral-700"
                          >
                            {versions.map(v => (
                              <option key={v.version} value={v.version}>v{v.version}</option>
                            ))}
                          </select>
                        )}
                        {sel?.promptId > 0 && sel.version > 0 && (
                          <Button
                            size="sm"
                            onClick={() => handleAssign(profile)}
                            disabled={assigning === profile}
                          >
                            {assigning === profile ? '…' : 'Assign'}
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Create Prompt Dialog
// ─────────────────────────────────────────────────────────────

function CreatePromptDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: number) => void
}) {
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  const isDark = typeof document !== 'undefined'
    ? !document.documentElement.classList.contains('light')
    : true

  const handleCreate = async () => {
    if (!name.trim() || !body.trim() || saving) return
    setSaving(true)
    try {
      const result = await apiFetch<{ ok: boolean; id: number }>('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), body }),
      })
      toast.success(`Prompt "${name}" created`)
      onCreated(result.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl border border-primary-200 bg-surface p-5 shadow-2xl dark:border-neutral-700"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">New Prompt</h2>
          <button onClick={onClose} className="text-primary-400 hover:text-ink">
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
        </div>
        <div className="space-y-3">
          <Input
            placeholder="Prompt name (e.g. henry-personal)"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <div className="rounded-md border border-primary-200 dark:border-neutral-700 overflow-hidden" style={{ height: 320 }}>
            <MonacoEditor
              height="320px"
              defaultLanguage="markdown"
              value={body}
              onChange={v => setBody(v ?? '')}
              theme={isDark ? 'vs-dark' : 'light'}
              options={{ minimap: { enabled: false }, wordWrap: 'on', fontSize: 13, scrollBeyondLastLine: false }}
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={!name.trim() || !body.trim() || saving}>
              {saving ? 'Creating…' : 'Create prompt'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Main PromptsScreen
// ─────────────────────────────────────────────────────────────

type TabName = 'library' | 'editor' | 'assignments'

export function PromptsScreen({
  tab,
  onTabChange,
}: {
  tab: TabName
  onTabChange: (tab: TabName) => void
}) {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [editorPromptId, setEditorPromptId] = useState<number | undefined>()

  const { data, isLoading, error } = useQuery<PromptsData>({
    queryKey: ['prompts'],
    queryFn: () => apiFetch<PromptsData>('/api/prompts'),
    staleTime: 30_000,
  })

  const readonly = data?.readonly ?? false

  const handleSelectPrompt = (id: number) => {
    setEditorPromptId(id)
    onTabChange('editor')
  }

  const handleCreated = (id: number) => {
    qc.invalidateQueries({ queryKey: ['prompts'] })
    setShowCreate(false)
    setEditorPromptId(id)
    onTabChange('editor')
  }

  if (isLoading) {
    return <p className="text-sm text-primary-400">Loading prompts…</p>
  }

  if (error) {
    return <p className="text-sm text-red-400">{error instanceof Error ? error.message : 'Error loading prompts'}</p>
  }

  const prompts = data?.prompts ?? []
  const assignments = data?.assignments ?? []

  return (
    <>
      {tab === 'library' && (
        <LibraryTab
          prompts={prompts}
          assignments={assignments}
          readonly={readonly}
          onSelectPrompt={handleSelectPrompt}
          onCreatePrompt={() => setShowCreate(true)}
        />
      )}
      {tab === 'editor' && (
        <EditorTab
          prompts={prompts}
          readonly={readonly}
          initialPromptId={editorPromptId}
          onSaved={() => qc.invalidateQueries({ queryKey: ['prompts'] })}
        />
      )}
      {tab === 'assignments' && (
        <AssignmentTab
          prompts={prompts}
          assignments={assignments}
          readonly={readonly}
        />
      )}
      {showCreate && (
        <CreatePromptDialog
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </>
  )
}
