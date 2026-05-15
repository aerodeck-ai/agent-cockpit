/**
 * BuildPage — composition of the /build cockpit page.
 *
 * Layout:
 *   MultiAccountBar (full width top)
 *   ┌ SessionsSidebar (250px) ┬ PaneGrid (flex-1) ┐
 *   └─────────────────────────┴───────────────────┘
 *   FlowStrip (full width bottom)
 */
import { useCockpitStore } from '@/stores/cockpit-store'
import { MultiAccountBar } from './MultiAccountBar'
import { SessionsSidebar } from './SessionsSidebar'
import { PaneGrid } from './PaneGrid'
import { FlowStrip } from './FlowStrip'

export function BuildPage() {
  const panes = useCockpitStore((s) => s.panes)

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-50">
      {/* Account util bar */}
      <MultiAccountBar />

      {/* Main content area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sessions sidebar */}
        <SessionsSidebar />

        {/* Pane grid area */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
          <PaneGrid />
        </div>
      </div>

      {/* Flow strip */}
      <FlowStrip panes={panes} />
    </div>
  )
}
