import "server-only";

import { getPool } from "@/lib/db/client";

/**
 * Read-only numbers for the impact dashboard. Everything is scoped to one school; when
 * `teacherId` is given (a class teacher rather than an administrator) it is narrowed to
 * the learners that teacher currently teaches. Nothing here writes, and nothing reads the
 * agent activity log, which is not separated by school.
 */
export interface DashboardScope {
  schoolId: string;
  teacherId: string | null;
}

export interface Visibility {
  learners: number;
  seen_this_term: number;
  seen_twice_this_term: number;
  seen_last_term: number;
  multi_teacher: number;
  multi_year: number;
  seen_ever: number;
  observations_total: number;
  this_term_start: string;
}

export interface WeekPoint {
  week_start: string;
  observations: number;
  learners: number;
}

export interface FollowThrough {
  suggested: number;
  accepted: number;
  outcomes: number;
  assessed: number;
  not_enough_evidence: number;
  summaries_drafted: number;
  summaries_signed: number;
}

export interface CalendarItem {
  date: string;
  time: string;
  label: string;
  status: string;
  is_manual_demo: boolean;
}

export interface ImpactDashboard {
  visibility: Visibility;
  weeks: WeekPoint[];
  followThrough: FollowThrough;
  calendar: CalendarItem[];
  month_start: string;
  today: string;
}

// Learners in scope: currently enrolled in this school, and (for a teacher) in one of
// their current classes. Terms follow the Kenyan calendar: Jan-Apr, May-Aug, Sep-Dec.
const SCOPE_CTE = `
  scope AS (
    SELECT DISTINCT e.learner_id
      FROM learner_enrollments e
     WHERE e.school_id = $1
       AND e.enrolment_status <> 'Withdrawn'
       AND e.enrolled_from <= CURRENT_DATE
       AND (e.enrolled_to IS NULL OR e.enrolled_to >= CURRENT_DATE)
       AND ($2::text IS NULL OR EXISTS (
             SELECT 1 FROM timetable_assignments ta
              WHERE ta.class_id = e.class_id AND ta.school_id = e.school_id
                AND ta.academic_year = e.academic_year AND ta.teacher_id = $2
                AND ta.valid_from <= CURRENT_DATE
                AND (ta.valid_to IS NULL OR ta.valid_to >= CURRENT_DATE)))
  ),
  terms AS (
    SELECT make_date(t.y, t.m, 1) AS this_start,
           (make_date(t.y, t.m, 1) - interval '4 months')::date AS last_start
      FROM (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int AS y,
                   CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) <= 4 THEN 1
                        WHEN EXTRACT(MONTH FROM CURRENT_DATE) <= 8 THEN 5
                        ELSE 9 END AS m) AS t
  )`;

