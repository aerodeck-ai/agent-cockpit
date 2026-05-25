/**
 * In-process event bus for hook events.
 *
 * Shared singleton between:
 *   - /api/sse/ingest  (writer: emitter hook POSTs here)
 *   - /api/sse/events  (readers: SSE clients subscribe here)
 *
 * Keeps a rolling buffer of the last MAX_BUFFER events for backfill
 * when a new SSE client connects.
 */

type Listener = (event: Record<string, unknown>) => void

const MAX_BUFFER = 200

class EventBus {
  private listeners = new Set<Listener>()
  private buffer: Record<string, unknown>[] = []

  emit(event: Record<string, unknown>): void {
    this.buffer.push(event)
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer = this.buffer.slice(-MAX_BUFFER)
    }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // ignore broken listener
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Return buffered events newer than the given timestamp (ms).
   * Pass 0 to get all buffered events (backfill).
   */
  since(afterTs: number = 0): Record<string, unknown>[] {
    return this.buffer.filter(
      (e) => typeof e.timestamp === 'number' && (e.timestamp as number) > afterTs,
    )
  }
}

// Single process-level singleton
export const eventBus = new EventBus()

// Start Hermes span tail — polls per-profile hermes_events.db every 2s
// and pushes new spans into this bus so SSE clients see Hermes activity.
// Wrapped in try/catch so a missing profiles dir never breaks the bus.
try {
  import('../../../server/hermes-span-tail').then(({ startHermesSpanTail }) => {
    startHermesSpanTail()
  }).catch(() => {})
} catch {
  // ignore — tail is optional
}
