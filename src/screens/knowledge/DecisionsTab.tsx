import { useEffect, useState } from 'react'

type WikiPageMeta = {
  path: string
  title: string
  updated?: string
  modified: string
  summary?: string
}

type KnowledgeListResponse = {
  pages?: Array<WikiPageMeta>
  exists?: boolean
}

function formatDate(value?: string): string | null {
  if (!value) return null
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

export function DecisionsTab() {
  const [pages, setPages] = useState<Array<WikiPageMeta>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/knowledge/list')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`)
        return res.json() as Promise<KnowledgeListResponse>
      })
      .then((data) => {
        // Filter for decision-like pages (by path or type)
        const all = data.pages ?? []
        const decisions = all.filter(
          (p) =>
            p.path.toLowerCase().includes('decision') ||
            p.path.toLowerCase().includes('Decision'),
        )
        setPages(decisions.length > 0 ? decisions : all.slice(0, 20))
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load decisions')
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col gap-2 animate-pulse">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-primary-100/60 dark:bg-primary-800/40" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        <p className="font-medium mb-1">Obsidian helper not available</p>
        <p className="text-xs opacity-80">{error}</p>
        <p className="mt-2 text-xs opacity-60">
          Configure <code>KNOWLEDGE_DIR</code> to point to your Obsidian decisions folder.
        </p>
      </div>
    )
  }

  if (pages.length === 0) {
    return (
      <p className="text-sm text-primary-400">
        No decision files found. Set <code className="text-xs">KNOWLEDGE_DIR</code> to your Obsidian/Henry/Decisions directory.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-primary-400 mb-1">
        {pages.length} decision{pages.length !== 1 ? 's' : ''} found
      </p>
      {pages.map((page) => (
        <div
          key={page.path}
          className="rounded-lg border border-primary-200 bg-primary-50/60 px-4 py-3 dark:border-primary-800 dark:bg-primary-900/30"
        >
          <p className="text-sm font-medium text-ink">{page.title}</p>
          {page.summary && (
            <p className="mt-0.5 text-xs text-primary-500 dark:text-primary-400 line-clamp-2">{page.summary}</p>
          )}
          <div className="mt-1 flex items-center gap-3">
            <span className="text-xs text-primary-400 truncate">{page.path}</span>
            {(page.updated ?? page.modified) && (
              <span className="text-xs text-primary-400 shrink-0">
                {formatDate(page.updated ?? page.modified)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