export async function loadImpactDashboard(scope: DashboardScope): Promise<ImpactDashboard> {
  const pool = getPool();
  const params = [scope.schoolId, scope.teacherId];

  const [visibility, weeks, tests, summaries, calendar, dates] = await Promise.all([
    pool.query<Visibility>(
      `WITH ${SCOPE_CTE},
       per AS (
         SELECT s.learner_id,
                COUNT(o.observation_id) FILTER (WHERE o.observed_at >= terms.this_start) AS this_n,
                COUNT(o.observation_id) FILTER (WHERE o.observed_at >= terms.last_start
                                                  AND o.observed_at < terms.this_start) AS last_n,
                COUNT(DISTINCT o.teacher_id) AS teachers,
                COUNT(DISTINCT o.academic_year) AS years,
                COUNT(o.observation_id) AS total
           FROM scope s
          CROSS JOIN terms
           LEFT JOIN observations o ON o.learner_id = s.learner_id AND o.school_id = $1
          GROUP BY s.learner_id
       )
       SELECT COUNT(*)::int AS learners,
              COUNT(*) FILTER (WHERE this_n >= 1)::int AS seen_this_term,
              COUNT(*) FILTER (WHERE this_n >= 2)::int AS seen_twice_this_term,
              COUNT(*) FILTER (WHERE last_n >= 1)::int AS seen_last_term,
              COUNT(*) FILTER (WHERE teachers >= 2)::int AS multi_teacher,
              COUNT(*) FILTER (WHERE years >= 2)::int AS multi_year,
              COUNT(*) FILTER (WHERE total >= 1)::int AS seen_ever,
              COALESCE(SUM(total), 0)::int AS observations_total,
              (SELECT this_start::text FROM terms) AS this_term_start
         FROM per`,
      params,
    ),
    pool.query<WeekPoint>(
      `WITH ${SCOPE_CTE},
       counted AS (
         SELECT date_trunc('week', o.observed_at)::date AS wk,
                COUNT(*) AS n, COUNT(DISTINCT o.learner_id) AS l
           FROM observations o
           JOIN scope s ON s.learner_id = o.learner_id
          WHERE o.school_id = $1
            AND o.observed_at >= date_trunc('week', CURRENT_DATE) - interval '11 weeks'
          GROUP BY 1
       )
       SELECT w::date::text AS week_start,
              COALESCE(counted.n, 0)::int AS observations,
              COALESCE(counted.l, 0)::int AS learners
         FROM generate_series(date_trunc('week', CURRENT_DATE) - interval '11 weeks',
                              date_trunc('week', CURRENT_DATE), interval '1 week') AS w
         LEFT JOIN counted ON counted.wk = w::date
        ORDER BY w`,
      params,
    ),
    pool.query<Omit<FollowThrough, "summaries_drafted" | "summaries_signed">>(
      `WITH ${SCOPE_CTE}
       SELECT COUNT(DISTINCT t.test_id)::int AS suggested,
              COUNT(DISTINCT t.test_id) FILTER (WHERE t.status IN ('ACCEPTED', 'COMPLETED'))::int AS accepted,
              COUNT(DISTINCT t.test_id) FILTER (WHERE t.status = 'COMPLETED')::int AS outcomes,
              COUNT(DISTINCT a.test_id)::int AS assessed,
              COUNT(DISTINCT a.test_id) FILTER (WHERE a.classification = 'INSUFFICIENT_EVIDENCE')::int AS not_enough_evidence
         FROM activity_tests t
         JOIN scope s ON s.learner_id = t.learner_id
         LEFT JOIN hypothesis_assessments a ON a.test_id = t.test_id
        WHERE ($2::text IS NULL OR t.conducting_teacher_id = $2)`,
      params,
    ),
    pool.query<{ summaries_drafted: number; summaries_signed: number }>(
      `WITH ${SCOPE_CTE}
       SELECT COUNT(*)::int AS summaries_drafted,
              COUNT(*) FILTER (WHERE ss.status = 'APPROVED')::int AS summaries_signed
         FROM signed_summaries ss
         JOIN scope s ON s.learner_id = ss.learner_id
        WHERE ss.school_id = $1`,
      params,
    ),
    pool.query<CalendarItem>(
      `SELECT j.scheduled_date::text AS date,
              to_char(j.scheduled_end_at AT TIME ZONE COALESCE(sc.timezone, 'Africa/Nairobi'), 'HH24:MI') AS time,
              COALESCE(NULLIF(TRIM(COALESCE(c.grade_level, '') || ' ' || COALESCE(c.stream_label, '')), ''), 'Class') AS label,
              j.status, j.is_manual_demo
         FROM teacher_follow_up_jobs j
         JOIN schools sc ON sc.school_id = j.school_id
         LEFT JOIN classes c ON c.class_id = j.class_id
        WHERE j.school_id = $1
          AND ($2::text IS NULL OR j.teacher_id = $2)
          AND j.scheduled_date >= date_trunc('month', CURRENT_DATE)::date
          AND j.scheduled_date < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
        ORDER BY j.scheduled_end_at
        LIMIT 500`,
      params,
    ),
    pool.query<{ month_start: string; today: string }>(
      "SELECT date_trunc('month', CURRENT_DATE)::date::text AS month_start, CURRENT_DATE::text AS today",
    ),
  ]);

  return {
    visibility: visibility.rows[0],
    weeks: weeks.rows,
    followThrough: { ...tests.rows[0], ...summaries.rows[0] },
    calendar: calendar.rows,
    month_start: dates.rows[0].month_start,
    today: dates.rows[0].today,
  };
}
