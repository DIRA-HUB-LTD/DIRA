import "server-only";

import { getPool } from "@/lib/db/client";

/**
 * Fortnightly focus list ("no learner slips through the cracks").
 *
 * Every 14 days each teacher gets up to FOCUS_LIST_SIZE learners chosen from the
 * classes they currently teach. The list is stored (focus_assignments), so it stays
 * the same for the whole fortnight: observing a learner ticks them off rather than
 * reshuffling the list.
 *
 * Priority:
 *   1. no observation at this school in the learner's current academic year
 *   2. never observed by this teacher
 *   3. least recently observed by anyone at this school
 *   4. learner_id (stable tie-break)
 */

export const FOCUS_LIST_SIZE = 10;
export const FOCUS_PERIOD_DAYS = 14;
// A Monday. Periods are [anchor + 14k, anchor + 14k + 13].
const PERIOD_ANCHOR_UTC = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;

export type FocusReason =
  | "no_observation_this_year"
  | "not_observed_by_this_teacher"
  | "least_recently_observed";

export interface FocusLearner {
  learner_id: string;
  display_name: string;
  grade_level: string;
  stream_label: string;
  priority_rank: number;
  reason: FocusReason;
  last_observed_at: Date | null;
  observed_this_period: boolean;
}

export interface FocusList {
  period_start: string;
  period_end: string;
  learners: FocusLearner[];
}

export interface FocusContext {
  teacher_id: string;
  school_id: string;
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** The fortnight containing `today` (YYYY-MM-DD). Pure, so it is unit-tested directly. */
export function focusPeriodFor(today: string): { period_start: string; period_end: string } {
  if (!isDateOnly(today)) throw new Error("today must be a YYYY-MM-DD date");
  const day = Date.parse(`${today}T00:00:00Z`);
  const index = Math.floor((day - PERIOD_ANCHOR_UTC) / (FOCUS_PERIOD_DAYS * DAY_MS));
  const start = PERIOD_ANCHOR_UTC + index * FOCUS_PERIOD_DAYS * DAY_MS;
  const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    period_start: toDate(start),
    period_end: toDate(start + (FOCUS_PERIOD_DAYS - 1) * DAY_MS),
  };
}

/** Today's date in the school's timezone (falls back to UTC). */
export function localDate(now: Date, timeZone: string | null | undefined): string {
  try {
    if (timeZone) {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
    }
  } catch {
    // Invalid timezone: fall back to UTC.
  }
  return now.toISOString().slice(0, 10);
}

const GENERATE_SQL = `
WITH taught AS (
  SELECT DISTINCT e.learner_id, e.academic_year
  FROM learner_enrollments e
  JOIN timetable_assignments ta
    ON ta.class_id = e.class_id
   AND ta.school_id = e.school_id
   AND ta.academic_year = e.academic_year
  WHERE e.school_id = $2
    AND ta.teacher_id = $1
    AND e.enrolment_status <> 'Withdrawn'
    AND e.enrolled_from <= $3::date
    AND (e.enrolled_to IS NULL OR e.enrolled_to >= $3::date)
    AND ta.valid_from <= $3::date
    AND (ta.valid_to IS NULL OR ta.valid_to >= $3::date)
),
scored AS (
  SELECT
    t.learner_id,
    EXISTS (
      SELECT 1 FROM observations o
      WHERE o.learner_id = t.learner_id AND o.school_id = $2
        AND o.academic_year = t.academic_year
    ) AS observed_this_year,
    EXISTS (
      SELECT 1 FROM observations o
      WHERE o.learner_id = t.learner_id AND o.school_id = $2 AND o.teacher_id = $1
    ) AS observed_by_teacher,
    (
      SELECT MAX(o.observed_at) FROM observations o
      WHERE o.learner_id = t.learner_id AND o.school_id = $2
    ) AS last_observed_at
  FROM taught t
),
ranked AS (
  SELECT
    learner_id,
    ROW_NUMBER() OVER (
      ORDER BY observed_this_year ASC, observed_by_teacher ASC,
               last_observed_at ASC NULLS FIRST, learner_id ASC
    ) AS priority_rank,
    CASE
      WHEN NOT observed_this_year THEN 'no_observation_this_year'
      WHEN NOT observed_by_teacher THEN 'not_observed_by_this_teacher'
      ELSE 'least_recently_observed'
    END AS reason
  FROM scored
)
INSERT INTO focus_assignments
  (teacher_id, school_id, period_start, period_end, learner_id, priority_rank, reason)
SELECT $1, $2, $4::date, $5::date, learner_id, priority_rank, reason
FROM ranked
WHERE priority_rank <= $6
ON CONFLICT DO NOTHING`;

const READ_SQL = `
SELECT fa.learner_id, l.display_name, c.grade_level, c.stream_label,
       fa.priority_rank, fa.reason,
       (SELECT MAX(o.observed_at) FROM observations o
         WHERE o.learner_id = fa.learner_id AND o.school_id = fa.school_id) AS last_observed_at,
       EXISTS (
         SELECT 1 FROM observations o
         WHERE o.learner_id = fa.learner_id AND o.school_id = fa.school_id
           AND o.teacher_id = fa.teacher_id
           AND o.observation_date BETWEEN fa.period_start AND fa.period_end
       ) AS observed_this_period
FROM focus_assignments fa
JOIN learners l ON l.learner_id = fa.learner_id
LEFT JOIN LATERAL (
  SELECT c.grade_level, c.stream_label
  FROM learner_enrollments e
  JOIN classes c
    ON c.class_id = e.class_id AND c.school_id = e.school_id AND c.academic_year = e.academic_year
  WHERE e.learner_id = fa.learner_id AND e.school_id = fa.school_id
  ORDER BY e.academic_year DESC
  LIMIT 1
) c ON TRUE
WHERE fa.teacher_id = $1 AND fa.school_id = $2 AND fa.period_start = $3::date
ORDER BY fa.priority_rank`;

/**
 * Return this teacher's focus list for the fortnight containing `today`,
 * creating it the first time it is requested in that fortnight.
 */
export async function getFocusList(
  context: FocusContext,
  today: string,
): Promise<FocusList> {
  const { period_start, period_end } = focusPeriodFor(today);
  const pool = getPool();
  const existing = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM focus_assignments
     WHERE teacher_id = $1 AND school_id = $2 AND period_start = $3::date`,
    [context.teacher_id, context.school_id, period_start],
  );
  if ((existing.rows[0]?.count ?? 0) === 0) {
    await pool.query(GENERATE_SQL, [
      context.teacher_id,
      context.school_id,
      today,
      period_start,
      period_end,
      FOCUS_LIST_SIZE,
    ]);
  }
  const rows = await pool.query<FocusLearner>(READ_SQL, [
    context.teacher_id,
    context.school_id,
    period_start,
  ]);
  return { period_start, period_end, learners: rows.rows };
}
