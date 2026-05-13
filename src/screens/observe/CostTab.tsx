/**
 * CostTab — v1 stub.
 * Full cost dashboard is planned for v1.1 (iframed Helicone).
 */

export function CostTab() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground p-10">
      <span className="text-5xl">📊</span>
      <p className="text-base font-medium text-foreground">
        Cost dashboard coming in v1.1
      </p>
      <p className="text-sm text-center max-w-sm">
        Will iframe Helicone for per-model, per-tenant cost breakdown with daily
        budget comparison.
      </p>
      <a
        href="https://helicone.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-primary hover:underline"
      >
        Open Helicone →
      </a>
    </div>
  )
}
