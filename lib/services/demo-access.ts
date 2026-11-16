import "server-only";

import { getPool } from "@/lib/db/client";
import { issueSessionToken, type SignedInTeacher } from "@/lib/auth/teacher-session";

export const DEFAULT_DEMO_SCHOOL_ID = "SCH001";

/**
 * Open the synthetic-data workspace as its first teacher, with no account.
 *
 * Only the workspace flagged is_demo (or the seeded demo school) can be entered this way.
 * The session is an ordinary teacher session, so the app behaves exactly as it does for a
 * real teacher, and real schools are never reachable from here.
 */
export async function startDemoSession(): Promise<{ teacher: SignedInTeacher; token: string } | null> {
  const demoSchoolId = process.env.DIRA_DEMO_SCHOOL_ID?.trim() || DEFAULT_DEMO_SCHOOL_ID;
  const result = await getPool().query<SignedInTeacher>(
    `SELECT t.teacher_id, t.school_id, t.display_name, t.role, s.kind AS workspace_kind
     FROM teachers t JOIN schools s ON s.school_id = t.school_id
     WHERE s.is_demo = TRUE OR s.school_id = $1
     ORDER BY s.is_demo DESC, t.created_at ASC, t.teacher_id ASC
     LIMIT 1`,
    [demoSchoolId],
  );
  const teacher = result.rows[0];
  if (!teacher) return null;
  // A freshly seeded database has the school but not the flag yet.
  await getPool().query(
    `UPDATE schools SET is_demo = TRUE, setup_completed_at = COALESCE(setup_completed_at, NOW())
     WHERE school_id = $1`,
    [teacher.school_id],
  );
  return { teacher, token: issueSessionToken(teacher) };
}

export interface TeacherExtras {
  is_demo: boolean;
  tour_pending: boolean;
}

export async function teacherExtras(teacher: Pick<SignedInTeacher, "teacher_id" | "school_id">): Promise<TeacherExtras> {
  const result = await getPool().query<{ is_demo: boolean; tour_completed_at: Date | null }>(
    `SELECT s.is_demo, t.tour_completed_at
     FROM teachers t JOIN schools s ON s.school_id = t.school_id
     WHERE t.teacher_id = $1 AND t.school_id = $2`,
    [teacher.teacher_id, teacher.school_id],
  );
  const row = result.rows[0];
  return { is_demo: row?.is_demo ?? false, tour_pending: row ? row.tour_completed_at === null : false };
}

export async function completeTour(teacher: Pick<SignedInTeacher, "teacher_id" | "school_id">): Promise<void> {
  await getPool().query(
    `UPDATE teachers SET tour_completed_at = COALESCE(tour_completed_at, NOW())
     WHERE teacher_id = $1 AND school_id = $2`,
    [teacher.teacher_id, teacher.school_id],
  );
}
