/**
 * Cockpit store — pane layout state for the /build page.
 * Persisted to localStorage keyed by tenant.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type PaneType = 'cc' | 'hermes' | 'voice' | 'flow'

export type PaneState = {
  id: string
  type: PaneType
  /** CC pane: which account partition to use */
  accountKey?: string
  /** CC pane: linked terminal session id (server-side) */
  sessionId?: string
  /** Hermes pane: profile key */
  profileKey?: string
  /** Flow pane: filter by this pane id */
  flowPaneId?: string
  /** 1M long-context mode — requires billing tier */
  longContext: boolean
  /** Working directory for CC pane */
  workdir?: string
}

function generateId(): string {
  return `pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function makeDefaultPane(): PaneState {
  return { id: generateId(), type: 'cc', longContext: false }
}

type CockpitStore = {
  /** 1–6 panes */
  count: number
  panes: Array<PaneState>
  addPane: () => void
  removePane: (id: string) => void
  updatePane: (id: string, patch: Partial<Omit<PaneState, 'id'>>) => void
  setCount: (n: number) => void
}

// Derive tenant from hostname for multi-tenant localStorage key
function getTenantKey(): string {
  if (typeof window === 'undefined') return 'default'
  const hostname = window.location.hostname
  // e.g. henry.atc.berl.ai → henry, atc-dev.berl.ai → atc-dev
  const parts = hostname.split('.')
  return parts[0] ?? 'default'
}

export const useCockpitStore = create<CockpitStore>()(
  persist(
    (set, get) => ({
      count: 1,
      panes: [makeDefaultPane()],

      addPane() {
        const { count, panes } = get()
        if (count >= 6) return
        const next = count + 1
        const newPane = makeDefaultPane()
        set({ count: next, panes: [...panes, newPane] })
      },

      removePane(id) {
        const { count, panes } = get()
        if (count <= 1) return
        const next = count - 1
        set({ count: next, panes: panes.filter((p) => p.id !== id) })
      },

      updatePane(id, patch) {
        const { panes } = get()
        set({
          panes: panes.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })
      },

      setCount(n) {
        const clamped = Math.max(1, Math.min(6, n))
        const { panes } = get()
        let next = [...panes]
        while (next.length < clamped) next.push(makeDefaultPane())
        next = next.slice(0, clamped)
        set({ count: clamped, panes: next })
      },
    }),
    {
      name: `cockpit-layout-${getTenantKey()}`,
    },
  ),
)
