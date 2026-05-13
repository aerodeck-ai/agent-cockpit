export function ArchitectureTab() {
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
            d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"
          />
        </svg>
      </div>
      <h3 className="text-sm font-medium text-ink">Architecture view coming in v1.1</h3>
      <p className="max-w-xs text-xs text-primary-400">
        React Flow system architecture diagrams will be surfaced here in the next release
        (F7 content). The interactive graph will visualise component relationships and data flows.
      </p>
    </div>
  )
}
