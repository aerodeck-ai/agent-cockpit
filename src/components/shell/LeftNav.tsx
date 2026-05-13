/**
 * LeftNav — Cockpit D3 navigation strip.
 *
 * Exactly 5 top-level entries + ⚙ gear trigger at the bottom.
 *
 *   🏠 Home          → /
 *   🔨 Build         → /build
 *   📊 Observe       → /observe
 *   🏢 Office        → /office
 *   📚 Knowledge     → /knowledge
 *   ─────────────────
 *   ⚙  Settings     → opens <SettingsFlyout />
 *
 * The old 20+ routes (chat, files, terminal, …) are NOT deleted — they remain
 * accessible by direct URL and inside the SettingsFlyout's lazy-loaded sections.
 */
import { Link, useRouterState } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Home01Icon,
  Rocket01Icon,
  Activity01Icon,
  Building01Icon,
  BrainIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import {
  SettingsFlyout,
  SettingsTrigger,
  useSettingsFlyout,
} from '@/components/shell/SettingsFlyout'

// ── Nav entry definitions ──────────────────────────────────────────────────

type NavEntry = {
  to: string
  icon: unknown
  label: string
  matchPrefix?: string
}

const NAV_ENTRIES: Array<NavEntry> = [
  {
    to: '/',
    icon: Home01Icon,
    label: 'Home',
    matchPrefix: undefined, // exact match only
  },
  {
    to: '/build',
    icon: Rocket01Icon,
    label: 'Build',
    matchPrefix: '/build',
  },
  {
    to: '/observe',
    icon: Activity01Icon,
    label: 'Observe',
    matchPrefix: '/observe',
  },
  {
    to: '/office',
    icon: Building01Icon,
    label: 'Office',
    matchPrefix: '/office',
  },
  {
    to: '/knowledge',
    icon: BrainIcon,
    label: 'Knowledge',
    matchPrefix: '/knowledge',
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function isEntryActive(entry: NavEntry, pathname: string): boolean {
  if (entry.matchPrefix) {
    return pathname === entry.matchPrefix || pathname.startsWith(entry.matchPrefix + '/')
  }
  // exact match for root
  return pathname === entry.to
}

// ── Sub-components ─────────────────────────────────────────────────────────

function NavLink({ entry, active }: { entry: NavEntry; active: boolean }) {
  return (
    <Link
      to={entry.to as any}
      aria-label={entry.label}
      title={entry.label}
      className={cn(
        'group relative flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium transition-colors',
        'hover:bg-primary-100 dark:hover:bg-primary-800',
        active
          ? 'bg-accent-500/10 text-accent-500'
          : 'text-primary-500 dark:text-neutral-400',
      )}
    >
      {/* Active indicator bar */}
      {active && (
        <span
          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-accent-500"
          aria-hidden="true"
        />
      )}

      <HugeiconsIcon
        icon={entry.icon as any}
        size={20}
        strokeWidth={1.5}
        className={cn(
          'shrink-0 transition-colors',
          active ? 'text-accent-500' : 'text-primary-400 dark:text-neutral-500 group-hover:text-primary-700 dark:group-hover:text-neutral-200',
        )}
      />

      <span className="leading-none">{entry.label}</span>
    </Link>
  )
}

// ── Main export ────────────────────────────────────────────────────────────

export function LeftNav() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  const { open, openFlyout, closeFlyout } = useSettingsFlyout()

  return (
    <>
      <nav
        aria-label="Cockpit navigation"
        className={cn(
          'flex h-full w-14 flex-col items-stretch gap-1 border-r px-1.5 py-3',
          'theme-border theme-sidebar',
        )}
      >
        {/* Top: logo / wordmark space */}
        <div className="mb-2 flex justify-center">
          <img
            src="/claude-avatar.webp"
            alt="Hermes"
            className="size-7 rounded-lg opacity-80"
          />
        </div>

        {/* 5 nav entries */}
        <div className="flex flex-1 flex-col gap-1">
          {NAV_ENTRIES.map((entry) => (
            <NavLink
              key={entry.to}
              entry={entry}
              active={isEntryActive(entry, pathname)}
            />
          ))}
        </div>

        {/* Divider */}
        <div className="mx-auto mb-1 h-px w-8 bg-primary-200 dark:bg-primary-800" aria-hidden="true" />

        {/* ⚙ Settings trigger */}
        <div className="flex justify-center">
          <SettingsTrigger
            onClick={openFlyout}
            className="w-full flex-col gap-1 py-2 text-[10px] font-medium rounded-lg"
          />
        </div>
      </nav>

      {/* Settings flyout — rendered outside nav to avoid stacking-context issues */}
      <SettingsFlyout open={open} onClose={closeFlyout} />
    </>
  )
}
