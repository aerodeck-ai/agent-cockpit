/**
 * HomePage — calm landing page (D3 re-layout).
 *
 * Right rail removed — counters + popovers now live in LeftNav.
 * Chat fills the full content area (minus LeftNav), FlowStrip below.
 *
 * Layout:
 *  ┌──────────────────────────────────────────────┐
 *  │ ChatPane (~65% height)                        │
 *  ├──────────────────────────────────────────────┤
 *  │ FlowStrip (~35% height)                       │
 *  └──────────────────────────────────────────────┘
 */

import { ChatPane } from './ChatPane'
import { FlowStrip } from './FlowStrip'

export function HomePage() {
  return (
    <div className="home-page">
      <div className="home-main home-main-full">
        <div className="home-left">
          <div className="home-chat-area">
            <ChatPane />
          </div>
          <div className="home-flow-area">
            <FlowStrip />
          </div>
        </div>
      </div>
    </div>
  )
}
