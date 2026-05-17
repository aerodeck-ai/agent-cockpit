/**
 * /flow — Graphify-derived topology view (factory floor map).
 * S3 deliverable (2026-05-17). Loads /flow-graph.json (curator output)
 * and renders a React Flow skeleton with degraded source-prefix live overlay.
 *
 * Demo modes (no S2 dep): ?demo=live, ?demo=fail, ?demo=1 (scripted).
 *
 * The OG 7-stage God Mode spine lives at /flow/loop.
 */
import { createFileRoute } from '@tanstack/react-router'
import TopologyHome from '@/screens/flow/TopologyHome'

export const Route = createFileRoute('/flow/')({
  ssr: false,
  component: FlowTopologyPage,
})

function FlowTopologyPage() {
  return <TopologyHome />
}
