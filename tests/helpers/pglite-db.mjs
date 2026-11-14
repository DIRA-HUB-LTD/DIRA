// In-memory PostgreSQL for tests (PGlite = real Postgres compiled to WebAssembly).
// It runs the real migration runner, so tests exercise the same schema as production,
// and it needs no Docker. `pool` mimics the small part of pg.Pool that DIRA uses.

import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../../scripts/migrate.mjs";

function toPgResult(result) {
  const rows = result.rows ?? [];
  return { rows, rowCount: result.affectedRows || rows.length };
}

export function createPoolAdapter(db) {
  const client = {
    query: async (text, params) => toPgResult(await db.query(text, params ?? [])),
    release: () => {},
  };
  return {
    query: client.query,
    connect: async () => client,
    end: async () => {},
  };
}

export async function createTestDatabase() {
  const db = new PGlite();
  const pool = createPoolAdapter(db);
  // Multi-statement SQL must go through exec(); wrap it so the runner can call query().
  const runnerClient = {
    query: async (text, params) => {
      if (params && params.length > 0) return toPgResult(await db.query(text, params));
      const results = await db.exec(text);
      return toPgResult(results.at(-1) ?? { rows: [] });
    },
  };
  await runMigrations(runnerClient, { log: () => {} });
  return { db, pool, runnerClient, close: () => db.close() };
}

/** YYYY-MM-DD for today shifted by `days`, matching Postgres CURRENT_DATE in UTC. */
export function isoDate(days = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Seed a small school whose history spans two academic years:
 *   - learner L1 was in Grade 3 last year (teacher T_PREV, assignment now ended)
 *     and is in Grade 4 this year (teacher T_CUR, current assignment).
 *   - teacher T_OTHER teaches a different class in the same school.
 *   - a second school SCH2 with teacher T_SCH2.
 */
export async function seedTwoYearSchool(pool) {
  const thisYear = new Date().getUTCFullYear();
  const lastYear = thisYear - 1;
  const q = (text, params) => pool.query(text, params);
  await q(`INSERT INTO schools (school_id, school_name, timezone) VALUES
    ('SCH1', 'Test School', 'Africa/Nairobi'), ('SCH2', 'Other School', 'Africa/Nairobi')`);
  await q(`INSERT INTO teachers (teacher_id, school_id, display_name) VALUES
    ('T_PREV', 'SCH1', 'Previous Teacher'), ('T_CUR', 'SCH1', 'Current Teacher'),
    ('T_ALSO', 'SCH1', 'Second Current Teacher'),
    ('T_OTHER', 'SCH1', 'Other Class Teacher'), ('T_SCH2', 'SCH2', 'Other School Teacher')`);
  await q(
    `INSERT INTO classes (class_id, school_id, grade_level, stream_label, academic_year) VALUES
      ('C_PREV', 'SCH1', 'Grade 3', 'A', $1), ('C_CUR', 'SCH1', 'Grade 4', 'A', $2),
      ('C_OTHER', 'SCH1', 'Grade 4', 'B', $2), ('C_SCH2', 'SCH2', 'Grade 5', 'A', $2)`,
    [lastYear, thisYear],
  );
  await q(`INSERT INTO learners (learner_id, display_name) VALUES
    ('L1', 'Amani Test'), ('L2', 'Baraka Test'), ('L3', 'Chebet Test'), ('L_SCH2', 'Other Learner')`);
  await q(
    `INSERT INTO learner_enrollments
       (learner_id, class_id, school_id, academic_year, enrolment_status, enrolled_from, enrolled_to)
     VALUES
       ('L1', 'C_PREV', 'SCH1', $1, 'Active', $3, $4),
       ('L1', 'C_CUR', 'SCH1', $2, 'Active', $5, NULL),
       ('L2', 'C_CUR', 'SCH1', $2, 'Active', $5, NULL),
       ('L3', 'C_OTHER', 'SCH1', $2, 'Active', $5, NULL),
       ('L_SCH2', 'C_SCH2', 'SCH2', $2, 'Active', $5, NULL)`,
    [lastYear, thisYear, `${lastYear}-01-05`, `${lastYear}-12-15`, isoDate(-200)],
  );
  await q(
    `INSERT INTO timetable_assignments
       (timetable_assignment_id, school_id, class_id, teacher_id, academic_year, weekday,
        period_number, start_time, end_time, subject, valid_from, valid_to)
     VALUES
       ('TA_PREV', 'SCH1', 'C_PREV', 'T_PREV', $1, 1, 1, '08:00', '09:00', 'Maths', $3, $4),
       ('TA_CUR', 'SCH1', 'C_CUR', 'T_CUR', $2, 1, 1, '08:00', '09:00', 'Maths', $5, NULL),
       ('TA_ALSO', 'SCH1', 'C_CUR', 'T_ALSO', $2, 2, 2, '09:00', '10:00', 'English', $5, NULL),
       ('TA_OTHER', 'SCH1', 'C_OTHER', 'T_OTHER', $2, 1, 2, '09:00', '10:00', 'English', $5, NULL),
       ('TA_SCH2', 'SCH2', 'C_SCH2', 'T_SCH2', $2, 1, 1, '08:00', '09:00', 'Maths', $5, NULL)`,
    [lastYear, thisYear, `${lastYear}-01-05`, `${lastYear}-12-15`, isoDate(-200)],
  );
  return { thisYear, lastYear };
}

let observationCounter = 0;

export async function insertObservation(pool, values) {
  observationCounter += 1;
  const id = values.observation_id ?? `OBS-T${observationCounter}`;
  await pool.query(
    `INSERT INTO observations (
       observation_id, learner_id, teacher_id, school_id, class_id, academic_year,
       observation_date, observed_at, term, observation_type, original_observation,
       activity_context, subject, submission_id, teacher_review_status, possible_theme)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $7::timestamptz, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      id,
      values.learner_id,
      values.teacher_id,
      values.school_id ?? "SCH1",
      values.class_id,
      values.academic_year,
      values.date,
      values.term ?? "Term 1",
      values.type ?? "participation",
      values.text ?? `Observation ${id}`,
      values.context ?? "Group work",
      values.subject ?? "Maths",
      `sub-${id}`,
      values.review_status ?? "not_required",
      values.theme ?? null,
    ],
  );
  return id;
}
