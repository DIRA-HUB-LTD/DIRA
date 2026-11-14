// Vercel runs `vercel-build` instead of `build` when it exists.
// 1. Bring the database up to date (additive, idempotent migrations tracked in
//    schema_migrations). If a migration fails, the build fails and Vercel keeps
//    serving the previous deployment, so new code never runs against an old schema.
// 2. Build the app.
// Skip step 1 with DIRA_SKIP_BUILD_MIGRATIONS=true (e.g. a preview with no database).
import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const skip = process.env.DIRA_SKIP_BUILD_MIGRATIONS === "true";
if (skip) {
  console.log("[vercel-build] DIRA_SKIP_BUILD_MIGRATIONS=true: not migrating.");
} else if (!process.env.DATABASE_URL) {
  console.log("[vercel-build] DATABASE_URL is not set for this build: not migrating.");
} else {
  console.log(`[vercel-build] Migrating the database (${process.env.VERCEL_ENV ?? "unknown"} build)…`);
  run("node", ["scripts/migrate.mjs"]);
}

run("npx", ["next", "build"]);
