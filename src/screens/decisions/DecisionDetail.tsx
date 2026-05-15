import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DecisionMeta } from '@/server/decisions-browser'

type Props = {
  filename: string
  onClose: () => void
}

type ReadResponse = {
  meta?: DecisionMeta
  content?: string
  error?: string
}

export function DecisionDetail({ filename, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [meta, setMeta] = useState<DecisionMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setContent(null)
    setMeta(null)

    void fetch(`/api/decisions/read?filename=${encodeURIComponent(filename)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as ReadResponse
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<ReadResponse>
      })
      .then((data) => {
        setContent(data.content ?? '')
        setMeta(data.meta ?? null)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load decision')
        setLoading(false)
      })
  }, [filename])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b border-primary-200 dark:border-primary-800 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink truncate">
            {meta?.title ?? filename.replace(/\.md$/i, '')}
          </p>
          <p className="text-xs text-primary-400 mt-0.5 truncate">{filename}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-primary-400 hover:text-ink hover:bg-primary-100 dark:hover:bg-primary-800 transition-colors"
          aria-label="Close detail"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && (
          <div className="flex flex-col gap-2 animate-pulse">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-4 rounded bg-primary-100/60 dark:bg-primary-800/40"
                style={{ width: `${60 + ((i * 37) % 40)}%` }}
              />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}

        {!loading && !error && content != null && (
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
