import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { getPool } from "@/lib/db/client";
import type { LogObservationContext } from "@/lib/db/schema";

/**
 * Who an MCP request acts as.
 *
 * - A per-teacher token (mcp_api_tokens, created with `npm run mcp:token`) acts as
 *   that teacher in that school and can be revoked on its own. This is how a
 *   school's existing system plugs DIRA's tools in.
 * - The legacy shared DIRA_MCP_ACCESS_TOKEN keeps working for the demo and the
 *   scheduled agent, and acts as resolveTeacherContext() (unchanged behaviour).
 */
export type McpAccess =
  | { kind: "shared" }
  | { kind: "teacher"; context: LogObservationContext; token_id: string };

export const MCP_TOKEN_PREFIX = "dira_mcp_";

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sameSecret(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function resolveMcpAccess(
  bearer: string | undefined,
): Promise<McpAccess | null> {
  if (!bearer) return null;
  const shared = process.env.DIRA_MCP_ACCESS_TOKEN;
  if (shared && sameSecret(bearer, shared)) return { kind: "shared" };
  if (!bearer.startsWith(MCP_TOKEN_PREFIX) || bearer.length > 200) return null;

  const result = await getPool().query<{
    token_id: string;
    teacher_id: string;
    school_id: string;
  }>(
    `UPDATE mcp_api_tokens t
     SET last_used_at = NOW()
     FROM teachers te
     WHERE t.token_hash = $1
       AND t.revoked_at IS NULL
       AND (t.expires_at IS NULL OR t.expires_at > NOW())
       AND te.teacher_id = t.teacher_id AND te.school_id = t.school_id
     RETURNING t.token_id::text AS token_id, t.teacher_id, t.school_id`,
    [hashMcpToken(bearer)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    kind: "teacher",
    token_id: row.token_id,
    context: { teacher_id: row.teacher_id, school_id: row.school_id },
  };
}
