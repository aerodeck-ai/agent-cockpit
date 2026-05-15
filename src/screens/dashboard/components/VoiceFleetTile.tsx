/**
 * VoiceFleetTile — Phase 6D voice infra watchdog
 *
 * Shows live health of MLX (Henry + Mally), Hermes (two instances),
 * Chatterbox TTS, voice-ingest-server, voice-bot-server, and Tailscale
 * reachability for each device.
 *
 * Pattern: GlassCard shell + useQuery with refetchInterval, identical to
 * other dashboard tiles. Each probe row is independently failure-isolated
 * (one dead probe doesn't kill the whole card).
 */
import { useQuery } from '@tanstack/react-query'

// ── Type mirror from the API route ──────────────────────────────

type ProbeResult = {
  ok: boolean
  latency_ms: number | null
  ts: number
  detail?: string
}

type MlxProbeResult = ProbeResult & {
  queue_depth: number | null
  last_cleanup_latency_ms: number | null
}

type IngestProbeResult = ProbeResult & {
  last_ts: number | null
  total_today: number | null
}

type VoiceBotProbeResult = ProbeResult & {
  last_call_sid: string | null
  total_today: number | null
}

type TailscaleDevice = {
  hostname: string
  ok: boolean
  last_seen_ago_s: number | null
}

type VoiceFleetStatus = {
  checked_at: number
  henry_mlx: MlxProbeResult
  mally_mlx: MlxProbeResult
  hermes_henry: ProbeResult
  hermes_mally: ProbeResult
  chatterbox: ProbeResult
  voice_ingest: IngestProbeResult
  voice_bot: VoiceBotProbeResult
  tailscale: Array<TailscaleDevice>
}

// ── Helpers ──────────────────────────────────────────────────────

function pill(ok: boolean, extra?: string): string {
  return ok ? 'green' : 'red'
}

function latStr(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function agoStr(ms: number | null): string {
  if (ms === null) return '—'
  const diff = Date.now() - ms
  if (diff < 60_000) return '<1m ago'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

function tailAgoStr(s: number | null): string {
  if (s === null) return '—'
  if (s < 60) return '<1m ago'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

// ── Sub-components ───────────────────────────────────────────────

function StatusPill({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]"
      style={{
        background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
        color: ok ? 'var(--theme-success, #22c55e)' : 'var(--theme-danger, #ef4444)',
        border: `1px solid ${ok ? 'rgba(34,197,94,0.28)' : 'rgba(239,68,68,0.28)'}`,
      }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: ok ? 'var(--theme-success, #22c55e)' : 'var(--theme-danger, #ef4444)' }}
      />
      {label ?? (ok ? 'ok' : 'down')}
    </span>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-[var(--theme-border)] last:border-0">
      <span className="text-[11px] font-medium" style={{ color: 'var(--theme-muted)', minWidth: 130 }}>
        {label}
      </span>
      <div className="flex items-center gap-2 flex-wrap justify-end text-[11px]" style={{ color: 'var(--theme-text)' }}>
        {children}
      </div>
    </div>
  )
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--theme-muted)', fontSize: 10 }}>{children}</span>
}

// ── Main tile ────────────────────────────────────────────────────

