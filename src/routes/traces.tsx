/**
 * /traces — agent execution trace viewer.
 *
 * Tonight (E3 minimum cut): bounces to the Laminar self-hosted UI at
 * live.berl.ai, preserving any ?session= query param as a Laminar session
 * filter.  The full inline /traces panel is Session F.
 *
 * Why redirect: Laminar self-hosted already ships a polished trace viewer
 * with span waterfalls and session grouping.  No need to rebuild it here
 * until we have specific UX gaps to fill.
 *
 * Wired from: send-stream.ts emits chat.turn.start spans with sessionId.
 * View later: live.berl.ai/projects/<project-id>/sessions/<sessionId>
 */
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/traces")({
  beforeLoad: ({ location }) => {
    const url = new URL(location.href, "https://atc.berl.ai")
    const session = url.searchParams.get("session")
    const laminarBase = "https://live.berl.ai"
    if (typeof window !== "undefined") {
      window.location.href = session
        ? `${laminarBase}/?session_id=${encodeURIComponent(session)}`
        : laminarBase
    }
  },
  component: TracesRedirect,
})

function TracesRedirect() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      gap: "1rem",
      color: "var(--theme-text)",
      background: "var(--theme-bg)",
    }}>
      <p>Opening Laminar trace viewer…</p>
      <p style={{fontSize: "0.875rem", opacity: 0.7}}>
        If you are not redirected,{" "}
        <a
          href="https://live.berl.ai"
          style={{color: "var(--theme-accent)"}}
        >
          click here
        </a>.
      </p>
    </div>
  )
}
