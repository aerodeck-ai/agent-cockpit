/**
 * /flow/loop — 7-stage God Mode execution spine.
 * The OG /flow content. Demoted to /flow/loop on 2026-05-17 when /flow
 * was given to the Graphify-derived topology view (S3 brief).
 *
 * Wired to hermes_findings via /api/flow/events (SSE + JSON fallback).
 */
import { createFileRoute } from '@tanstack/react-router'
import LiveFlowHome from '@/screens/flow/LiveFlowHome'

export const Route = createFileRoute('/flow/loop')({
  ssr: false,
  component: FlowLoopPage,
})

function FlowLoopPage() {
  return <LiveFlowHome />
}
