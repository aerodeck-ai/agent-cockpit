import { createFileRoute } from '@tanstack/react-router'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAuthenticated } from '../../server/auth-middleware'

const execFileAsync = promisify(execFile)

// ── Types ────────────────────────────────────────────────────────

export type ProbeResult = {
  ok: boolean
  latency_ms: number | null
  ts: number
  detail?: string
}

export type MlxProbeResult = ProbeResult & {
  queue_depth: number | null
  last_cleanup_latency_ms: number | null
}

export type IngestProbeResult = ProbeResult & {
  last_ts: number | null
  total_today: number | null
}

export type VoiceBotProbeResult = ProbeResult & {
  last_call_sid: string | null
  total_today: number | null
}

export type TailscaleDevice = {
  hostname: string
  ok: boolean
  last_seen_ago_s: number | null
}

// ── Oracle voice-health probe types ─────────────────────────────
export type OracleSystemdUnit = {
  unit: string
  state: string
  ok: boolean
  optional?: boolean
}

export type OraclePm2Process = {
  name: string
  status: string
  restarts_total: number
  ok: boolean
}

export type OracleDisk = {
  path: string
  use_pct: number | null
  ok: boolean
}

export type OracleVoiceHealth = {
  ts: number
  alert: boolean
  systemd: Array<OracleSystemdUnit>
  pm2: Array<OraclePm2Process>
  disk: Array<OracleDisk>
}

export type OracleVoiceProbeResult = ProbeResult & {
  oracle_health: OracleVoiceHealth | null
}

export type VoiceFleetStatus = {
  checked_at: number
  henry_mlx: MlxProbeResult
  mally_mlx: MlxProbeResult
  hermes_henry: ProbeResult
  hermes_mally: ProbeResult
  chatterbox: ProbeResult
  voice_ingest: IngestProbeResult
  voice_bot: VoiceBotProbeResult
  tailscale: Array<TailscaleDevice>
  oracle_voice: OracleVoiceProbeResult
}

// ── Helpers ──────────────────────────────────────────────────────

const TIMEOUT_MS = 3_000

async function probeHttp(url: string): Promise<{ ok: boolean; latency_ms: number; body: unknown; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const start = Date.now()
  try {
    const res = await fetch(url, { signal: controller.signal })
    const latency_ms = Date.now() - start
    let body: unknown = null
    try { body = await res.json() } catch { /* non-JSON body */ }
    return { ok: res.ok, latency_ms, body }
  } catch (err: unknown) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      body: null,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}

function nowTs() {
  return Date.now()
}

async function probeMlx(url: string): Promise<MlxProbeResult> {
  const ts = nowTs()
  try {
    const { ok, latency_ms, body, error } = await probeHttp(url)
    if (!ok) {
      return { ok: false, latency_ms, ts, queue_depth: null, last_cleanup_latency_ms: null, detail: error }
    }
    const data = body as Record<string, unknown> | null
    return {
      ok: true,
      latency_ms,
      ts,
      queue_depth: typeof data?.queue_depth === 'number' ? data.queue_depth : null,
      last_cleanup_latency_ms: typeof data?.last_cleanup_latency_ms === 'number' ? data.last_cleanup_latency_ms : null,
    }
  } catch (err: unknown) {
    return {
      ok: false,
      latency_ms: null,
      ts,
      queue_depth: null,
      last_cleanup_latency_ms: null,
      detail: 'not deployed',
    }
  }
}

async function probeHealth(url: string): Promise<ProbeResult> {
  const ts = nowTs()
  try {
    const { ok, latency_ms, error } = await probeHttp(url)
    return { ok, latency_ms, ts, detail: error }
  } catch (err: unknown) {
    return { ok: false, latency_ms: null, ts, detail: String(err) }
  }
}

async function probeIngest(url: string): Promise<IngestProbeResult> {
  const ts = nowTs()
  try {
    const { ok, latency_ms, body, error } = await probeHttp(url)
    const data = body as Record<string, unknown> | null
    return {
      ok,
      latency_ms,
      ts,
      detail: error,
      last_ts: typeof data?.last_ts === 'number' ? data.last_ts : null,
      total_today: typeof data?.total_today === 'number' ? data.total_today : null,
    }
  } catch (err: unknown) {
    return { ok: false, latency_ms: null, ts, last_ts: null, total_today: null, detail: String(err) }
  }
}

