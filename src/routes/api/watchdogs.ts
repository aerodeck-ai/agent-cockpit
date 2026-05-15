import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isAuthenticated } from '../../server/auth-middleware'

// ── Types ──────────────────────────────────────────────────────────────────

export type WatchdogStatus = 'green' | 'amber' | 'red'

export type WatchdogInfo = {
  id: string
  displayName: string
  host: 'mac-launchd' | 'oracle-systemd' | 'cron'
  label: string
  intervalSeconds: number | null
  /** ISO string or null */
  lastFire: string | null
  runCount24h: number
  driftCount24h: number
  lastError: string | null
  /** ISO string or null */
  nextRun: string | null
  pid: number | null
  lastExitStatus: number | null
  status: WatchdogStatus
}

export type WatchdogsResponse = {
  watchdogs: WatchdogInfo[]
  fetchedAt: number
}

// ── Cache ──────────────────────────────────────────────────────────────────

let _cache: { data: WatchdogsResponse; expiresAt: number } | null = null
const CACHE_TTL_MS = 30_000

// ── Helpers ────────────────────────────────────────────────────────────────

function shellTry(cmd: string, args: string[], timeoutMs = 5_000): string {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf-8',
      timeout: timeoutMs,
    }).trim()
  } catch {
    return ''
  }
}

function readFileTry(path: string): string {
  try {
    if (existsSync(path)) return readFileSync(path, 'utf-8')
  } catch {
    /* ignore */
  }
  return ''
}

function parseJsonTry<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** Parse `launchctl list | grep <label>` output: "PID\tLastExit\tLabel" */
function parseLaunchctlLine(raw: string): {
  pid: number | null
  exitStatus: number | null
} {
  const line = raw.split('\n').find((l) => l.includes('com.hberliand.') || l.includes('com.mcp.') || l.includes('com.berlai.'))
  if (!line) return { pid: null, exitStatus: null }
  const parts = line.trim().split(/\s+/)
  if (parts.length < 3) return { pid: null, exitStatus: null }
  const pid = parts[0] === '-' ? null : parseInt(parts[0], 10)
  const exit = parts[1] === '-' ? null : parseInt(parts[1], 10)
  return {
    pid: pid !== null && !Number.isNaN(pid) ? pid : null,
    exitStatus: exit !== null && !Number.isNaN(exit) ? exit : null,
  }
}

/**
 * Read last N lines of a log file and return the most recent ISO timestamp
 * and any ERROR lines in the last 7 days.
 */
function readLogFile(
  logPath: string,
  tsPattern: RegExp,
  errorPattern: RegExp,
  maxLines = 200,
): { lastFire: string | null; lastError: string | null; runCount24h: number } {
  const raw = readFileTry(logPath)
  if (!raw) return { lastFire: null, lastError: null, runCount24h: 0 }

  const lines = raw.split('\n').filter(Boolean)
  const tail = lines.slice(-maxLines)

  const now = Date.now()
  const oneDayMs = 24 * 60 * 60 * 1000
  const sevenDaysMs = 7 * oneDayMs

  let lastFire: string | null = null
  let lastError: string | null = null
  let runCount24h = 0

  for (let i = tail.length - 1; i >= 0; i--) {
    const line = tail[i]
    const tsMatch = line.match(tsPattern)
    if (tsMatch) {
      const ts = new Date(tsMatch[1]).getTime()
      if (!Number.isNaN(ts)) {
        if (lastFire === null) lastFire = tsMatch[1]
        if (now - ts <= oneDayMs) runCount24h++
        if (errorPattern.test(line) && lastError === null && now - ts <= sevenDaysMs) {
          lastError = line.slice(0, 200)
        }
      }
    }
  }

  return { lastFire, lastError, runCount24h }
}

/** Compute a status badge from the watchdog state. */
function computeStatus(info: {
  pid: number | null
  lastExitStatus: number | null
  lastFire: string | null
  intervalSeconds: number | null
  lastError: string | null
  host: WatchdogInfo['host']
}): WatchdogStatus {
  const { pid, lastExitStatus, lastFire, intervalSeconds, lastError, host } = info

  // A persistent lastExitStatus that is non-zero (and not a known benign code) = red
  // Exit 1 is expected for drift-found on watchdogs — treat as amber not red
  const isErrorExit =
    lastExitStatus !== null && lastExitStatus !== 0 && lastExitStatus !== 1

  if (isErrorExit) return 'red'
  if (lastError && lastError.toLowerCase().includes('error')) return 'red'

  // For launchd/cron: if a pid is present, the process is currently running → green
  if (pid !== null && host !== 'oracle-systemd') return 'green'

  // Check staleness
  if (lastFire && intervalSeconds) {
    const lastMs = new Date(lastFire).getTime()
    const staleLimitMs = intervalSeconds * 2 * 1000
    if (Date.now() - lastMs > staleLimitMs) return 'amber'
  }

  // If we have a recent fire and no errors, green
  if (lastFire) {
    const ageMs = Date.now() - new Date(lastFire).getTime()
    if (intervalSeconds && ageMs < intervalSeconds * 2 * 1000) return 'green'
    return 'amber'
  }

  return 'red'
}

