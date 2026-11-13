import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, seedTwoYearSchool } from "./helpers/pglite-db.mjs";

const holder = vi.hoisted(() => ({ pool: null }));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));

const { hashMcpToken, resolveMcpAccess } = await import("../lib/auth/mcp-access.ts");

const TOKEN = "dira_mcp_test-token-for-teacher-t-cur-000000000000";

describe("MCP access tokens", () => {
  let database;

  beforeAll(async () => {
    database = await createTestDatabase();
    holder.pool = database.pool;
    await seedTwoYearSchool(database.pool);
    await database.pool.query(
      `INSERT INTO mcp_api_tokens (token_hash, label, school_id, teacher_id)
       VALUES ($1, 'SIS', 'SCH1', 'T_CUR'), ($2, 'old', 'SCH1', 'T_CUR'), ($3, 'expired', 'SCH1', 'T_CUR')`,
      [hashMcpToken(TOKEN), hashMcpToken(`${TOKEN}-revoked`), hashMcpToken(`${TOKEN}-expired`)],
    );
    await database.pool.query(
      "UPDATE mcp_api_tokens SET revoked_at = NOW() WHERE label = 'old'",
    );
    await database.pool.query(
      "UPDATE mcp_api_tokens SET expires_at = NOW() - INTERVAL '1 day' WHERE label = 'expired'",
    );
    vi.stubEnv("DIRA_MCP_ACCESS_TOKEN", "shared-demo-token-value");
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await database?.close();
  });

  it("maps a per-teacher token to exactly that teacher and school", async () => {
    const access = await resolveMcpAccess(TOKEN);
    expect(access).toMatchObject({
      kind: "teacher",
      context: { teacher_id: "T_CUR", school_id: "SCH1" },
    });
    const used = await database.pool.query(
      "SELECT last_used_at FROM mcp_api_tokens WHERE label = 'SIS'",
    );
    expect(used.rows[0].last_used_at).not.toBeNull();
  });

  it("keeps the legacy shared token working", async () => {
    expect(await resolveMcpAccess("shared-demo-token-value")).toEqual({ kind: "shared" });
  });

  it("rejects revoked, expired, unknown and missing tokens", async () => {
    expect(await resolveMcpAccess(`${TOKEN}-revoked`)).toBeNull();
    expect(await resolveMcpAccess(`${TOKEN}-expired`)).toBeNull();
    expect(await resolveMcpAccess("dira_mcp_unknown")).toBeNull();
    expect(await resolveMcpAccess("not-a-dira-token")).toBeNull();
    expect(await resolveMcpAccess(undefined)).toBeNull();
  });

  it("stores only a hash of the token", async () => {
    const rows = await database.pool.query("SELECT token_hash FROM mcp_api_tokens");
    expect(rows.rows.every((row) => /^[0-9a-f]{64}$/.test(row.token_hash))).toBe(true);
    expect(rows.rows.some((row) => row.token_hash.includes("dira_mcp"))).toBe(false);
  });
});
