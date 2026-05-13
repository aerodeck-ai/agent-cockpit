/**
 * ErrorsTab — v1 stub. Will show live error feed from Hermes/Claude hooks.
 *
 * Planned: tail ~/.claude/logs/errors-*.jsonl + hermes_findings severity=error
 */

export function ErrorsTab() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground p-10">
      <span className="text-5xl">🚨</span>
      <p className="text-base font-medium text-foreground">
        Error feed coming soon
      </p>
      <p className="text-sm text-center max-w-sm">
        Will tail <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">~/.claude/logs/errors-*.jsonl</code>{' '}
        and surface{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">hermes_findings</code>{' '}
        entries with <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">severity=error</code>.
      </p>
    </div>
  )
}
