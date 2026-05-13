import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useState } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { cn } from '@/lib/utils'

// Lazy-load each tab to keep the initial bundle small
const SearchTab = lazy(() =>
  import('@/screens/knowledge/SearchTab').then((m) => ({ default: m.SearchTab })),
)
const DecisionsTab = lazy(() =>
  import('@/screens/knowledge/DecisionsTab').then((m) => ({ default: m.DecisionsTab })),
)
const ResearchTab = lazy(() =>
  import('@/screens/knowledge/ResearchTab').then((m) => ({ default: m.ResearchTab })),
)
const DiagramsTab = lazy(() =>
  import('@/screens/knowledge/DiagramsTab').then((m) => ({ default: m.DiagramsTab })),
)
const ArchitectureTab = lazy(() =>
  import('@/screens/knowledge/ArchitectureTab').then((m) => ({ default: m.ArchitectureTab })),
)

type TabId = 'search' | 'decisions' | 'research' | 'diagrams' | 'architecture'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'search', label: 'Search' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'research', label: 'Research' },
  { id: 'diagrams', label: 'Diagrams' },
  { id: 'architecture', label: 'Architecture' },
]

export const Route = createFileRoute('/knowledge')({
  ssr: false,
  component: KnowledgeRoute,
})

function TabFallback() {
  return (
    <div className="flex flex-col gap-2 animate-pulse py-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-14 rounded-lg bg-primary-100/60 dark:bg-primary-800/40" />
      ))}
    </div>
  )
}

function KnowledgeRoute() {
  usePageTitle('Knowledge')
  const [activeTab, setActiveTab] = useState<TabId>('search')

  return (
    <div className="min-h-full overflow-y-auto bg-surface text-ink">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">Knowledge</h1>
          <p className="mt-1 text-sm text-primary-500 dark:text-primary-400">
            Search and browse your knowledge base, decisions, and research.
          </p>
        </div>

        {/* Tab strip */}
        <div className="mb-6 flex gap-1 rounded-lg border border-primary-200 bg-primary-50/85 p-1 backdrop-blur-xl dark:border-primary-800 dark:bg-primary-900/60">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex-1 rounded-md px-4 py-2 text-sm font-medium capitalize transition-colors',
                activeTab === tab.id
                  ? 'bg-primary-100 text-ink shadow-sm dark:bg-neutral-800'
                  : 'text-primary-500 hover:text-ink',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <Suspense fallback={<TabFallback />}>
          {activeTab === 'search' && <SearchTab />}
          {activeTab === 'decisions' && <DecisionsTab />}
          {activeTab === 'research' && <ResearchTab />}
          {activeTab === 'diagrams' && <DiagramsTab />}
          {activeTab === 'architecture' && <ArchitectureTab />}
        </Suspense>
      </div>
    </div>
  )
}
