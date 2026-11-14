// Apply DIRA's schema and migrations to the database in DATABASE_URL.
//
//   npm run db:migrate               apply anything not yet recorded
//   npm run db:migrate -- --status   list applied / pending files, change nothing
//
// Each migration runs in its own transaction and is recorded in schema_migrations
// with a SHA-256 checksum. Databases created before this runner existed have no
// tracking table; that is safe because every migration in db/manifest.mjs is
// idempotent, so re-running them only records them.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { BASE_SCHEMA, MIGRATIONS } from "../db/manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CRLF = new RegExp(String.fromCharCode(13, 10), "g");
const LF = String.fromCharCode(10);

export function readSql(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

export function checksum(sql) {
  // Normalise line endings so Windows (CRLF) and Linux (LF) checkouts agree.
  return createHash("sha256").update(sql.replace(CRLF, LF)).digest("hex");
}

function loadLocalEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(path.join(ROOT, file));
    } catch {
      // Missing file: rely on the process environment.
    }
  }
}

/**
 * Apply pending migrations using any client with a pg-compatible `query(text, params)`.
 * Exported so tests can run the real runner against an in-memory database.
 */
export async function runMigrations(client, { log = console.log, statusOnly = false } = {}) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const applied = new Map(
    (await client.query("SELECT name, checksum FROM schema_migrations")).rows.map(
      (row) => [row.name, row.checksum],
    ),
  );
  const schoolsTable = await client.query(
    "SELECT to_regclass('public.schools') IS NOT NULL AS present",
  );
  const hasBaseSchema = schoolsTable.rows[0]?.present === true;

  const plan = [];
  if (!applied.has(BASE_SCHEMA)) {
    plan.push({ name: BASE_SCHEMA, recordOnly: hasBaseSchema });
  }
  for (const name of MIGRATIONS) {
    if (!applied.has(name)) plan.push({ name, recordOnly: false });
  }

  for (const [name, sum] of applied.entries()) {
    if (name !== BASE_SCHEMA && !MIGRATIONS.includes(name)) continue;
    if (checksum(readSql(name)) !== sum) {
      log(`warning: ${name} changed after it was applied; write a new migration instead`);
    }
  }

  if (statusOnly) {
    for (const name of [BASE_SCHEMA, ...MIGRATIONS]) {
      log(`${applied.has(name) ? "applied" : "pending"}  ${name}`);
    }
    return { applied: [], pending: plan.map((item) => item.name) };
  }

  const done = [];
  for (const item of plan) {
    const sql = readSql(item.name);
    await client.query("BEGIN");
    try {
      if (!item.recordOnly) await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
        [item.name, checksum(sql)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${item.name} failed: ${error.message}`);
    }
    done.push(item.name);
    log(`${item.recordOnly ? "recorded" : "applied "}  ${item.name}`);
  }
  if (done.length === 0) log("Database is up to date.");
  return { applied: done, pending: [] };
}

async function main() {
  loadLocalEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await runMigrations(client, { statusOnly: process.argv.includes("--status") });
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
