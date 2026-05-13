import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { ModelsScreen } from '@/screens/models/models-screen'
import { useTenantRole } from '@/hooks/use-tenant-role'

export const Route = createFileRoute('/models')({
  ssr: false,
  component: ModelsRoute,
})

function ModelsRoute() {
  usePageTitle('Model Control')
  const { isHenry } = useTenantRole()

  return (
    <div className="min-h-full overflow-y-auto bg-surface text-ink">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
        <ModelsScreen canEdit={isHenry} />
      </div>
    </div>
  )
}
