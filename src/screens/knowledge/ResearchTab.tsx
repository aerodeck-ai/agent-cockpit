import { useEffect, useState } from 'react'

type WikiPageMeta = {
  path: string
  title: string
  updated?: string
  modified: string
  summary?: string
  tags: Array<string>
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

export function ResearchTab() {
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
        const all = data.pages ?? []
        // Filter for research-like pages
        const research = all.filter(
          (p) =>
            p.path.toLowerCase().includes('research') ||
            p.tags?.some((t) => t.toLowerCase() === 'research'),
        )
        setPages(research.length > 0 ? research : all.slice(0, 20))
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load research pages')
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
          Configure <code>KNOWLEDGE_DIR</code> to point to your Obsidian research folder.
        </p>
      </div>
    )
  }

  if (pages.length === 0) {
    return (
      <p className="text-sm text-primary-400">
        No research files found. Set <code className="text-xs">KNOWLEDGE_DIR</code> to your Obsidian/Henry/AI Infrastructure/research directory.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-primary-400 mb-1">
        {pages.length} research note{pages.length !== 1 ? 's' : ''}
      </p>
      {pages.map((page) => (
        <div
          key={page.path}
          className="rounded-lg border border-primary-200 bg-primary-50/60 px-4 py-3 dark:border-primary-800 dark:bg-primary-900/30"
        >
          <p className="text-sm font-medium text-ink">{page.title}</p>
          {page.summary && (
            <p className="mt-0.5 text-xs text-primary-500 dark:text-primary-400 line-clamp-2">
              {page.summary}
            </p>
          )}
          {page.tags && page.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {page.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-accent-100 px-2 py-0.5 text-xs text-accent-700 dark:bg-accent-900/40 dark:text-accent-300"
                >
                  {tag}
                </span>
              ))}
            </div>
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
