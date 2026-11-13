import { afterEach, describe, expect, it } from "vitest";
import { BASE_SCHEMA, MIGRATIONS } from "../db/manifest.mjs";
import { runMigrations } from "../scripts/migrate.mjs";
import { createTestDatabase } from "./helpers/pglite-db.mjs";

let database;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe("migration runner", () => {
  it("builds a fresh database from the base schema and every migration", async () => {
    database = await createTestDatabase();
    const applied = await database.pool.query(
      "SELECT name FROM schema_migrations ORDER BY applied_at, name",
    );
    expect(applied.rows.map((row) => row.name).sort()).toEqual(
      [BASE_SCHEMA, ...MIGRATIONS].sort(),
    );
    for (const table of [
      "education_markdown_cache",
      "focus_assignments",
      "pathway_notes",
      "mcp_api_tokens",
      "teacher_sign_in_attempts",
    ]) {
      const present = await database.pool.query(
        "SELECT to_regclass($1) IS NOT NULL AS present",
        [`public.${table}`],
      );
      expect(present.rows[0].present, table).toBe(true);
    }
  });

  it("is a no-op when run again", async () => {
    database = await createTestDatabase();
    const result = await runMigrations(database.runnerClient, { log: () => {} });
    expect(result.applied).toEqual([]);
  });

  it("re-applies every migration safely on a database created before tracking existed", async () => {
    database = await createTestDatabase();
    // Simulate a pre-runner database: schema present, no tracking rows.
    await database.pool.query("DELETE FROM schema_migrations");
    const logs = [];
    const result = await runMigrations(database.runnerClient, {
      log: (line) => logs.push(line),
    });
    expect(result.applied).toEqual([BASE_SCHEMA, ...MIGRATIONS]);
    expect(logs[0]).toBe(`recorded  ${BASE_SCHEMA}`);
  });
});
