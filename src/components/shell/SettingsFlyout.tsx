'use client'

import { lazy, Suspense, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useTenantRole } from '@/hooks/use-tenant-role'

// ── Lazy-loaded screen components ─────────────────────────────────────────
// Import screen components directly (not route wrappers) to avoid
// route-level hooks like usePageTitle running inside the flyout.

const ModelsScreenLazy = lazy(() =>
  import('@/screens/models/models-screen').then((m) => ({ default: m.ModelsScreen })),
)
const PromptsScreenLazy = lazy(() =>
  import('@/screens/prompts/prompts-screen').then((m) => ({ default: m.PromptsScreen })),
)
const GuardrailsScreenLazy = lazy(() =>
  import('@/screens/guardrails/guardrails-screen').then((m) => ({ default: m.GuardrailsScreen })),
)
const McpScreenLazy = lazy(() =>
  import('@/screens/mcp/mcp-screen').then((m) => ({ default: m.McpScreen })),
)
const SkillsScreenLazy = lazy(() =>
  import('@/screens/skills/skills-screen').then((m) => ({ default: m.SkillsScreen })),
)

// Wrapper for PromptsScreen that owns its own tab state
function PromptsWrapper() {
  const [tab, setTab] = useState<'library' | 'editor' | 'assignments'>('library')
  return <PromptsScreenLazy tab={tab} onTabChange={setTab} />
}

// ── Types ──────────────────────────────────────────────────────────────────

type SectionId =
  | 'models'
  | 'prompts'
  | 'guardrails'
  | 'mcp'
  | 'skills'
  | 'accounts'
  | 'tenants'
  | 'audit'
  | 'profiles'
  | 'bots'
  | 'env'

type Section = {
  id: SectionId
  label: string
  henryOnly?: boolean
  mallyHidden?: boolean
}

const SECTIONS: Array<Section> = [
  { id: 'models', label: 'Models' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'guardrails', label: 'Guardrails' },
  { id: 'mcp', label: 'MCP' },
  { id: 'skills', label: 'Skills' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'tenants', label: 'Tenants', mallyHidden: true },
  { id: 'audit', label: 'Audit' },
  { id: 'profiles', label: 'Profiles', mallyHidden: true },
  { id: 'bots', label: 'Bots', mallyHidden: true },
  { id: 'env', label: 'Environment', mallyHidden: true },
]

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionFallback() {
  return (
    <div className="flex flex-col gap-2 animate-pulse p-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-10 rounded bg-primary-100/60 dark:bg-primary-800/40" />
      ))}
    </div>
  )
}

function StubSection({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center px-4">
      <p className="text-sm font-medium text-ink">{label}</p>
      <p className="text-xs text-primary-400">Full UI coming in v1.1</p>
    </div>
  )
}

function EnvSection() {
  const cockpitEnv = typeof window !== 'undefined'
    ? (window as { NEXT_PUBLIC_COCKPIT_ENV?: string }).NEXT_PUBLIC_COCKPIT_ENV ??
      import.meta.env?.VITE_COCKPIT_ENV ??
      'development'
    : 'development'

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="rounded-lg border border-primary-200 bg-primary-50/60 px-4 py-3 dark:border-primary-800 dark:bg-primary-900/30">
        <p className="text-xs text-primary-400 mb-1">Current environment</p>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
              cockpitEnv === 'production'
                ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
            )}
          >
            {cockpitEnv}
          </span>
          <span className="text-xs text-primary-400">(read-only in v1)</span>
        </div>
      </div>
      <p className="text-xs text-primary-400">
        Environment switcher will be enabled in v1.1. Set{' '}
        <code className="rounded bg-primary-100 px-1 dark:bg-primary-800">NEXT_PUBLIC_COCKPIT_ENV</code>{' '}
        to control the current value.
      </p>
    </div>
  )
}

