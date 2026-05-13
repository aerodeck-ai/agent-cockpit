/**
 * Laminar OTEL singleton — wraps the @lmnr-ai/lmnr SDK init.
 *
 * Initialised lazily on first use.  All instrumentation is fire-and-forget:
 * span emission must NEVER block the chat stream.  Errors during emit are
 * caught and logged but do not propagate.
 *
 * Required env:
 *   LAMINAR_BASE_URL      e.g. http://127.0.0.1:5667
 *   LAMINAR_OTEL_GRPC     e.g. http://127.0.0.1:8001  (Laminar gRPC endpoint)
 *   LAMINAR_PROJECT_API_KEY  Bitwarden item 7c5e0bd7
 *
 * Anchored by hermesSessionId so trace ↔ chat session deep-linking works.
 */

import { Laminar, observe } from "@lmnr-ai/lmnr"

let initialized = false

function ensureInitialized(): boolean {
  if (initialized) return true
  const apiKey = process.env.LAMINAR_PROJECT_API_KEY
  const baseUrl = process.env.LAMINAR_BASE_URL || "http://127.0.0.1:5667"
  if (!apiKey) {
    console.warn(
      "[laminar] LAMINAR_PROJECT_API_KEY not set — tracing disabled",
    )
    return false
  }
  try {
    Laminar.initialize({
      projectApiKey: apiKey,
      baseUrl,
      instrumentModules: {},
    } as Parameters<typeof Laminar.initialize>[0])
    initialized = true
    console.log("[laminar] initialized — base:", baseUrl)
    return true
  } catch (err) {
    console.warn("[laminar] init failed:", err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Emit a top-level chat-turn span.  Fire-and-forget; never blocks.
 *
 * Use as a wrapper around the Hermes proxy call:
 *
 *   withChatTurnSpan({sessionId, tenant}, async () => {
 *     const resp = await fetch(...)
 *     return resp
 *   })
 */
export async function withChatTurnSpan<T>(
  ctx: { sessionId: string; tenant: string; model?: string },
  fn: () => Promise<T>,
): Promise<T> {
  if (!ensureInitialized()) return fn()
  try {
    return await observe(
      {
        name: "chat.turn",
        sessionId: ctx.sessionId,
        metadata: {
          tenant: ctx.tenant,
          model: ctx.model || "unknown",
        },
      } as Parameters<typeof observe>[0],
      fn,
    )
  } catch (err) {
    console.warn("[laminar] withChatTurnSpan wrap failed:", err)
    return fn()
  }
}

/**
 * Emit a tool-call span for a single tool invocation.
 * Fire-and-forget — caller does not await.
 */
export function emitToolCallSpan(ctx: {
  sessionId: string
  tenant: string
  name: string
  args?: unknown
  result?: unknown
  durationMs: number
  status: "ok" | "error"
}): void {
  if (!ensureInitialized()) return
  // Sanitize args/result — strip credential-like fields
  const sanitize = (x: unknown): unknown => {
    if (!x || typeof x !== "object") return x
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (/api_key|password|token|secret|bearer/i.test(k)) {
        out[k] = "[REDACTED]"
      } else if (typeof v === "object" && v !== null) {
        out[k] = sanitize(v)
      } else {
        out[k] = v
      }
    }
    return out
  }
  ;(async () => {
    try {
      await observe(
        {
          name: `tool_call.${ctx.name}`,
          sessionId: ctx.sessionId,
          metadata: {
            tenant: ctx.tenant,
            tool: ctx.name,
            duration_ms: ctx.durationMs,
            status: ctx.status,
            args: sanitize(ctx.args),
            result: sanitize(ctx.result),
          },
        } as Parameters<typeof observe>[0],
        async () => Promise.resolve(),
      )
    } catch (err) {
      console.warn("[laminar] emitToolCallSpan failed:", err)
    }
  })().catch(() => {
    // explicit double-catch — never let span emission propagate
  })
}

/**
 * Whether tracing is configured (used to gate UI features).
 */
export function isTracingConfigured(): boolean {
  return Boolean(process.env.LAMINAR_PROJECT_API_KEY)
}
