export function DiagramsTab() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="rounded-full bg-primary-100/80 p-4 dark:bg-primary-800/40">
        <svg
          className="h-8 w-8 text-primary-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 3h10M7 3a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2M7 3v2m10-2v2M9 9h6M9 13h6M9 17h4"
          />
        </svg>
      </div>
      <h3 className="text-sm font-medium text-ink">SVG renders will land in v1.1</h3>
      <p className="max-w-xs text-xs text-primary-400">
        Mermaid diagram rendering is planned for the next release. Architecture diagrams
        from the Obsidian vault will appear here automatically.
      </p>
    </div>
  )
}
