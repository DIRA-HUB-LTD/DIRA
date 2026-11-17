import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, insertObservation, seedTwoYearSchool } from "./helpers/pglite-db.mjs";

const holder = vi.hoisted(() => ({ pool: null }));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));

const { loadImpactDashboard } = await import("../lib/services/impact-dashboard.ts");
const year = new Date().getUTCFullYear();
const date = new Date().toISOString().slice(0, 10);

describe("impact dashboard numbers", () => {
  let database;

  beforeAll(async () => {
    database = await createTestDatabase();
    holder.pool = database.pool;
    await seedTwoYearSchool(database.pool);
    // L1 is seen twice this week by its current teacher; L2 once; L3 (another class) once.
    await insertObservation(database.pool, { learner_id: "L1", teacher_id: "T_CUR", class_id: "C_CUR", academic_year: year, date });
    await insertObservation(database.pool, { learner_id: "L1", teacher_id: "T_CUR", class_id: "C_CUR", academic_year: year, date });
    await insertObservation(database.pool, { learner_id: "L2", teacher_id: "T_CUR", class_id: "C_CUR", academic_year: year, date });
    await insertObservation(database.pool, { learner_id: "L3", teacher_id: "T_OTHER", class_id: "C_OTHER", academic_year: year, date });
    await database.pool.query(
      `INSERT INTO activity_tests (test_id, learner_id, suggested_activity, activity_date,
         conducting_teacher_id, status, accepted_at)
       VALUES ('T1', 'L1', 'Pair talk', CURRENT_DATE, 'T_CUR', 'ACCEPTED', NOW()),
              ('T2', 'L2', 'Other', CURRENT_DATE, 'T_CUR', 'SUGGESTED', NULL)`,
    );
    await database.pool.query(
      `INSERT INTO teacher_follow_up_jobs (calendar_entry_id, school_id, class_id, teacher_id,
         scheduled_date, scheduled_end_at, idempotency_key, is_manual_demo, status)
       VALUES (NULL, 'SCH1', 'C_CUR', 'T_CUR', CURRENT_DATE, NOW(), 'k-1', TRUE, 'provider_accepted')`,
    );
  });

  afterAll(async () => {
    await database?.close();
  });

  it("counts the whole school for an administrator", async () => {
    const result = await loadImpactDashboard({ schoolId: "SCH1", teacherId: null });
    expect(result.visibility).toMatchObject({ learners: 3, seen_this_term: 3, seen_twice_this_term: 1 });
    expect(result.followThrough).toMatchObject({ suggested: 2, accepted: 1, outcomes: 0, assessed: 0 });
    expect(result.weeks).toHaveLength(12);
    expect(result.weeks.at(-1).observations).toBe(4);
    expect(result.calendar).toHaveLength(1);
    expect(result.calendar[0]).toMatchObject({ label: "Grade 4 A", status: "provider_accepted" });
  });

  it("narrows to a teacher's own classes", async () => {
    const result = await loadImpactDashboard({ schoolId: "SCH1", teacherId: "T_OTHER" });
    expect(result.visibility).toMatchObject({ learners: 1, seen_this_term: 1 });
    expect(result.followThrough.suggested).toBe(0);
    expect(result.calendar).toHaveLength(0);
  });

  it("never shows another school's learners", async () => {
    const result = await loadImpactDashboard({ schoolId: "SCH2", teacherId: null });
    expect(result.visibility.learners).toBe(1);
    expect(result.visibility.seen_this_term).toBe(0);
  });
});