// ── Per-watchdog data collectors ───────────────────────────────────────────

const HOME = homedir()
const MCP_INFRA = join(HOME, 'mcp-infra')

function getPersonaDrift(): WatchdogInfo {
  const label = 'com.hberliand.persona-drift-watchdog'
  const launchctlRaw = shellTry('launchctl', ['list', label])
  const { pid, exitStatus } = parseLaunchctlLine(
    shellTry('launchctl', ['list']).split('\n').find((l) => l.includes(label)) ?? '',
  )

  // Log: /tmp/persona-drift-watchdog-out.log  (JSONL lines with "ts" field)
  const { lastFire, lastError, runCount24h } = readLogFile(
    '/tmp/persona-drift-watchdog-out.log',
    /\{"ts":\s*"([^"]+)"/,
    /error|exception|failed/i,
  )

  // drift_count from last summary line
  const summaryRaw = readFileTry('/tmp/persona-drift-watchdog-out.log')
  const summaryMatch = summaryRaw.match(/"drift_count":\s*(\d+)/)
  const driftCount24h = summaryMatch ? parseInt(summaryMatch[1], 10) : 0

  const intervalSeconds = 3600

  const status = computeStatus({ pid, lastExitStatus: exitStatus, lastFire, intervalSeconds, lastError, host: 'mac-launchd' })

  void launchctlRaw

  return {
    id: 'persona-drift',
    displayName: 'Persona Drift',
    host: 'mac-launchd',
    label,
    intervalSeconds,
    lastFire,
    runCount24h,
    driftCount24h,
    lastError,
    nextRun: lastFire
      ? new Date(new Date(lastFire).getTime() + intervalSeconds * 1000).toISOString()
      : null,
    pid,
    lastExitStatus: exitStatus,
    status,
  }
}

function getKanbanCanary(): WatchdogInfo {
  // Runs via crontab: */5 * * * *
  const logPath = join(MCP_INFRA, 'logs', 'kanban-canary.log')
  const { lastFire, lastError, runCount24h } = readLogFile(
    logPath,
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/,
    /error|fail|exception/i,
  )

  // Each line ending in "OK" is a successful run; errors have "FAIL"
  const raw = readFileTry(logPath)
  const recentLines = raw.split('\n').filter(Boolean).slice(-288) // 24h at 5-min intervals
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const errorLines = recentLines.filter((l) => {
    const tsMatch = l.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/)
    if (!tsMatch) return false
    const ts = new Date(tsMatch[1]).getTime()
    return now - ts <= dayMs && /FAIL|error/i.test(l)
  })

  const status = computeStatus({
    pid: null, // cron, no persistent pid
    lastExitStatus: errorLines.length > 0 ? 1 : 0,
    lastFire,
    intervalSeconds: 5 * 60,
    lastError: errorLines[0] ?? null,
    host: 'cron',
  })

  const intervalSeconds = 5 * 60

  return {
    id: 'kanban-canary',
    displayName: 'Kanban Canary',
    host: 'cron',
    label: 'cron:*/5 * * * *',
    intervalSeconds,
    lastFire,
    runCount24h,
    driftCount24h: 0,
    lastError: lastError ?? (errorLines[0] ?? null),
    nextRun: lastFire
      ? new Date(new Date(lastFire).getTime() + intervalSeconds * 1000).toISOString()
      : null,
    pid: null,
    lastExitStatus: errorLines.length > 0 ? 1 : 0,
    status,
  }
}

function getCanvasDrift(): WatchdogInfo {
  const label = 'com.hberliand.drift-watchdog'
  const allLabels = shellTry('launchctl', ['list'])
  const line = allLabels.split('\n').find((l) => l.includes(label)) ?? ''
  const { pid, exitStatus } = parseLaunchctlLine(line)

  const { lastFire, lastError, runCount24h } = readLogFile(
    '/tmp/drift-watchdog.log',
    /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/,
    /error|exception|fail/i,
  )

  // Drift count from the JSON report
  let driftCount24h = 0
  const reportJson = readFileTry('/tmp/drift-report-2026-05-15.json')
  if (reportJson) {
    const report = parseJsonTry<{
      summary?: { total_missing?: number; total_unexpected?: number }
    }>(reportJson)
    if (report?.summary) {
      driftCount24h = (report.summary.total_missing ?? 0) + (report.summary.total_unexpected ?? 0)
    }
  }

  // Runs Mon-Fri 08:00 → approximately every 24h on weekdays
  const intervalSeconds = 24 * 60 * 60

  const status = computeStatus({ pid, lastExitStatus: exitStatus, lastFire, intervalSeconds, lastError, host: 'mac-launchd' })

  return {
    id: 'canvas-drift',
    displayName: 'Canvas Drift',
    host: 'mac-launchd',
    label,
    intervalSeconds,
    lastFire,
    runCount24h,
    driftCount24h,
    lastError,
    nextRun: null, // calendar-based, not predictable from last fire alone
    pid,
    lastExitStatus: exitStatus,
    status,
  }
}

