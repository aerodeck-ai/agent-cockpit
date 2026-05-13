/**
 * /api/prompts/assign
 *
 * POST — assign a prompt version to a profile, write SOUL.md, restart gateway
 *
 * Body: { profile: string, prompt_id: number, version: number }
 *
 * Post-write steps (after the DB assignment row is persisted):
 *  1. Read the prompt body for the assigned version
 *  2. Backup ~/.hermes/profiles/<profile>/SOUL.md → .bak-pre-promptassign-<ts>
 *  3. Write the new prompt body to SOUL.md (or profile root if no profiles/ dir)
 *  4. Restart hermes-gateway-<profile>.service (or hermes-gateway.service for default)
 *     via systemctl --user restart; failure is non-fatal (warning in response)
 *
 * Tenant gating:
 *  - henry_cos → can assign to any profile
 *  - mally     → can only assign to mally or mally-second
 */

import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import {
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { isAuthenticatedWithCFAccess } from "../../../server/auth-middleware";
import { resolveTenantFromRequest } from "../../../lib/auth/tenants";

const DB_PATH =
  process.env.PROMPTS_DB_PATH ??
  "/home/ubuntu/data/sqlite/shared/prompts.db";

const HERMES_HOME =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  join(homedir(), ".hermes");

/** Resolve the SOUL.md path for a given profile name. */
function soulMdPath(profile: string): string {
  if (!profile || profile === "default") {
    return join(HERMES_HOME, "SOUL.md");
  }
  return join(HERMES_HOME, "profiles", profile, "SOUL.md");
}

/** Systemd service name for a given profile. */
function serviceNameForProfile(profile: string): string {
  if (!profile || profile === "default") {
    return "hermes-gateway.service";
  }
  return `hermes-gateway-${profile}.service`;
}

/**
 * Write SOUL.md for the profile (backup first).
 * Returns { ok: true } or { ok: false, error: string }.
 */
function writeSoulMd(
  profile: string,
  body: string,
): { ok: true } | { ok: false; error: string } {
  try {
    const target = soulMdPath(profile);
    const dir = join(target, "..");
    mkdirSync(dir, { recursive: true });

    // Backup existing SOUL.md
    if (existsSync(target)) {
      const ts = new Date()
        .toISOString()
        .replace(/[:.]/g, "")
        .replace("T", "-")
        .slice(0, 17);
      const backup = `${target}.bak-pre-promptassign-${ts}`;
      renameSync(target, backup);
    }

    writeFileSync(target, body, "utf-8");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Restart the Hermes gateway service for the given profile.
 * Returns { ok: true } or { ok: false, error: string }.
 */
function restartGateway(
  profile: string,
): { ok: true } | { ok: false; error: string } {
  const service = serviceNameForProfile(profile);
  try {
    execFileSync("systemctl", ["--user", "restart", service], {
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const MALLY_ALLOWED_PROFILES = new Set(["mally", "mally-second"]);

export const Route = createFileRoute("/api/prompts/assign")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return json({ error: "Unauthorized" }, { status: 401 });
        }
        const tenantInfo = resolveTenantFromRequest(request);
        if (!tenantInfo) {
          return json({ error: "Forbidden" }, { status: 403 });
        }

        if (!existsSync(DB_PATH)) {
          return json({ error: "Database not found" }, { status: 503 });
        }

        try {
          const body = (await request.json()) as {
            profile: string;
            prompt_id: number;
            version: number;
          };
          if (!body.profile?.trim() || !body.prompt_id || !body.version) {
            return json(
              { error: "profile, prompt_id, and version are required" },
              { status: 400 },
            );
          }

          const profile = body.profile.trim();

          // Tenant-gating: Mally can only assign to her own profiles
          if (
            tenantInfo.tenant === "mally" &&
            !MALLY_ALLOWED_PROFILES.has(profile)
          ) {
            return json(
              {
                error:
                  "Mally can only assign prompts to mally or mally-second profiles",
              },
              { status: 403 },
            );
          }

          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const Database =
            require("better-sqlite3") as typeof import("better-sqlite3");
          const db = new Database(DB_PATH);

          // Verify prompt + version exist and get the body
          const versionRow = db
            .prepare(
              "SELECT pv.version, pv.body FROM prompt_versions pv WHERE pv.prompt_id = ? AND pv.version = ?",
            )
            .get(body.prompt_id, body.version) as
            | { version: number; body: string }
            | undefined;
          if (!versionRow) {
            db.close();
            return json(
              { error: "Prompt or version not found" },
              { status: 404 },
            );
          }

          // Write assignment row
          db.prepare(`
            INSERT OR REPLACE INTO prompt_assignments (profile, prompt_id, version, assigned_at, assigned_by)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
          `).run(profile, body.prompt_id, body.version, tenantInfo.displayName);

          db.close();

          // Write SOUL.md (non-fatal: report warning if it fails)
          const soulResult = writeSoulMd(profile, versionRow.body);

          // Restart gateway (non-fatal: report warning if it fails)
          const restartResult = soulResult.ok
            ? restartGateway(profile)
            : { ok: false as const, error: "SOUL.md write failed; skipped restart" };

          // Build response
          const warnings: string[] = [];
          if (!soulResult.ok) {
            warnings.push(
              `SOUL.md write failed: ${soulResult.error}; prompt will apply on next manual restart`,
            );
          }
          if (!restartResult.ok) {
            warnings.push(
              `gateway restart failed: ${restartResult.error}; prompt will apply on next manual restart`,
            );
          }

          return json({
            ok: true,
            profile,
            soul_md_written: soulResult.ok,
            gateway_restarted: restartResult.ok,
            ...(warnings.length > 0 ? { warning: warnings.join("; ") } : {}),
          });
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
