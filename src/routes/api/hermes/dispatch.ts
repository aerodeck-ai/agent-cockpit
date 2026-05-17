/**
 * POST /api/hermes/dispatch
 *
 * Bridge handler — receives signed webhooks from VectOS (`berlai-ops`)
 * when a `kanban_tasks` row transitions to `status='dispatched'`. Inserts
 * a matching task into the Hermes execution board so `hermes-chief-of-staff`
 * picks it up on the next 60s poll.
 *
 * Idempotency: `card_id` doubles as `tasks.idempotency_key` and the
 * returned `hermes_run_id`. Replaying the same webhook returns the
 * existing run_id without inserting a duplicate task.
 *
 * Target DB: /home/ubuntu/.hermes/kanban.db on Oracle (same host).
 * Uses python3 sqlite3 to avoid better-sqlite3 native build pain.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { execFileSync } from 'node:child_process'
import { createHmac, timingSafeEqual } from 'node:crypto'

const HERMES_KANBAN_DB =
  process.env.HERMES_KANBAN_DB ?? '/home/ubuntu/.hermes/kanban.db'
const BRIDGE_WEBHOOK_SECRET = process.env.BRIDGE_WEBHOOK_SECRET ?? ''

interface DispatchBody {
  card_id: string
  title: string
  description?: string
  source: string
  idempotency_key: string
  ts: number
  tenant?: string
  // Phase B Step 2 — HCoS dispatcher's claim SQL requires `assignee IS NOT NULL`.
  // Default to hermes-chief-of-staff when caller omits. Future Mally enablement
  // (gated on M2-3): VectOS passes `tenant`, bridge maps to hermes-{tenant}.
  assignee?: string
}

const PYTHON_UPSERT = `
import json, sqlite3, sys

db_path = sys.argv[1]
payload = json.loads(sys.argv[2])

conn = sqlite3.connect(db_path)
conn.execute("PRAGMA foreign_keys=ON")
cur = conn.cursor()

card_id = payload["card_id"]
now_ms = int(payload.get("ts") or 0) or None
if not now_ms:
    cur.execute("SELECT CAST(strftime('%s','now') AS INTEGER) * 1000")
    (now_ms,) = cur.fetchone()

existing = cur.execute(
    "SELECT id, status, current_run_id FROM tasks WHERE idempotency_key=?",
    (card_id,),
).fetchone()

if existing:
    task_id, status, current_run_id = existing
    print(json.dumps({
        "ok": True,
        "hermes_run_id": task_id,
        "status": status,
        "deduped": True,
    }))
    sys.exit(0)

cur.execute(
    "INSERT INTO tasks (id, title, body, status, assignee, tenant, created_by, created_at, idempotency_key) "
    "VALUES (?, ?, ?, 'ready', ?, ?, ?, ?, ?)",
    (
        card_id,
        payload["title"],
        payload.get("description") or None,
        payload.get("assignee") or "hermes-chief-of-staff",
        payload.get("tenant") or "berlai",
        "bridge:vectos",
        now_ms,
        card_id,
    ),
)
conn.commit()

print(json.dumps({
    "ok": True,
    "hermes_run_id": card_id,
    "status": "ready",
    "deduped": False,
}))
`.trim()

function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!BRIDGE_WEBHOOK_SECRET) return false
  if (!signature) return false
  const expected = createHmac('sha256', BRIDGE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(signature, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function validateBody(value: unknown): DispatchBody | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.card_id !== 'string' || !v.card_id.trim()) return null
  if (typeof v.title !== 'string' || !v.title.trim()) return null
  if (typeof v.source !== 'string' || !v.source.trim()) return null
  if (typeof v.idempotency_key !== 'string' || !v.idempotency_key.trim()) return null
  if (v.idempotency_key !== v.card_id) return null
  return {
    card_id: v.card_id,
    title: v.title,
    description: typeof v.description === 'string' ? v.description : undefined,
    source: v.source,
    idempotency_key: v.idempotency_key,
    ts: typeof v.ts === 'number' ? v.ts : 0,
    tenant: typeof v.tenant === 'string' ? v.tenant : undefined,
    assignee: typeof v.assignee === 'string' && v.assignee.trim()
      ? v.assignee.trim()
      : undefined,
  }
}

export const Route = createFileRoute('/api/hermes/dispatch')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text()
        const signature = request.headers.get('x-bridge-signature')
        if (!verifySignature(rawBody, signature)) {
          return json({ ok: false, error: 'Invalid signature' }, { status: 401 })
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(rawBody)
        } catch {
          return json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
        }

        const body = validateBody(parsed)
        if (!body) {
          return json(
            { ok: false, error: 'Missing/invalid fields (card_id, title, source, idempotency_key)' },
            { status: 400 },
          )
        }

        try {
          const stdout = execFileSync(
            'python3',
            ['-c', PYTHON_UPSERT, HERMES_KANBAN_DB, JSON.stringify(body)],
            { timeout: 8_000, encoding: 'utf8' },
          ).trim()
          const result = JSON.parse(stdout) as {
            ok: boolean
            hermes_run_id: string
            status: string
            deduped: boolean
          }
          return json(result, { status: 200 })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown error'
          return json({ ok: false, error: `Bridge insert failed: ${msg}` }, { status: 500 })
        }
      },
    },
  },
})
