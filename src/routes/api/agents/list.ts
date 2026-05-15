import { createFileRoute } from '@tanstack/react-router'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isAuthenticated } from '../../../server/auth-middleware'

const execFileAsync = promisify(execFile)

// ── Types ────────────────────────────────────────────────────────────────────

export type AgentType =
  | 'hermes-profile'
  | 'mastra'
  | 'voice-bot'
  | 'classifier'
  | 'archon'
  | 'service'

export type AgentHost = 'mac' | 'oracle'

export type AgentEntry = {
  id: string
  name: string
  type: AgentType
  model: string
  host: AgentHost
  live: boolean
  process?: string
  lastActiveMs: number | null
  langfuseSpans24h: number | null
  henryAccessible: boolean
  mallyAccessible: boolean
  notes?: string
}

export type AgentsListResponse = {
  agents: Array<AgentEntry>
  checkedAt: number
}

// ── 60-second server-side cache ──────────────────────────────────────────────

let _cache: { data: AgentsListResponse; expiry: number } | null = null

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseModel(raw: unknown): string {
  if (!raw) return ''
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>
    const candidates = ['model', 'default', 'default_model']
    for (const k of candidates) {
      if (typeof obj[k] === 'string' && (obj[k] as string).length > 0) {
        return obj[k] as string
      }
    }
  }
  return String(raw)
}

function readYamlLoose(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null
    const text = readFileSync(filePath, 'utf8')
    // Very simple key: value extractor — avoids a yaml dep.
    // Only grabs top-level scalar values, which is all we need.
    const result: Record<string, unknown> = {}
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Za-z_][\w.]*)\s*:\s*(.+)$/)
      if (m) {
        const [, key, val] = m
        const trimmed = val.trim().replace(/^['"]|['"]$/g, '')
        result[key] = trimmed
      }
    }
    return result
  } catch {
    return null
  }
}

function readModelFromConfig(configPath: string): string {
  try {
    if (!existsSync(configPath)) return ''
    const text = readFileSync(configPath, 'utf8')
    // Look for model-related keys in the config yaml
    const patterns = [
      /^\s*default_model\s*:\s*['"]?([^'"\n]+)['"]?/m,
      /^\s*default\s*:\s*['"]?([^'"\n]+)['"]?/m,
      /^\s*model\s*:\s*['"]?([^'"\n]+)['"]?/m,
    ]
    for (const pat of patterns) {
      const m = text.match(pat)
      if (m?.[1] && m[1].trim().length > 0) {
        const val = m[1].trim()
        // Skip YAML map entries like "{ provider: openai }"
        if (!val.startsWith('{') && !val.startsWith('[')) {
          return val
        }
      }
    }
    return ''
  } catch {
    return ''
  }
}

// ── Mac profile probe ────────────────────────────────────────────────────────

async function getMacProfiles(): Promise<Array<AgentEntry>> {
  const profilesDir = join(homedir(), '.hermes', 'profiles')
  const entries: Array<AgentEntry> = []

  try {
    const dirs = readdirSync(profilesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.includes('.bak') && !d.name.startsWith('.'))
      .map((d) => d.name)

    for (const name of dirs) {
      const profilePath = join(profilesDir, name)
      const configPath = join(profilePath, 'config.yaml')
      const model = readModelFromConfig(configPath)

      // Mac active profiles — check if launchctl has them or process is running
      let live = false
      try {
        const { stdout } = await execFileAsync('bash', [
          '-c',
          `launchctl list 2>/dev/null | grep -i hermes | grep -i "${name}" | head -1`,
        ], { timeout: 2_000 })
        live = stdout.trim().length > 0
      } catch { /* not found = not live */ }

      const isMallyProfile = name.toLowerCase().includes('mally') ||
        name === 'henry-personal' ||
        name === 'hermes-chief-of-staff' ||
        name === 'hex'

      entries.push({
        id: `mac-hermes-${name}`,
        name,
        type: 'hermes-profile',
        model: model || '—',
        host: 'mac',
        live,
        process: 'launchctl',
        lastActiveMs: null,
        langfuseSpans24h: null,
        henryAccessible: !name.includes('mally'),
        mallyAccessible: isMallyProfile,
      })
    }
  } catch {
    /* profiles dir may not exist */
  }

  return entries
}

// ── Oracle pm2 + systemd probe (via SSH) ─────────────────────────────────────

interface Pm2Entry {
  name: string
  pm2_env: { status: string; pm_uptime?: number }
  monit?: { cpu: number }
}

