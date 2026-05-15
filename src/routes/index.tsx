/**
 * / — Home page (Part B0 of cockpit v1)
 *
 * Calm landing: Hermes chat + ambient flow strip + right-rail cards.
 * Replaced the old redirect-to-/chat behaviour.
 */

import { createFileRoute } from '@tanstack/react-router'
import { HomePage } from '@/screens/home/HomePage'

export const Route = createFileRoute('/')({
  ssr: false,
  component: HomePage,
})
