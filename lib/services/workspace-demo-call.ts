import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import { getPool } from "@/lib/db/client";
export { normalisePhone, type PhoneCheck } from "@/lib/utils/phone";

/**
 * "Call me now" in the demo workspace, to a number the visitor types in.
 * The number is checked here, and only a keyed hash of it is stored (for the per-number
 * limit): the number itself never touches the database or the logs.
 */

export const WORKSPACE_CALLS_PER_NUMBER_PER_DAY = 3;

export class WorkspaceCallLimitError extends Error {
  constructor() {
    super("This number has had its demo calls for today");
    this.name = "WorkspaceCallLimitError";
  }
}

function hashNumber(e164: string): string {
  const secret =
    process.env.DEMO_CALL_RATE_LIMIT_SECRET?.trim() || process.env.DIRA_SESSION_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("A rate-limit secret of at least 32 bytes is required");
  }
  return createHmac("sha256", secret).update(`workspace:${e164}`).digest("hex");
}

/** Reserve one call for this number, or refuse if it already had its calls today. */
export async function reserveWorkspaceCall(e164: string): Promise<string> {
  const phoneHash = hashNumber(e164);
  const eventId = randomUUID();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(824139210483::bigint)");
    const count = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM agent_activity_logs
        WHERE event_type = 'workspace_demo_call_requested'
          AND metadata->>'phone_hash' = $1
          AND timestamp >= NOW() - INTERVAL '24 hours'`,
      [phoneHash],
    );
    if (count.rows[0].n >= WORKSPACE_CALLS_PER_NUMBER_PER_DAY) {
      throw new WorkspaceCallLimitError();
    }
    await client.query(
      `INSERT INTO agent_activity_logs (id, run_id, event_type, agent_action, tool_name, status, metadata)
       VALUES ($1, $1, 'workspace_demo_call_requested', 'workspace_demo_call_requested',
               'workspace_demo_voice', 'started', $2::jsonb)`,
      [eventId, JSON.stringify({ phone_hash: phoneHash })],
    );
    await client.query("COMMIT");
    return eventId;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Mark the reservation as placed or failed (a failed attempt still counts towards the limit). */
export async function finishWorkspaceCall(eventId: string, placed: boolean): Promise<void> {
  await getPool().query(
    `UPDATE agent_activity_logs SET status = $2
      WHERE id = $1 AND event_type = 'workspace_demo_call_requested' AND status = 'started'`,
    [eventId, placed ? "success" : "error"],
  );
}

/** What happened to this teacher's most recent call, from the provider's callbacks. */
export async function latestCallStatus(
  teacherId: string,
): Promise<{ status: string; at: string; duration_seconds: number | null } | null> {
  const result = await getPool().query<{ status: string; at: string; duration_seconds: number | null }>(
    `SELECT status, COALESCE(ended_at, first_event_at)::text AS at, duration_seconds
       FROM teacher_calls WHERE teacher_id = $1
      ORDER BY first_event_at DESC LIMIT 1`,
    [teacherId],
  );
  return result.rows[0] ?? null;
}