async function getOracleAgents(): Promise<Array<AgentEntry>> {
  const entries: Array<AgentEntry> = []

  // ── pm2 list ────────────────────────────────────────────────────
  let pm2Data: Array<Pm2Entry> = []
  try {
    const { stdout } = await execFileAsync('ssh', ['oracle', 'pm2 jlist 2>/dev/null'], {
      timeout: 10_000,
    })
    pm2Data = JSON.parse(stdout) as Array<Pm2Entry>
  } catch {
    /* oracle unreachable */
  }

  // Only surface agent-relevant pm2 processes
  const AGENT_PM2_PATTERNS = [
    'mastra-mcp',
    'mastra-service',
    'mastra-service-v2',
    'hermes',
    'voice-bot-server',
    'voice-ingest-server',
    'agent-cockpit',
  ]

  for (const proc of pm2Data) {
    const name = proc.name
    if (!AGENT_PM2_PATTERNS.some((p) => name.toLowerCase().includes(p.toLowerCase()))) {
      continue
    }

    const live = proc.pm2_env.status === 'online'
    const uptime = proc.pm2_env.pm_uptime ?? null
    let type: AgentType = 'service'
    if (name.includes('mastra')) type = 'mastra'
    else if (name.includes('voice-bot')) type = 'voice-bot'
    else if (name.includes('voice-ingest')) type = 'voice-bot'

    entries.push({
      id: `oracle-pm2-${name}`,
      name,
      type,
      model: name.includes('voice-bot') ? 'jambonz/chatterbox' : '—',
      host: 'oracle',
      live,
      process: 'pm2',
      lastActiveMs: uptime,
      langfuseSpans24h: null,
      henryAccessible: true,
      mallyAccessible: name.toLowerCase().includes('mally'),
    })
  }

  // ── Oracle Hermes profiles via systemd ───────────────────────────
  try {
    const { stdout } = await execFileAsync('ssh', [
      'oracle',
      'systemctl list-units --type=service --no-pager --plain 2>/dev/null | grep hermes-gateway',
    ], { timeout: 10_000 })

    const PROFILE_MODELS: Record<string, string> = {
      ares: 'gpt-5.5',
      'code-reviewer': 'gpt-5.5',
      'eval-runner': 'claude-haiku-4-5',
      'hermes-auditor': 'claude-sonnet-4-6',
      'hermes-warden': 'claude-haiku-4-5',
      'infra-watcher': 'gpt-5.5',
      jiddlers: '—',
      mally: 'gpt-5.5',
      'mally-second': 'gpt-5.5',
      miranda: 'gpt-5.5',
      'opportunity-scanner': 'gpt-5.5',
      vectos: '—',
      'work-ops': 'gpt-oss-20b',
      'yt-curator': 'qwen2.5:7b',
      'yt-route-supervisor': 'qwen2.5:1.5b',
      'yt-strategist': 'claude-haiku-4-5',
    }

    for (const line of stdout.split('\n')) {
      const m = line.match(/hermes-gateway-([a-z0-9_-]+)\.service\s+(\S+)\s+(\S+)/)
      if (!m) continue
      const [, profileName, , activeState] = m
      const live = activeState === 'active' || activeState === 'running'

      entries.push({
        id: `oracle-hermes-${profileName}`,
        name: profileName,
        type: 'hermes-profile',
        model: PROFILE_MODELS[profileName] ?? '—',
        host: 'oracle',
        live,
        process: `hermes-gateway-${profileName}.service`,
        lastActiveMs: null,
        langfuseSpans24h: null,
        henryAccessible: !profileName.includes('mally') && profileName !== 'mally-second',
        mallyAccessible: profileName.includes('mally') || profileName === 'mally-second',
      })
    }
  } catch {
    /* SSH may time out */
  }

  // ── Voice / Jambonz systemd ──────────────────────────────────────
  try {
    const { stdout } = await execFileAsync('ssh', [
      'oracle',
      'systemctl is-active drachtio.service freeswitch.service 2>/dev/null || true',
    ], { timeout: 6_000 })

    const lines = stdout.trim().split('\n')
    const serviceNames = ['drachtio', 'freeswitch']
    for (let i = 0; i < serviceNames.length; i++) {
      const svcName = serviceNames[i]
      const state = (lines[i] ?? '').trim()
      entries.push({
        id: `oracle-systemd-${svcName}`,
        name: svcName,
        type: 'voice-bot',
        model: svcName === 'drachtio' ? 'SIP/drachtio' : 'FreeSWITCH',
        host: 'oracle',
        live: state === 'active',
        process: `${svcName}.service`,
        lastActiveMs: null,
        langfuseSpans24h: null,
        henryAccessible: true,
        mallyAccessible: false,
      })
    }
  } catch { /* ignore */ }

  return entries
}

