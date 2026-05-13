/**
 * /api/approvals/aggregate
 *
 * Aggregates pending approvals from 4 sources:
 *  1. GitHub PRs awaiting review (`gh pr list --review-requested`)
 *  2. relay.db rows with status='pending_henry_approval'
 *  3. ~/Drafts/ folder (drafted emails awaiting send)
 *  4. BotFather queue file (~/.hermes/botfather-queue.json)
 *
 * Returns [{source, id, title, link, age_s}]
 * Auth: CF Access required.
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'
import { resolveTenantFromRequest } from '../../../lib/auth/tenants'

export type ApprovalItem = {
  source: 'github_pr' | 'relay' | 'draft_email' | 'botfather'
  id: string
  title: string
  link: string | null
  age_s: number
}

const RELAY_DB_PATH = join(
  process.env.HERMES_HOME ?? join(homedir(), '.hermes'),
  'relay.db',
)

const DRAFTS_DIR = join(homedir(), 'Drafts')

const BOTFATHER_QUEUE = join(
  process.env.HERMES_HOME ?? join(homedir(), '.hermes'),
  'botfather-queue.json',
)

function nowS(): number {
  return Math.floor(Date.now() / 1000)
}

/** Poll GitHub PRs that need review */
async function fetchGithubPRs(isMally: boolean): Promise<ApprovalItem[]> {
  if (isMally) return [] // Mally doesn't have GH access yet
  try {
    const raw = execSync(
      'gh pr list --json number,title,url,createdAt --limit 20 2>/dev/null',
      { timeout: 5000, encoding: 'utf8' },
    )
    const prs: Array<{ number: number; title: string; url: string; createdAt: string }> =
      JSON.parse(raw)
    return prs.map((pr) => ({
      source: 'github_pr' as const,
      id: `gh-${pr.number}`,
      title: `PR #${pr.number}: ${pr.title}`,
      link: pr.url,
      age_s: nowS() - Math.floor(new Date(pr.createdAt).getTime() / 1000),
    }))
  } catch {
    return []
  }
}

/** Poll relay.db for pending approval rows */
async function fetchRelayApprovals(
  tenant: string,
): Promise<ApprovalItem[]> {
  if (!existsSync(RELAY_DB_PATH)) return []
  try {
    const Database = (await import('better-sqlite3')).default
    const db = new Database(RELAY_DB_PATH, {
      readonly: true,
      fileMustExist: true,
    })

    // Try warroom_sessions first; relay schema may vary
    let rows: Array<{ id: number | string; title: string; created_at: string }> = []
    try {
      rows = db
        .prepare(
          `SELECT id, COALESCE(title, summary, 'Pending approval') AS title,
                  COALESCE(created_at, datetime('now')) AS created_at
           FROM warroom_sessions
           WHERE status = 'pending_henry_approval'
           ORDER BY created_at DESC
           LIMIT 10`,
        )
        .all() as typeof rows
    } catch {
      // Table or column doesn't exist — skip gracefully
    }

    db.close()

    return rows.map((r) => ({
      source: 'relay' as const,
      id: `relay-${r.id}`,
      title: String(r.title),
      link: null,
      age_s: nowS() - Math.floor(new Date(r.created_at).getTime() / 1000),
    }))
  } catch {
    return []
  }
}

/** Scan ~/Drafts/ for email draft files */
function fetchDraftEmails(): ApprovalItem[] {
  if (!existsSync(DRAFTS_DIR)) return []
  try {
    const entries = readdirSync(DRAFTS_DIR).filter(
      (f) => f.endsWith('.txt') || f.endsWith('.md') || f.endsWith('.eml'),
    )
    return entries.slice(0, 10).map((filename) => {
      const fp = join(DRAFTS_DIR, filename)
      let stat: ReturnType<typeof statSync> | null = null
      try {
        stat = statSync(fp)
      } catch {}
      const age_s = stat
        ? nowS() - Math.floor(stat.mtimeMs / 1000)
        : 0
      return {
        source: 'draft_email' as const,
        id: `draft-${filename}`,
        title: `Draft: ${filename.replace(/\.(txt|md|eml)$/, '')}`,
        link: null,
        age_s,
      }
    })
  } catch {
    return []
  }
}

/** Read BotFather queue file */
function fetchBotfatherQueue(): ApprovalItem[] {
  if (!existsSync(BOTFATHER_QUEUE)) return []
  try {
    const raw = readFileSync(BOTFATHER_QUEUE, 'utf8')
    const items: Array<{ id?: string; name?: string; title?: string; created_at?: string }> =
      JSON.parse(raw)
    return (Array.isArray(items) ? items : []).slice(0, 10).map((item, idx) => ({
      source: 'botfather' as const,
      id: String(item.id ?? `bot-${idx}`),
      title: `Bot slot: ${item.name ?? item.title ?? 'unnamed'}`,
      link: null,
      age_s: item.created_at
        ? nowS() - Math.floor(new Date(item.created_at).getTime() / 1000)
        : 0,
    }))
  } catch {
    return []
  }
}

export const Route = createFileRoute('/api/approvals/aggregate')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const tenantInfo = resolveTenantFromRequest(request)
        const tenant = tenantInfo?.tenant ?? 'henry_cos'
        const isMally = tenant === 'mally'

        const [githubPRs, relayItems] = await Promise.all([
          fetchGithubPRs(isMally),
          fetchRelayApprovals(tenant),
        ])

        const draftItems = fetchDraftEmails()
        const botfatherItems = fetchBotfatherQueue()

        const all: ApprovalItem[] = [
          ...githubPRs,
          ...relayItems,
          ...draftItems,
          ...botfatherItems,
        ].sort((a, b) => a.age_s - b.age_s) // newest first

        return new Response(
          JSON.stringify({ items: all, total: all.length }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
          },
        )
      },
    },
  },
})