async function probeVoiceBot(url: string): Promise<VoiceBotProbeResult> {
  const ts = nowTs()
  try {
    const { ok, latency_ms, body, error } = await probeHttp(url)
    const data = body as Record<string, unknown> | null
    return {
      ok,
      latency_ms,
      ts,
      detail: error,
      last_call_sid: typeof data?.last_call_sid === 'string' ? data.last_call_sid : null,
      total_today: typeof data?.total_today === 'number' ? data.total_today : null,
    }
  } catch (err: unknown) {
    return { ok: false, latency_ms: null, ts, last_call_sid: null, total_today: null, detail: String(err) }
  }
}

async function probeOracleVoice(url: string): Promise<OracleVoiceProbeResult> {
  const ts = nowTs()
  try {
    const { ok, latency_ms, body, error } = await probeHttp(url)
    const data = body as OracleVoiceHealth | null
    return {
      ok: ok && !(data?.alert ?? false),
      latency_ms,
      ts,
      detail: error,
      oracle_health: data,
    }
  } catch (err: unknown) {
    return { ok: false, latency_ms: null, ts, detail: String(err), oracle_health: null }
  }
}

async function probeTailscale(): Promise<Array<TailscaleDevice>> {
  // Hostname patterns to match against tailscale peers
  const WATCH_HOSTS = [
    { label: 'Henry Mac', pattern: /henry|mac-mini|macs/i },
    { label: 'Mally Mac', pattern: /mally/i },
    { label: 'Oracle', pattern: /oracle|ubuntu/i },
  ]

  try {
    const { stdout } = await execFileAsync('tailscale', ['status', '--json'], { timeout: 4_000 })
    const data = JSON.parse(stdout) as {
      Self?: { HostName?: string; LastSeen?: string; Online?: boolean }
      Peer?: Record<string, { HostName?: string; LastSeen?: string; Online?: boolean }>
    }

    const peers: Array<{ hostname: string; lastSeen?: string; online?: boolean }> = []

    // Include self
    if (data.Self?.HostName) {
      peers.push({ hostname: data.Self.HostName, lastSeen: data.Self.LastSeen, online: data.Self.Online })
    }
    // Include all peers
    for (const peer of Object.values(data.Peer ?? {})) {
      if (peer.HostName) {
        peers.push({ hostname: peer.HostName, lastSeen: peer.LastSeen, online: peer.Online })
      }
    }

    const now = Date.now()
    return WATCH_HOSTS.map(({ label, pattern }) => {
      const match = peers.find((p) => pattern.test(p.hostname))
      if (!match) return { hostname: label, ok: false, last_seen_ago_s: null }
      const lastSeenMs = match.lastSeen ? Date.parse(match.lastSeen) : null
      const agoS = lastSeenMs ? Math.round((now - lastSeenMs) / 1000) : null
      const ok = match.online === true || (agoS !== null && agoS < 60)
      return { hostname: label, ok, last_seen_ago_s: agoS }
    })
  } catch {
    return [
      { hostname: 'Henry Mac', ok: false, last_seen_ago_s: null },
      { hostname: 'Mally Mac', ok: false, last_seen_ago_s: null },
      { hostname: 'Oracle', ok: false, last_seen_ago_s: null },
    ]
  }
}

// ── Route ────────────────────────────────────────────────────────

export const Route = createFileRoute('/api/voice-fleet')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // All probes run concurrently; each is independently failure-isolated.
        const [
          henry_mlx,
          mally_mlx,
          hermes_henry,
          hermes_mally,
          chatterbox,
          voice_ingest,
          voice_bot,
          tailscale,
          oracle_voice,
        ] = await Promise.all([
          probeMlx('http://100.89.244.20:8770/metrics'),
          probeMlx('http://100.114.38.97:8770/metrics'),
          probeHealth('http://localhost:8642/health'),
          probeHealth('http://localhost:8644/health'),
          probeHealth('http://100.89.244.20:8908/health'),
          probeIngest('http://localhost:8470/health'),
          probeVoiceBot('http://localhost:8471/health'),
          probeTailscale(),
          // Oracle voice-health aggregator (port 8660 via autossh tunnel or Tailscale)
          probeOracleVoice('http://100.64.135.5:8660/health'),
        ])

        const body: VoiceFleetStatus = {
          checked_at: Date.now(),
          henry_mlx,
          mally_mlx,
          hermes_henry,
          hermes_mally,
          chatterbox,
          voice_ingest,
          voice_bot,
          tailscale,
          oracle_voice,
        }

        return Response.json(body, {
          headers: {
            // Allow a 10s CDN edge cache; clients re-fetch every 15s.
            'Cache-Control': 's-maxage=10, must-revalidate',
          },
        })
      },
    },
  },
})
