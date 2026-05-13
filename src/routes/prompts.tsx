import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { PromptsScreen } from '@/screens/prompts/prompts-screen'

export const Route = createFileRoute('/prompts')({
  ssr: false,
  component: PromptsRoute,
})

function PromptsRoute() {
  usePageTitle('Prompts')
  const [tab, setTab] = useState<'library' | 'editor' | 'assignments'>('library')

  return (
    <div className="min-h-full overflow-y-auto bg-surface text-ink">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex gap-1 rounded-lg border border-primary-200 bg-primary-50/85 p-1 backdrop-blur-xl">
          {(['library', 'editor', 'assignments'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? 'bg-primary-100 text-ink shadow-sm dark:bg-neutral-800'
                  : 'text-primary-500 hover:text-ink'
              }`}
            >
              {t === 'assignments' ? 'Assignment' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <PromptsScreen tab={tab} onTabChange={setTab} />
      </div>
    </div>
  )
}