function CollapsibleSection({
  section,
  isOpen,
  onToggle,
}: {
  section: Section
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <div className="border-b border-primary-200 dark:border-primary-800 last:border-b-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-primary-50/50 dark:hover:bg-primary-900/30 transition-colors"
      >
        <span className="text-sm font-medium text-ink">{section.label}</span>
        <svg
          className={cn(
            'h-4 w-4 text-primary-400 transition-transform duration-200',
            isOpen ? 'rotate-180' : '',
          )}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <div
        style={{
          maxHeight: isOpen ? '600px' : '0',
          overflow: 'hidden',
          transition: 'max-height 0.25s ease',
        }}
      >
        <Suspense fallback={<SectionFallback />}>
          {isOpen && <SectionContent id={section.id} label={section.label} />}
        </Suspense>
      </div>
    </div>
  )
}

function SectionContent({ id, label }: { id: SectionId; label: string }) {
  const { isHenry } = useTenantRole()

  switch (id) {
    case 'models':
      return (
        <div className="px-4 pb-4 overflow-y-auto max-h-[500px]">
          <ModelsScreenLazy canEdit={isHenry} />
        </div>
      )
    case 'prompts':
      return (
        <div className="px-4 pb-4 overflow-y-auto max-h-[500px]">
          <PromptsWrapper />
        </div>
      )
    case 'guardrails':
      return (
        <div className="px-4 pb-4 overflow-y-auto max-h-[500px]">
          <GuardrailsScreenLazy />
        </div>
      )
    case 'mcp':
      return (
        <div className="px-4 pb-4 overflow-y-auto max-h-[500px]">
          <McpScreenLazy />
        </div>
      )
    case 'skills':
      return (
        <div className="px-4 pb-4 overflow-y-auto max-h-[500px]">
          <SkillsScreenLazy />
        </div>
      )
    case 'env':
      return <EnvSection />
    default:
      return <StubSection label={label} />
  }
}

// ── Main export ────────────────────────────────────────────────────────────

export interface SettingsFlyoutProps {
  open: boolean
  onClose: () => void
}

export function SettingsFlyout({ open, onClose }: SettingsFlyoutProps) {
  const { isMally } = useTenantRole()
  const [openSections, setOpenSections] = useState<Set<SectionId>>(new Set())

  // Close on Esc
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  const toggleSection = (id: SectionId) => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const visibleSections = SECTIONS.filter((s) => {
    if (isMally && s.mallyHidden) return false
    return true
  })

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 40,
          backgroundColor: 'rgba(0,0,0,0.4)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label="Settings"
        aria-modal="true"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '400px',
          maxWidth: '100vw',
          zIndex: 50,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease',
          display: 'flex',
          flexDirection: 'column',
        }}
        className="bg-surface border-l border-primary-200 dark:border-primary-800 shadow-2xl"
      >
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-primary-200 px-4 py-3 dark:border-primary-800 shrink-0">
          <h2 className="text-base font-semibold text-ink">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-primary-400 hover:bg-primary-100 hover:text-ink dark:hover:bg-primary-800 transition-colors"
            aria-label="Close settings"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable section list */}
        <div className="flex-1 overflow-y-auto">
          {visibleSections.map((section) => (
            <CollapsibleSection
              key={section.id}
              section={section}
              isOpen={openSections.has(section.id)}
              onToggle={() => toggleSection(section.id)}
            />
          ))}
        </div>
      </div>
    </>
  )
}

// ── Trigger button (export so D3 LeftNav can drop it in) ───────────────────

export interface SettingsTriggerProps {
  onClick: () => void
  className?: string
}

export function SettingsTrigger({ onClick, className }: SettingsTriggerProps) {
  return (
    <button
      onClick={onClick}
      aria-label="Open settings"
      className={cn(
        'flex items-center justify-center rounded-md p-2 text-primary-400',
        'hover:bg-primary-100 hover:text-ink dark:hover:bg-primary-800 transition-colors',
        className,
      )}
    >
      ⚙
    </button>
  )
}

// ── Controlled hook for wiring ─────────────────────────────────────────────

export function useSettingsFlyout() {
  const [open, setOpen] = useState(false)
  return {
    open,
    openFlyout: () => setOpen(true),
    closeFlyout: () => setOpen(false),
  }
}