// ── Mac non-Hermes agents ────────────────────────────────────────────────────

async function getMacServices(): Promise<Array<AgentEntry>> {
  const entries: Array<AgentEntry> = []

  // Archon — check if the processes are listening
  const archonPorts = [
    { name: 'archon-backend', port: 8540, label: 'Archon Mission Control (bun :8540)' },
    { name: 'archon-frontend', port: 5173, label: 'Archon Vite UI (:5173)' },
  ]

  for (const svc of archonPorts) {
    let live = false
    try {
      const { stdout } = await execFileAsync('bash', [
        '-c',
        `lsof -nP -iTCP:${svc.port} -sTCP:LISTEN 2>/dev/null | wc -l | tr -d ' '`,
      ], { timeout: 3_000 })
      live = parseInt(stdout.trim(), 10) > 0
    } catch { /* skip */ }

    entries.push({
      id: `mac-${svc.name}`,
      name: svc.label,
      type: 'archon',
      model: '—',
      host: 'mac',
      live,
      process: `port:${svc.port}`,
      lastActiveMs: null,
      langfuseSpans24h: null,
      henryAccessible: true,
      mallyAccessible: false,
    })
  }

  // Meeting classifier
  let classifierLive = false
  try {
    const { stdout } = await execFileAsync('bash', [
      '-c',
      `ps aux 2>/dev/null | grep -v grep | grep -i "meeting.classif" | wc -l | tr -d ' '`,
    ], { timeout: 2_000 })
    classifierLive = parseInt(stdout.trim(), 10) > 0
  } catch { /* skip */ }

  entries.push({
    id: 'mac-meeting-classifier',
    name: 'meeting-classifier',
    type: 'classifier',
    model: 'groq/llama-3.3-70b',
    host: 'mac',
    live: classifierLive,
    process: 'python',
    lastActiveMs: null,
    langfuseSpans24h: null,
    henryAccessible: true,
    mallyAccessible: false,
  })

  return entries
}

// ── Langfuse span counts ─────────────────────────────────────────────────────

async function enrichWithLangfuse(agents: Array<AgentEntry>): Promise<void> {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY ?? process.env.HERMES_LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY ?? process.env.HERMES_LANGFUSE_SECRET_KEY
  const baseUrl = process.env.LANGFUSE_BASE_URL ?? process.env.HERMES_LANGFUSE_BASE_URL ?? 'https://langfuse.berl.ai'

  if (!publicKey || !secretKey) return

  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const creds = Buffer.from(`${publicKey}:${secretKey}`).toString('base64')

  await Promise.all(
    agents.map(async (agent) => {
      try {
        const url = `${baseUrl}/api/public/observations?fromStartTime=${encodeURIComponent(from)}&name=${encodeURIComponent(agent.name)}&limit=1`
        const res = await fetch(url, {
          headers: { Authorization: `Basic ${creds}` },
          signal: AbortSignal.timeout(4_000),
        })
        if (!res.ok) return
        const data = (await res.json()) as { meta?: { totalItems?: number } }
        agent.langfuseSpans24h = data?.meta?.totalItems ?? null
      } catch {
        /* non-critical */
      }
    }),
  )
}

// ── Main inventory builder ───────────────────────────────────────────────────

async function buildInventory(): Promise<AgentsListResponse> {
  const [macProfiles, oracleAgents, macServices] = await Promise.all([
    getMacProfiles(),
    getOracleAgents(),
    getMacServices(),
  ])

  const agents = [...macProfiles, ...oracleAgents, ...macServices]

  // Enrich with Langfuse spans (best-effort, non-blocking)
  await enrichWithLangfuse(agents)

  return { agents, checkedAt: Date.now() }
}

// ── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/api/agents/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const now = Date.now()
        if (_cache && _cache.expiry > now) {
          return Response.json(_cache.data, {
            headers: { 'Cache-Control': 's-maxage=60, must-revalidate' },
          })
        }

        try {
          const data = await buildInventory()
          _cache = { data, expiry: now + 60_000 }
          return Response.json(data, {
            headers: { 'Cache-Control': 's-maxage=60, must-revalidate' },
          })
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : 'Failed to build agent inventory' },
            { status: 500 },
          )
        }
      },
    },
  },
})
