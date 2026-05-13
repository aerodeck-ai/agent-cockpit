/**
 * /flow — Live execution flow canvas.
 * Ports the ATC ExecutionFlowCanvas 7-stage God Mode visualization
 * and wires it to hermes_findings as the trace event source.
 *
 * /traces still exists as a Laminar redirect for raw trace exploration.
 */
import { createFileRoute } from '@tanstack/react-router'
import LiveFlowHome from '@/screens/flow/LiveFlowHome'

export const Route = createFileRoute('/flow')({
  ssr: false,
  component: FlowPage,
})

function FlowPage() {
  return <LiveFlowHome />
}
