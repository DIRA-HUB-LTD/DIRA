#!/usr/bin/env node
// One command from a fresh clone to a running DIRA with synthetic data:
//
//   npm run demo
//
// 1. checks Node, 2. creates .env.local from .env.example (with fresh local secrets),
// 3. installs dependencies, 4. starts local PostgreSQL in Docker, 5. applies every
// migration, 6. seeds the synthetic two-year school, 7. gives the first teacher a demo
// PIN, 8. starts the app on http://localhost:3000.
//
// Uses only Node built-ins until dependencies are installed. Synthetic data only:
// the seed script refuses any database other than the local Docker one.
// Flags: --no-docker (use the DATABASE_URL you already run), --no-start (set up only).

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
export const DEMO_PIN = "2468";

function step(message) {
  console.log(`\n▶ ${message}`);
}

function run(command, commandArgs, { allowFailure = false } = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0 && !allowFailure) {
    console.error(`\n✖ "${command} ${commandArgs.join(" ")}" failed (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
  return result.status === 0;
}

function setEnvValue(text, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  return pattern.test(text) ? text.replace(pattern, (current) => (current === `${name}=` ? line : current)) : `${text.trimEnd()}\n${line}\n`;
}

step("Checking Node.js");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 9)) {
  console.error(`✖ Node ${process.versions.node} is too old. DIRA needs Node 20.9+ (24 recommended, see .nvmrc).`);
  process.exit(1);
}
console.log(`  Node ${process.versions.node}`);

step("Preparing .env.local");
const envPath = path.join(ROOT, ".env.local");
if (!existsSync(envPath)) {
  copyFileSync(path.join(ROOT, ".env.example"), envPath);
  console.log("  Created .env.local from .env.example");
}
let env = readFileSync(envPath, "utf8");
// Fill blank local-only secrets so sign-in and the MCP endpoint work out of the box.
env = setEnvValue(env, "DIRA_SESSION_SECRET", randomBytes(32).toString("hex"));
env = setEnvValue(env, "DIRA_MCP_ACCESS_TOKEN", randomBytes(32).toString("hex"));
env = setEnvValue(env, "DIRA_DEMO_MODE", "true");
writeFileSync(envPath, env);
console.log("  Local secrets are set (only in .env.local, which git ignores)");

if (!existsSync(path.join(ROOT, "node_modules"))) {
  step("Installing dependencies (npm ci)");
  run(npm, ["ci", "--no-audit", "--no-fund"]);
}

if (!args.has("--no-docker")) {
  step("Starting local PostgreSQL (docker compose)");
  if (!run("docker", ["compose", "up", "-d", "--wait", "postgres"], { allowFailure: true })) {
    console.error(
      "✖ Could not start PostgreSQL with Docker. Start Docker Desktop and retry,\n" +
        "  or run your own database, set DATABASE_URL in .env.local and use: npm run demo -- --no-docker",
    );
    process.exit(1);
  }
}

step("Applying database migrations");
run(process.execPath, ["scripts/migrate.mjs"]);

step("Seeding the synthetic two-year school");
run(process.execPath, [
  "scripts/seed-development.cjs",
  "--confirm-development",
  "--input-dir=data/cleaned/generated_day2",
]);

step("Setting a demo PIN for the first teacher");
process.loadEnvFile(envPath);
const pg = (await import("pg")).default;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const first = await client.query(
  "SELECT teacher_id, display_name FROM teachers ORDER BY created_at ASC, teacher_id ASC LIMIT 1",
);
await client.end();
const teacher = first.rows[0];
if (teacher) {
  run(npx, ["tsx", "scripts/set-teacher-pin.ts", "--teacher", teacher.teacher_id, "--pin", DEMO_PIN]);
}

console.log("\n✔ DIRA is set up with synthetic data.");
if (teacher) {
  console.log(`  Sign in at http://localhost:3000/sign-in as ${teacher.teacher_id} (${teacher.display_name}) with PIN ${DEMO_PIN}.`);
}
console.log("  Model features need ZAI_API_KEY (or DIRA_MODEL_BASE_URL for a self-hosted model) in .env.local.");
console.log("  Calls, transcription and live guidance retrieval are optional; see README.");

if (!args.has("--no-start")) {
  step("Starting DIRA on http://localhost:3000 (Ctrl+C to stop)");
  run(npx, ["next", "dev"]);
}
