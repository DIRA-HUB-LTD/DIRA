// Create or revoke a per-teacher MCP access token.
//   npm run mcp:token -- --teacher T001 --label "School SIS integration" [--days 90]
//   npm run mcp:token -- --revoke <token_id>
// The token is printed ONCE; only its SHA-256 hash is stored.
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const PREFIX = "dira_mcp_";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // optional
    }
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const revoke = arg("revoke");
    if (revoke) {
      const result = await client.query(
        "UPDATE mcp_api_tokens SET revoked_at = NOW() WHERE token_id::text = $1 AND revoked_at IS NULL",
        [revoke],
      );
      console.log(result.rowCount ? "Token revoked." : "No active token with that id.");
      return;
    }
    const teacherId = arg("teacher")?.trim();
    const label = arg("label")?.trim() || "MCP client";
    const days = Number(arg("days") ?? "0");
    if (!teacherId) {
      console.error('Usage: npm run mcp:token -- --teacher <teacher_id> --label "<label>" [--days 90]');
      process.exit(1);
    }
    const teacher = await client.query<{ school_id: string }>(
      "SELECT school_id FROM teachers WHERE teacher_id = $1",
      [teacherId],
    );
    if (!teacher.rows[0]) {
      console.error(`No teacher with id ${teacherId}.`);
      process.exit(1);
    }
    const token = `${PREFIX}${randomBytes(32).toString("base64url")}`;
    const hash = createHash("sha256").update(token).digest("hex");
    const inserted = await client.query<{ token_id: string }>(
      `INSERT INTO mcp_api_tokens (token_hash, label, school_id, teacher_id, expires_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $5::int > 0 THEN NOW() + make_interval(days => $5::int) END)
       RETURNING token_id::text AS token_id`,
      [hash, label, teacher.rows[0].school_id, teacherId, Number.isFinite(days) ? days : 0],
    );
    console.log(`Token id: ${inserted.rows[0].token_id}`);
    console.log(`Token (shown once, store it securely): ${token}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
