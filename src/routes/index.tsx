/**
 * / — Home page = Flow.
 *
 * Drops the dual ChatPane + FlowStrip layout (the chat composer up top
 * caused a click-send glitch and the flow-strip was a teaser for a view
 * already available at /flow). The homepage now IS the live flow view —
 * one canonical surface for "what's happening right now".
 *
 * /chat is still the chat surface; /flow keeps the same component but
 * a different URL so existing links don't break.
 */

import { createFileRoute } from '@tanstack/react-router'
import LiveFlowHome from '@/screens/flow/LiveFlowHome'

export const Route = createFileRoute('/')({
  ssr: false,
  component: HomeFlow,
})

function HomeFlow() {
  return <LiveFlowHome />
}
