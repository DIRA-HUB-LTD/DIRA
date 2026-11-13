import "server-only";

import { getPool } from "@/lib/db/client";
import type { LogObservationContext } from "@/lib/db/schema";
import { getSignedInTeacher } from "@/lib/auth/teacher-session";

/**
 * The teacher a request acts as.
 *
 * 1. A teacher signed in with the pilot ID + PIN sign-in (lib/auth/teacher-session.ts).
 * 2. Otherwise, in development or DIRA_DEMO_MODE only, the first teacher in the
 *    database (the single-teacher demo; unchanged from before).
 *
 * Consequential actions (approving a pathway note) must NOT use this function,
 * because of the demo fallback. They call getSignedInTeacher() directly.
 */
export async function resolveTeacherContext(): Promise<LogObservationContext | null> {
  const signedIn = await getSignedInTeacher();
  if (signedIn) {
    return { teacher_id: signedIn.teacher_id, school_id: signedIn.school_id };
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.DIRA_DEMO_MODE !== "true"
  ) {
    return null;
  }

  const result = await getPool().query<LogObservationContext>(
    `SELECT teacher_id, school_id
      FROM teachers
      ORDER BY created_at ASC, teacher_id ASC, school_id ASC
      LIMIT 1`,
  );

  return result.rows[0] ?? null;
}
