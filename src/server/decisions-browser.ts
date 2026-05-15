/**
 * decisions-browser.ts
 *
 * Server-side reader for ~/Obsidian/Henry/AI Infrastructure/decisions/*.md
 *
 * READ-ONLY. Path validation is mandatory — every public-facing function that
 * accepts a path must call validateDecisionPath() before touching the
 * filesystem.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'

// ─── Canonical root ────────────────────────────────────────────────────────────

/**
 * Decisions live in `~/Obsidian/Henry/AI Infrastructure/decisions/` on Mac. On
 * Oracle (where this app deploys) the same directory is rsync'd to
 * `~/data/obsidian-decisions/`. Env override via `DECISIONS_DIR` for tests.
 */
const DECISIONS_CANDIDATE_DIRS = [
  process.env.DECISIONS_DIR,
  path.join(os.homedir(), 'Obsidian', 'Henry', 'AI Infrastructure', 'decisions'),
  path.join(os.homedir(), 'data', 'obsidian-decisions'),
].filter((p): p is string => Boolean(p))

const DECISIONS_DIR = DECISIONS_CANDIDATE_DIRS.find((p) => {
  try { return fs.existsSync(p) } catch { return false }
}) ?? DECISIONS_CANDIDATE_DIRS[1]

const WIRE_REPORTS_CANDIDATE_DIRS = [
  process.env.WIRE_REPORTS_DIR,
  path.join(os.homedir(), 'Obsidian', 'Henry', 'wire-reports'),
  path.join(os.homedir(), 'data', 'wire-reports'),
].filter((p): p is string => Boolean(p))

const WIRE_REPORTS_DIR = WIRE_REPORTS_CANDIDATE_DIRS.find((p) => {
  try { return fs.existsSync(p) } catch { return false }
}) ?? WIRE_REPORTS_CANDIDATE_DIRS[1]

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DecisionStatus =
  | 'completed'
  | 'in-progress'
  | 'proposed'
  | 'blocked'
  | 'draft'
  | 'decided'
  | 'approved'
  | string

export type DecisionMeta = {
  /** Relative filename, e.g. "2026-05-13-cockpit-v1-canaries.md" */
  filename: string
  title: string
  date: string | null
  status: DecisionStatus | null
  dashboard_surface: string | null
  last_verified_at: string | null
  workspace: string | null
  type: string | null
  tags: Array<string>
  wire_verified: number | null
  wire_failed: number | null
  wire_total: number | null
}

type RawFrontmatter = Record<string, unknown>

// ─── Path validation ──────────────────────────────────────────────────────────

/**
 * Validates that a filename (not a full path) refers to a .md file inside
 * DECISIONS_DIR without any traversal.  Throws on violation.
 */
export function validateDecisionFilename(filename: string): string {
  if (!filename) throw new Error('filename is required')
  // Only bare filenames — no path separators
  if (filename.includes('/') || filename.includes('\\')) {
    throw new Error('Path separators not allowed in decisions filename')
  }
  if (filename.includes('..')) {
    throw new Error('Path traversal not allowed')
  }
  if (!filename.toLowerCase().endsWith('.md')) {
    throw new Error('Only .md files are allowed')
  }
  const resolved = path.resolve(DECISIONS_DIR, filename)
  if (!resolved.startsWith(DECISIONS_DIR + path.sep) && resolved !== DECISIONS_DIR) {
    throw new Error(`Path outside decisions root: ${filename}`)
  }
  return resolved
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { data: RawFrontmatter; content: string } {
  if (!raw.startsWith('---')) {
    return { data: {}, content: raw }
  }
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    return { data: {}, content: raw }
  }
  try {
    const parsed = YAML.parse(match[1] ?? '')
    return {
      data: parsed && typeof parsed === 'object' ? (parsed as RawFrontmatter) : {},
      content: match[2] ?? '',
    }
  } catch {
    return { data: {}, content: match[2] ?? raw }
  }
}

function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s || null
}

function tags(v: unknown): Array<string> {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean)
  return []
}

// ─── Wire report parser ───────────────────────────────────────────────────────