function getInfraWatcher(): WatchdogInfo {
  // hermes-infra-watcher runs on Oracle via Hermes every 30 min
  // Best proxy on Mac: check hermes-profile-watchdog state for oracle-systemd:hermes-gateway
  const stateJson = readFileTry(
    join(MCP_INFRA, 'logs', 'hermes-profile-watchdog-state.json'),
  )
  const state = parseJsonTry<Record<string, string>>(stateJson)
  const oracleStatus = state?.['oracle-systemd:hermes-gateway'] ?? null

  const label = 'oracle-hermes:infra-watcher (*/30 * * * *)'
  const intervalSeconds = 30 * 60

  // No direct log access from Mac — surface what we know
  const lastError = oracleStatus === 'inactive' || oracleStatus === 'failed'
    ? `hermes-gateway: ${oracleStatus}`
    : null

  const status: WatchdogStatus = lastError ? 'red' : 'green'

  return {
    id: 'infra-watcher',
    displayName: 'Infra Watcher',
    host: 'oracle-systemd',
    label,
    intervalSeconds,
    lastFire: null, // not directly readable from Mac
    runCount24h: 0,
    driftCount24h: 0,
    lastError,
    nextRun: null,
    pid: null,
    lastExitStatus: null,
    status,
  }
}

function getAresSecurity(): WatchdogInfo {
  const label = 'com.hberliand.ares-feeder'
  const allLabels = shellTry('launchctl', ['list'])
  const line = allLabels.split('\n').find((l) => l.includes(label)) ?? ''
  const { pid, exitStatus } = parseLaunchctlLine(line)

  const { lastFire, lastError, runCount24h } = readLogFile(
    join(HOME, 'Library', 'Logs', 'ares-feeder.stdout.log'),
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
    /error|exception|fail|traceback/i,
  )

  // ares-feeder is KeepAlive:true — no fixed interval; treat as always-on
  const intervalSeconds = null

  const status: WatchdogStatus = pid !== null ? 'green' : exitStatus !== 0 ? 'red' : 'amber'

  return {
    id: 'ares-security',
    displayName: 'Ares Security',
    host: 'mac-launchd',
    label,
    intervalSeconds,
    lastFire,
    runCount24h,
    driftCount24h: 0,
    lastError,
    nextRun: null, // always-on daemon
    pid,
    lastExitStatus: exitStatus,
    status,
  }
}

function getHermesWarden(): WatchdogInfo {
  const label = 'com.hberliand.hermes-profile-watchdog'
  const allLabels = shellTry('launchctl', ['list'])
  const line = allLabels.split('\n').find((l) => l.includes(label)) ?? ''
  const { pid, exitStatus } = parseLaunchctlLine(line)

  const logPath = join(MCP_INFRA, 'logs', 'hermes-profile-watchdog-launchd.log')
  const { lastFire, lastError, runCount24h } = readLogFile(
    logPath,
    /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/,
    /error|fail|exception|traceback/i,
  )

  // Read state to compute drift count (inactive profiles = drift)
  const stateJson = readFileTry(
    join(MCP_INFRA, 'logs', 'hermes-profile-watchdog-state.json'),
  )
  const state = parseJsonTry<Record<string, string>>(stateJson)
  const driftCount24h = state
    ? Object.values(state).filter((v) => v !== 'ok').length
    : 0

  const intervalSeconds = 15 * 60

  const status = computeStatus({ pid, lastExitStatus: exitStatus, lastFire, intervalSeconds, lastError, host: 'mac-launchd' })

  return {
    id: 'hermes-warden',
    displayName: 'Hermes Warden',
    host: 'mac-launchd',
    label,
    intervalSeconds,
    lastFire,
    runCount24h,
    driftCount24h,
    lastError,
    nextRun: lastFire
      ? new Date(new Date(lastFire).getTime() + intervalSeconds * 1000).toISOString()
      : null,
    pid,
    lastExitStatus: exitStatus,
    status,
  }
}

// ── Route ──────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/api/watchdogs')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Serve from cache if fresh
        if (_cache && Date.now() < _cache.expiresAt) {
          return json(_cache.data)
        }

        try {
          const watchdogs: WatchdogInfo[] = [
            getPersonaDrift(),
            getKanbanCanary(),
            getCanvasDrift(),
            getInfraWatcher(),
            getAresSecurity(),
            getHermesWarden(),
          ]

          const response: WatchdogsResponse = {
            watchdogs,
            fetchedAt: Date.now(),
          }

          _cache = { data: response, expiresAt: Date.now() + CACHE_TTL_MS }

          return json(response)
        } catch (error) {
          return json(
            {
              error: error instanceof Error ? error.message : 'Failed to fetch watchdog status',
              watchdogs: [],
              fetchedAt: Date.now(),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
