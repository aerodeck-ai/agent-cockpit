/**
 * PaneGrid — [−][N][+] pane count controls + CSS grid layout.
 *
 * Grid templates:
 *   1 → 1fr
 *   2 → 1fr 1fr
 *   3 → 1fr 1fr 1fr
 *   4 → 2×2
 *   5 → 3 over 2 (grid-template-areas)
 *   6 → 3×2
 */
import { useCockpitStore } from '@/stores/cockpit-store'
import { Pane } from './Pane'

const GRID_STYLES: Record<number, React.CSSProperties> = {
  1: { gridTemplateColumns: '1fr' },
  2: { gridTemplateColumns: '1fr 1fr' },
  3: { gridTemplateColumns: '1fr 1fr 1fr' },
  4: {
    gridTemplateColumns: '1fr 1fr',
    gridTemplateRows: '1fr 1fr',
  },
  5: {
    gridTemplateColumns: '1fr 1fr 1fr',
    gridTemplateRows: '1fr 1fr',
    gridTemplateAreas: `
      "p1 p2 p3"
      "p4 p5 p5"
    `,
  },
  6: {
    gridTemplateColumns: '1fr 1fr 1fr',
    gridTemplateRows: '1fr 1fr',
  },
}

function getPaneAreaStyle(index: number, count: number): React.CSSProperties {
  if (count === 5) {
    const areas = ['p1', 'p2', 'p3', 'p4', 'p5']
    return { gridArea: areas[index] }
  }
  return {}
}

export function PaneGrid() {
  const count = useCockpitStore((s) => s.count)
  const panes = useCockpitStore((s) => s.panes)
  const addPane = useCockpitStore((s) => s.addPane)
  const setCount = useCockpitStore((s) => s.setCount)

  function handleDecrement() {
    if (count <= 1) return
    setCount(count - 1)
  }

  function handleIncrement() {
    if (count >= 6) return
    addPane()
  }

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gap: '6px',
    ...GRID_STYLES[count],
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Controls bar */}
      <div className="flex shrink-0 items-center gap-2 px-1">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={count <= 1}
          aria-label="Remove pane"
          className="flex h-7 w-7 items-center justify-center rounded border border-primary-300 bg-primary-100 text-sm font-bold text-primary-700 transition-colors hover:bg-primary-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>

        <div className="flex h-7 items-center rounded border border-primary-300 bg-primary-50 px-3">
          <span className="tabular-nums text-xs font-semibold text-primary-800">
            {count} {count === 1 ? 'pane' : 'panes'}
          </span>
        </div>

        <button
          type="button"
          onClick={handleIncrement}
          disabled={count >= 6}
          aria-label="Add pane"
          className="flex h-7 w-7 items-center justify-center rounded border border-primary-300 bg-primary-100 text-sm font-bold text-primary-700 transition-colors hover:bg-primary-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>

        <span className="ml-2 text-[10px] text-primary-400">
          max 6 · layout auto-flows
        </span>
      </div>

      {/* Pane grid */}
      <div className="min-h-0 flex-1" style={gridStyle}>
        {panes.map((pane, idx) => (
          <div key={pane.id} style={getPaneAreaStyle(idx, count)} className="min-h-0">
            <Pane pane={pane} index={idx} hasActiveSession={!!pane.sessionId} />
          </div>
        ))}
      </div>
    </div>
  )
}
