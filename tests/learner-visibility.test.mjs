import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  insertObservation,
  isoDate,
  seedTwoYearSchool,
} from "./helpers/pglite-db.mjs";

const holder = vi.hoisted(() => ({ pool: null }));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));

const { buildEvidenceSummary, EvidenceSummaryNotFoundError } = await import(
  "../lib/services/evidence-summary.ts"
);
const { loadLearnerSuggestionContext, loadPreviousSuggestions } = await import(
  "../lib/services/suggestion-workflow.ts"
);

let database;
let years;
const CURRENT = { teacher_id: "T_CUR", school_id: "SCH1" };

beforeAll(async () => {
  database = await createTestDatabase();
  holder.pool = database.pool;
  years = await seedTwoYearSchool(database.pool);
  // Last year, recorded by the previous teacher in the Grade 3 class.
  await insertObservation(database.pool, {
    observation_id: "OBS-LAST-YEAR",
    learner_id: "L1",
    teacher_id: "T_PREV",
    class_id: "C_PREV",
    academic_year: years.lastYear,
    date: `${years.lastYear}-03-10`,
    text: "Organised the group without being asked.",
  });
  // This year, recorded by the current teacher.
  await insertObservation(database.pool, {
    observation_id: "OBS-THIS-YEAR",
    learner_id: "L1",
    teacher_id: "T_CUR",
    class_id: "C_CUR",
    academic_year: years.thisYear,
    date: isoDate(-20),
  });
  // A test the previous teacher ran last year.
  await database.pool.query(
    `INSERT INTO activity_tests (test_id, learner_id, suggested_activity, activity_date,
       conducting_teacher_id, status, accepted_at)
     VALUES ('TEST-LAST-YEAR', 'L1', 'Group task with no assigned leader', $1::date, 'T_PREV', 'ACCEPTED', NOW())`,
    [`${years.lastYear}-04-01`],
  );
});

afterAll(async () => {
  await database?.close();
});

describe("learner visibility: the long view", () => {
  it("shows the current teacher the learner's observations from previous years", async () => {
    const snapshot = await buildEvidenceSummary("L1", CURRENT);
    const ids = snapshot.observations.map((item) => item.observation_id);
    expect(ids).toContain("OBS-LAST-YEAR");
    expect(ids).toContain("OBS-THIS-YEAR");
    const lastYear = snapshot.observations.find((item) => item.observation_id === "OBS-LAST-YEAR");
    expect(lastYear.academic_year).toBe(years.lastYear);
  });

  it("shows tests run by earlier teachers at the same school", async () => {
    const snapshot = await buildEvidenceSummary("L1", CURRENT);
    expect(snapshot.tests.map((test) => test.test_id)).toContain("TEST-LAST-YEAR");
    const previous = await loadPreviousSuggestions("L1", CURRENT);
    expect(previous.map((test) => test.test_id)).toContain("TEST-LAST-YEAR");
  });

  it("gives Suggest Test and the agent the full multi-year evidence", async () => {
    const context = await loadLearnerSuggestionContext("L1", CURRENT);
    expect(context.grade_level).toBe("Grade 4");
    expect(context.observations.map((item) => item.observation_id)).toEqual([
      "OBS-LAST-YEAR",
      "OBS-THIS-YEAR",
    ]);
  });

  it("lets a second teacher of the same class see everything too", async () => {
    const snapshot = await buildEvidenceSummary("L1", { teacher_id: "T_ALSO", school_id: "SCH1" });
    expect(snapshot.observations).toHaveLength(2);
  });

  it("denies a teacher who does not currently teach the learner", async () => {
    await expect(
      buildEvidenceSummary("L1", { teacher_id: "T_OTHER", school_id: "SCH1" }),
    ).rejects.toBeInstanceOf(EvidenceSummaryNotFoundError);
    // The previous teacher's assignment has ended, so they no longer have access either.
    await expect(
      buildEvidenceSummary("L1", { teacher_id: "T_PREV", school_id: "SCH1" }),
    ).rejects.toBeInstanceOf(EvidenceSummaryNotFoundError);
  });

  it("denies a teacher from another school, even with a forged school id", async () => {
    await expect(
      buildEvidenceSummary("L1", { teacher_id: "T_SCH2", school_id: "SCH2" }),
    ).rejects.toBeInstanceOf(EvidenceSummaryNotFoundError);
    await expect(
      buildEvidenceSummary("L1", { teacher_id: "T_SCH2", school_id: "SCH1" }),
    ).rejects.toBeInstanceOf(EvidenceSummaryNotFoundError);
  });

  it("keeps history at the old school when a learner moves school (decision D3)", async () => {
    // L_SCH2 has an old observation recorded at SCH1 (e.g. before transferring).
    await database.pool.query(
      `INSERT INTO learner_enrollments
         (learner_id, class_id, school_id, academic_year, enrolment_status, enrolled_from, enrolled_to)
       VALUES ('L_SCH2', 'C_PREV', 'SCH1', $1, 'Withdrawn', $2, $3)`,
      [years.lastYear, `${years.lastYear}-01-05`, `${years.lastYear}-06-01`],
    );
    await insertObservation(database.pool, {
      observation_id: "OBS-OLD-SCHOOL",
      learner_id: "L_SCH2",
      teacher_id: "T_PREV",
      class_id: "C_PREV",
      academic_year: years.lastYear,
      date: `${years.lastYear}-02-10`,
    });
    const snapshot = await buildEvidenceSummary("L_SCH2", { teacher_id: "T_SCH2", school_id: "SCH2" });
    expect(snapshot.observations.map((item) => item.observation_id)).not.toContain("OBS-OLD-SCHOOL");
  });
});