type WireCountMap = Map<string, { verified: number; failed: number; total: number }>

function parseWireReport(content: string): WireCountMap {
  const result: WireCountMap = new Map()

  // Parse the summary table first (global totals, not per-decision)
  // Then parse per-decision sections: ### `<filename.md>`
  const sectionRegex = /###\s+`([^`]+\.md)`/g
  let match: RegExpExecArray | null

  while ((match = sectionRegex.exec(content)) !== null) {
    const filename = path.basename(match[1] ?? '')
    if (!filename) continue

    // Count ✅ / ❌ lines within the next 200 chars (good enough heuristic)
    const sectionStart = match.index + match[0].length
    const sectionEnd = Math.min(sectionStart + 2000, content.length)
    const section = content.slice(sectionStart, sectionEnd)

    const verified = (section.match(/✅/g) ?? []).length
    const failed = (section.match(/❌/g) ?? []).length
    result.set(filename, { verified, failed, total: verified + failed })
  }

  return result
}

let _cachedWireCounts: WireCountMap | null = null

function getWireCounts(): WireCountMap {
  if (_cachedWireCounts) return _cachedWireCounts

  try {
    if (!fs.existsSync(WIRE_REPORTS_DIR)) {
      _cachedWireCounts = new Map()
      return _cachedWireCounts
    }
    const files = fs.readdirSync(WIRE_REPORTS_DIR)
      .filter((f) => f.endsWith('.md') && !f.includes('postpatch') && !f.endsWith('.bak'))
      .sort()
      .reverse()

    const latest = files[0]
    if (!latest) {
      _cachedWireCounts = new Map()
      return _cachedWireCounts
    }

    const content = fs.readFileSync(path.join(WIRE_REPORTS_DIR, latest), 'utf-8')
    _cachedWireCounts = parseWireReport(content)
    return _cachedWireCounts
  } catch {
    _cachedWireCounts = new Map()
    return _cachedWireCounts
  }
}

// ─── Core listing logic ───────────────────────────────────────────────────────

function buildDecisionMeta(filename: string, raw: string): DecisionMeta {
  const { data } = parseFrontmatter(raw)
  const wire = getWireCounts().get(filename)

  return {
    filename,
    title: str(data.title) ?? filename.replace(/\.md$/i, ''),
    date: str(data.date),
    status: str(data.status),
    dashboard_surface: str(data.dashboard_surface),
    last_verified_at: str(data.last_verified_at),
    workspace: str(data.workspace),
    type: str(data.type),
    tags: tags(data.tags),
    wire_verified: wire?.verified ?? null,
    wire_failed: wire?.failed ?? null,
    wire_total: wire?.total ?? null,
  }
}

/**
 * List all decision files.
 * @param includeInternalOnly - when false (default) files with
 *   dashboard_surface === "internal-only" are excluded.
 */
export function listDecisions(includeInternalOnly = false): Array<DecisionMeta> {
  if (!fs.existsSync(DECISIONS_DIR)) return []

  const files = fs
    .readdirSync(DECISIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.md') && !f.includes('.bak'))
    .sort()
    .reverse() // most recent first (date-prefixed filenames)

  const result: Array<DecisionMeta> = []
  for (const filename of files) {
    const fullPath = path.join(DECISIONS_DIR, filename)
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8')
      const meta = buildDecisionMeta(filename, raw)
      if (!includeInternalOnly && meta.dashboard_surface === 'internal-only') {
        continue
      }
      result.push(meta)
    } catch {
      // skip unreadable files
    }
  }
  return result
}

/**
 * Read the markdown body of a specific decision file.
 * The filename must pass validateDecisionFilename().
 */
export function readDecisionBody(filename: string): {
  meta: DecisionMeta
  content: string
} {
  const fullPath = validateDecisionFilename(filename)
  const raw = fs.readFileSync(fullPath, 'utf-8')
  const { content } = parseFrontmatter(raw)
  const meta = buildDecisionMeta(filename, raw)
  return { meta, content }
}

export function decisionsDirectoryExists(): boolean {
  return fs.existsSync(DECISIONS_DIR)
}