export function VoiceFleetTile() {
  const query = useQuery<VoiceFleetStatus>({
    queryKey: ['voice-fleet'],
    queryFn: async () => {
      const res = await fetch('/api/voice-fleet')
      if (!res.ok) throw new Error(`voice-fleet ${res.status}`)
      return (await res.json()) as VoiceFleetStatus
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  })

  const d = query.data ?? null
  const isLoading = query.isLoading
  const isError = query.isError

  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-xl border transition-colors"
      style={{ background: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
    >
      {/* Accent bar — cyan for voice infra */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{ background: 'linear-gradient(90deg, #06b6d4, #06b6d450, transparent)' }}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: 'var(--theme-muted)' }}>
          Voice Fleet
        </h3>
        <div className="flex items-center gap-2">
          {isLoading && (
            <span className="text-[9px] uppercase tracking-[0.12em]" style={{ color: 'var(--theme-muted)' }}>
              loading…
            </span>
          )}
          {isError && (
            <span className="text-[9px] uppercase tracking-[0.12em]" style={{ color: 'var(--theme-danger, #ef4444)' }}>
              probe failed
            </span>
          )}
          {d && (
            <span className="text-[9px] tabular-nums" style={{ color: 'var(--theme-muted)' }}>
              {agoStr(d.checked_at)}
            </span>
          )}
          <span className="text-[10px]">🎤</span>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 pb-4 pt-2">
        {/* ── MLX ── */}
        <div className="mb-1 mt-1 text-[9px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--theme-muted)' }}>
          MLX Inference
        </div>
        <Row label="Henry :8770">
          {d ? (
            <>
              <StatusPill ok={d.henry_mlx.ok} />
              {d.henry_mlx.queue_depth !== null && (
                <Dim>q:{d.henry_mlx.queue_depth}</Dim>
              )}
              {d.henry_mlx.last_cleanup_latency_ms !== null && (
                <Dim>cleanup:{latStr(d.henry_mlx.last_cleanup_latency_ms)}</Dim>
              )}
              {d.henry_mlx.latency_ms !== null && (
                <Dim>{latStr(d.henry_mlx.latency_ms)}</Dim>
              )}
              {!d.henry_mlx.ok && d.henry_mlx.detail && (
                <Dim>{d.henry_mlx.detail === 'not deployed' ? 'not deployed' : 'unreachable'}</Dim>
              )}
            </>
          ) : (
            <Dim>—</Dim>
          )}
        </Row>
        <Row label="Mally :8770">
          {d ? (
            <>
              <StatusPill ok={d.mally_mlx.ok} label={d.mally_mlx.ok ? 'ok' : (d.mally_mlx.detail === 'not deployed' ? 'not deployed' : 'down')} />
              {d.mally_mlx.queue_depth !== null && (
                <Dim>q:{d.mally_mlx.queue_depth}</Dim>
              )}
              {d.mally_mlx.latency_ms !== null && (
                <Dim>{latStr(d.mally_mlx.latency_ms)}</Dim>
              )}
            </>
          ) : (
            <Dim>—</Dim>
          )}
        </Row>

        {/* ── Hermes ── */}
        <div className="mb-1 mt-3 text-[9px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--theme-muted)' }}>
          Hermes
        </div>
        <Row label="Henry :8642">
          {d ? (
            <>
              <StatusPill ok={d.hermes_henry.ok} />
              {d.hermes_henry.latency_ms !== null && <Dim>{latStr(d.hermes_henry.latency_ms)}</Dim>}
            </>
          ) : (
            <Dim>—</Dim>
          )}
        </Row>
        <Row label="Mally :8644">
          {d ? (
            <>
              <StatusPill ok={d.hermes_mally.ok} />
              {d.hermes_mally.latency_ms !== null && <Dim>{latStr(d.hermes_mally.latency_ms)}</Dim>}
            </>
          ) : (
            <Dim>—</Dim>
          )}
        </Row>

        {/* ── Chatterbox ── */}
        <div className="mb-1 mt-3 text-[9px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--theme-muted)' }}>
          TTS / Ingest / Bot
        </div>
        <Row label="Chatterbox :8908">
          {d ? (
            <>
              <StatusPill ok={d.chatterbox.ok} />
              {d.chatterbox.latency_ms !== null && <Dim>{latStr(d.chatterbox.latency_ms)}</Dim>}
            </>
          ) : (
            <Dim>—</Dim>
          )}
        </Row>
        <Row label="voice-ingest :8470">
          {d ? (
            <>
              <StatusPill ok={d.voice_ingest.ok} />
              {d.voice_ingest.last_ts !== null && <Dim>last:{agoStr(d.voice_ingest.last_ts)}</Dim>}
              {d.voice_ingest.total_today !== null && <Dim>{d.voice_ingest.total_today} today</Dim>}
            </>
          ) : (
            <Dim>—</Dim>
          )}
        </Row>
        <Row label="voice-bot :8471">
          {d ? (
            <>
              <StatusPill ok={d.voice_bot.ok} />
              {d.voice_bot.last_call_sid && (
                <Dim title={d.voice_bot.last_call_sid}>
                  sid:{d.voice_bot.last_call_sid.slice(-8)}
                </Dim>
              )}
              {d.voice_bot.total_today !== null && <Dim>{d.voice_bot.total_today} calls today</Dim>}
            </>
          ) : (
            <Dim>—</Dim>
          )}
        </Row>

        {/* ── Tailscale ── */}
        <div className="mb-1 mt-3 text-[9px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--theme-muted)' }}>
          Tailscale
        </div>
        {d ? (
          d.tailscale.map((dev) => (
            <Row key={dev.hostname} label={dev.hostname}>
              <StatusPill ok={dev.ok} />
              {dev.last_seen_ago_s !== null && <Dim>{tailAgoStr(dev.last_seen_ago_s)}</Dim>}
            </Row>
          ))
        ) : (
          <Row label="—"><Dim>—</Dim></Row>
        )}
      </div>
    </div>
  )
}
