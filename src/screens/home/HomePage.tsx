/**
 * HomePage — calm landing page.
 *
 * Layout:
 *  ┌──────────────────────────────┬──────────────────────┐
 *  │ ChatPane (~⅔ height)         │ ApprovalsCard         │
 *  │                              │ MilestonesCard        │
 *  │                              │ MeetingsCard          │
 *  │                              │ BriefingCard          │
 *  ├──────────────────────────────┴──────────────────────┤
 *  │ FlowStrip (~⅓ height, full width below chat)        │
 *  └─────────────────────────────────────────────────────┘
 *
 * The right rail is ~25% width; left area takes remaining 75%.
 */

import { ChatPane } from './ChatPane'
import { FlowStrip } from './FlowStrip'
import { ApprovalsCard } from './right-rail/ApprovalsCard'
import { MilestonesCard } from './right-rail/MilestonesCard'
import { MeetingsCard } from './right-rail/MeetingsCard'
import { BriefingCard } from './right-rail/BriefingCard'

export function HomePage() {
  return (
    <div className="home-page">
      {/* Main two-column split */}
      <div className="home-main">
        {/* Left column: chat + flow strip */}
        <div className="home-left">
          <div className="home-chat-area">
            <ChatPane />
          </div>
          <div className="home-flow-area">
            <FlowStrip />
          </div>
        </div>

        {/* Right rail: 4 cards */}
        <aside className="home-right-rail">
          <ApprovalsCard />
          <MilestonesCard />
          <MeetingsCard />
          <BriefingCard />
        </aside>
      </div>
    </div>
  )
}
