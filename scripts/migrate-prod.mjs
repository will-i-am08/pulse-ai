#!/usr/bin/env node
/**
 * Run db/migrations on Vercel *production* builds only.
 *
 * GitHub Actions `DB migrate (prod)` needs a repo `DATABASE_URL` secret that
 * this agent cannot write (Actions secrets API 403). Vercel already injects
 * DATABASE_URL on production deploys — apply migrations there so schema ships
 * with the code that needs it.
 *
 * Migrations are idempotent (IF NOT EXISTS). Preview/dev builds skip.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const vercelEnv = process.env.VERCEL_ENV || "";
if (vercelEnv && vercelEnv !== "production") {
  console.log(`[migrate-prod] skip (VERCEL_ENV=${vercelEnv})`);
  process.exit(0);
}

// Local `next build` without Vercel: skip unless explicitly forced.
if (!process.env.VERCEL && process.env.FORCE_MIGRATE_ON_BUILD !== "1") {
  console.log("[migrate-prod] skip (not on Vercel; set FORCE_MIGRATE_ON_BUILD=1 to run)");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("[migrate-prod] DATABASE_URL is not set on production build");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync("pnpm", ["exec", "tsx", "scripts/migrate.ts"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
  shell: true,
});

process.exit(result.status ?? 1);
