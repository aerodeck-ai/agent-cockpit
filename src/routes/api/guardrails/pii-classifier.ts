/**
 * /api/guardrails/pii-classifier
 *
 * Surface for the PII output classifier feature gate.
 * The actual Hermes post-LLM hook integration is OUT OF SCOPE for this PR.
 *
 * TODO(pii-hook): Wire this toggle into Hermes post-processing hook:
 *   1. Add a PostLLMHook in hermes/hooks/pii_redactor.py
 *   2. Hook reads PII_OUTPUT_CLASSIFIER_ENABLED env var (or DB flag)
 *   3. If enabled, call ~/mcp-infra/scripts/pii-output-classifier.py with
 *      the LLM response text; apply returned redactions before forwarding
 *      to the client.
 *   4. Haiku model (claude-haiku-4-5) should be used for speed.
 *   5. Surface redaction events back via hermes_findings (source='pii.redactor').
 *
 * GET  → { enabled: boolean, integration_status: 'stub' }
 * POST → { enabled: boolean }  — toggle the flag
 *
 * Storage: ~/.hermes/guardrails.json  (created on first write)
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'
import { resolveTenantFromRequest } from '../../../lib/auth/tenants'
import { requireJsonContentType } from '../../../server/rate-limit'

const HERMES_ROOT =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  join(homedir(), '.hermes')

const GUARDRAILS_STATE_PATH = join(HERMES_ROOT, 'guardrails.json')

interface GuardrailsState {
  pii_output_classifier_enabled: boolean
}

function readState(): GuardrailsState {
  // Also honour the env var set via systemd / .env
  const envEnabled = process.env.PII_OUTPUT_CLASSIFIER_ENABLED === '1'
  if (!existsSync(GUARDRAILS_STATE_PATH)) {
    return { pii_output_classifier_enabled: envEnabled }
  }
  try {
    const raw = readFileSync(GUARDRAILS_STATE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<GuardrailsState>
    return {
      pii_output_classifier_enabled:
        parsed.pii_output_classifier_enabled ?? envEnabled,
    }
  } catch {
    return { pii_output_classifier_enabled: envEnabled }
  }
}

function writeState(state: GuardrailsState): void {
  writeFileSync(GUARDRAILS_STATE_PATH, JSON.stringify(state, null, 2), 'utf-8')
}

export const Route = createFileRoute('/api/guardrails/pii-classifier')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const tenantInfo = resolveTenantFromRequest(request)
        if (!tenantInfo) {
          return json({ error: 'Forbidden — no tenant resolved' }, { status: 403 })
        }

        const state = readState()
        return json({
          enabled: state.pii_output_classifier_enabled,
          integration_status: 'stub',
          note: 'Hook integration pending — see TODO in route docstring',
        })
      },

      POST: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const tenantInfo = resolveTenantFromRequest(request)
        if (!tenantInfo) {
          return json({ error: 'Forbidden — no tenant resolved' }, { status: 403 })
        }
        // Only henry_cos may toggle
        if (tenantInfo.tenant !== 'henry_cos') {
          return json({ error: 'Forbidden — read-only access for this tenant' }, { status: 403 })
        }

        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        let body: { enabled?: boolean }
        try {
          body = (await request.json()) as { enabled?: boolean }
        } catch {
          return json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        if (typeof body.enabled !== 'boolean') {
          return json({ error: 'enabled (boolean) is required' }, { status: 400 })
        }

        const current = readState()
        const next: GuardrailsState = {
          ...current,
          pii_output_classifier_enabled: body.enabled,
        }
        writeState(next)

        return json({
          ok: true,
          enabled: next.pii_output_classifier_enabled,
          integration_status: 'stub',
        })
      },
    },
  },
})
