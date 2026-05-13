/**
 * Per-server health badges sourced from connection-registry.db.
 *
 * DB path: /home/ubuntu/data/sqlite/connection-registry/connection-registry.db
 * (the /home/ubuntu/mcp-infra/data/connection-registry.db stub is 0 bytes)
 *
 * Columns used: name, last_ok_at, last_fail_at, consecutive_failures
 * Cache TTL: 60 s
 *
 * We shell out to python3 to avoid a better-sqlite3 native dep build.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DB_PATH =
  process.env.CONNECTION_REGISTRY_DB ??
  '/home/ubuntu/data/sqlite/connection-registry/connection-registry.db'

const CACHE_TTL_MS = 60_000

export type HealthStatus = 'green' | 'yellow' | 'red' | 'unknown'

export interface ServerHealth {
  name: string
  status: HealthStatus
  lastOkAt: string | null
  lastFailAt: string | null
  consecutiveFailures: number
}

const PYTHON_SCRIPT = `
import json, sqlite3, sys, os

db_path = sys.argv[1]
if not os.path.exists(db_path):
    print(json.dumps([]))
    sys.exit(0)

try:
    conn = sqlite3.connect("file:" + db_path + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT name, last_ok_at, last_fail_at, consecutive_failures FROM connections"
    ).fetchall()
    print(json.dumps([dict(r) for r in rows]))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`.trim()

interface CacheEntry {
  data: Array<ServerHealth>
  fetchedAt: number
}

let cache: CacheEntry | null = null

function classify(
  lastOkAt: string | null,
  lastFailAt: string | null,
  consecutiveFailures: number,
): HealthStatus {
  if (!lastOkAt && !lastFailAt) return 'unknown'
  if (consecutiveFailures >= 3) return 'red'
  if (!lastOkAt && lastFailAt) return 'red'

  const okMs = lastOkAt ? new Date(lastOkAt + 'Z').getTime() : 0
  const failMs = lastFailAt ? new Date(lastFailAt + 'Z').getTime() : 0

  if (failMs > okMs && consecutiveFailures >= 1) return 'yellow'
  // green if last ok is within 6 hours
  const sixHours = 6 * 60 * 60 * 1000
  if (Date.now() - okMs > sixHours) return 'yellow'
  return 'green'
}

function fetchFromDb(): Array<ServerHealth> {
  try {
    const stdout = execFileSync('python3', ['-c', PYTHON_SCRIPT, DB_PATH], {
      timeout: 5000,
      encoding: 'utf8',
    })
    const raw = JSON.parse(stdout.trim()) as unknown
    if (!Array.isArray(raw)) return []
    return (raw as Array<Record<string, unknown>>).map((r) => ({
      name: String(r.name ?? ''),
      status: classify(
        r.last_ok_at ? String(r.last_ok_at) : null,
        r.last_fail_at ? String(r.last_fail_at) : null,
        Number(r.consecutive_failures ?? 0),
      ),
      lastOkAt: r.last_ok_at ? String(r.last_ok_at) : null,
      lastFailAt: r.last_fail_at ? String(r.last_fail_at) : null,
      consecutiveFailures: Number(r.consecutive_failures ?? 0),
    }))
  } catch {
    return []
  }
}

export function getHealthMap(): Map<string, ServerHealth> {
  const now = Date.now()
  if (!cache || now - cache.fetchedAt > CACHE_TTL_MS) {
    const data = fetchFromDb()
    cache = { data, fetchedAt: now }
  }
  const map = new Map<string, ServerHealth>()
  for (const entry of cache.data) {
    map.set(entry.name, entry)
  }
  return map
}

export function getServerHealth(name: string): ServerHealth | null {
  return getHealthMap().get(name) ?? null
}

export function listServerHealths(): Array<ServerHealth> {
  const map = getHealthMap()
  return Array.from(map.values())
}
