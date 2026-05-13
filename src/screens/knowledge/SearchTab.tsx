import { useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

type SearchResult = {
  path: string
  title: string
  line: number
  text: string
}

function highlightQuery(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const needle = query.trim().toLowerCase()
  if (!needle) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const parts: Array<{ text: string; hit: boolean }> = []
  let cursor = 0
  while (cursor < text.length) {
    const idx = lower.indexOf(needle, cursor)
    if (idx < 0) {
      parts.push({ text: text.slice(cursor), hit: false })
      break
    }
    if (idx > cursor) parts.push({ text: text.slice(cursor, idx), hit: false })
    parts.push({ text: text.slice(idx, idx + needle.length), hit: true })
    cursor = idx + needle.length
  }
  return parts.length > 0 ? parts : [{ text, hit: false }]
}

export function SearchTab() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<SearchResult>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setResults([])
      setSearched(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/knowledge/search?q=${encodeURIComponent(trimmed)}`)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Search failed (${res.status})`)
      }
      const data = (await res.json()) as { results?: Array<SearchResult> }
      setResults(data.results ?? [])
      setSearched(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void runSearch(query)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search knowledge base… (Enter to search)"
          className={cn(
            'flex-1 rounded-md border border-primary-200 bg-primary-50/50 px-3 py-2',
            'text-sm text-ink placeholder:text-primary-400',
            'focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500',
            'dark:border-primary-700 dark:bg-primary-900/40',
          )}
        />
        <button
          onClick={() => void runSearch(query)}
          disabled={loading}
          className={cn(
            'rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white',
            'hover:bg-accent-600 disabled:opacity-50 transition-colors',
          )}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      {searched && !loading && results.length === 0 && (
        <p className="text-sm text-primary-400">No results for &ldquo;{query}&rdquo;</p>
      )}

      {results.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-primary-400">
            {results.length} result{results.length !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
          </p>
          {results.map((result, i) => (
            <div
              key={`${result.path}-${result.line}-${i}`}
              className="rounded-lg border border-primary-200 bg-primary-50/60 px-4 py-3 dark:border-primary-800 dark:bg-primary-900/30"
            >
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-sm font-medium text-ink">{result.title}</span>
                <span className="text-xs text-primary-400">line {result.line}</span>
              </div>
              <p className="text-xs font-mono text-primary-500 dark:text-primary-400 truncate">
                {highlightQuery(result.text, query).map((part, j) =>
                  part.hit ? (
                    <mark key={j} className="bg-accent-200 text-accent-900 dark:bg-accent-800 dark:text-accent-100 rounded-sm px-0.5">
                      {part.text}
                    </mark>
                  ) : (
                    <span key={j}>{part.text}</span>
                  ),
                )}
              </p>
              <p className="mt-1 text-xs text-primary-400 truncate">{result.path}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
