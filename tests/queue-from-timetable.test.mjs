import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "./helpers/pglite-db.mjs";

const holder = vi.hoisted(() => ({ pool: null }));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { createAccount } = await import("../lib/services/sign-up.ts");
const { parseSchoolImport } = await import("../lib/import/school-csv.ts");
const { applySchoolImport } = await import("../lib/services/school-import.ts");
const { prepareDailyFollowUpQueue, confirmSchoolOpenDays, schoolDaysAreConfirmed } = await import(
  "../lib/services/follow-up-queue.ts"
);

// A Tuesday inside the current year, 07:00 in Nairobi (04:00 UTC).
function secondTuesdayOfThisYear() {
  const year = new Date().getFullYear();
  let day = new Date(Date.UTC(year, 0, 1));
  let tuesdays = 0;
  while (true) {
    if (day.getUTCDay() === 2 && ++tuesdays === 2) break;
    day = new Date(day.getTime() + 86_400_000);
  }
  return { at: new Date(day.getTime() + 4 * 3_600_000), date: day.toISOString().slice(0, 10) };
}

const STAFF = "full_name,email,role\nGrace Wanjiku,grace@school.example,teacher\nPeter Odhiambo,peter@school.example,teacher\n";
const LEARNERS = "admission_number,full_name,grade,stream\n1042,Amani Otieno,Grade 4,A\n1043,Baraka Kimani,Grade 5,B\n";
const TIMETABLE =
  "teacher_email,grade,stream,weekday,period,start,end,subject\n" +
  "grace@school.example,Grade 4,A,Tue,1,08:00,08:40,Mathematics\n" +
  "peter@school.example,Grade 5,B,Tue,2,08:40,09:20,English\n" +
  "grace@school.example,Grade 4,A,Wed,1,08:00,08:40,Mathematics\n";

describe("queueing a school's calls from an uploaded timetable", () => {
  let database;
  let admin;
  const tuesday = secondTuesdayOfThisYear();

  beforeAll(async () => {
    database = await createTestDatabase();
    holder.pool = database.pool;
    vi.stubEnv("DIRA_SESSION_SECRET", "a-test-session-secret-that-is-long-enough");
    admin = (
      await createAccount({
        account_type: "enterprise",
        organisation_name: "Moi Primary",
        full_name: "Joseph Mwangi",
        email: "joseph@school.example",
        pin: "482913",
      })
    ).teacher;
    const result = await applySchoolImport(
      admin,
      parseSchoolImport({ staff: STAFF, learners: LEARNERS, timetable: TIMETABLE }),
      "commit",
    );
    expect(result.ok).toBe(true);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await database?.close();
  });

  it("does nothing until an administrator confirms the school is open", async () => {
    const result = await prepareDailyFollowUpQueue(tuesday.at, admin.school_id);
    expect(result.schools[0].blocked_reason).toMatch(/not confirmed/);
    expect(result.schools[0].queued).toBe(0);
    expect(await schoolDaysAreConfirmed(admin.school_id, tuesday.date)).toBe(false);
  });

  it("builds that day's calendar from the timetable and queues one call per lesson", async () => {
    await confirmSchoolOpenDays(admin.school_id, tuesday.date, tuesday.date);
    expect(await schoolDaysAreConfirmed(admin.school_id, tuesday.date)).toBe(true);

    const result = await prepareDailyFollowUpQueue(tuesday.at, admin.school_id);
    expect(result.schools[0]).toMatchObject({ local_date: tuesday.date, queued: 2 });

    const jobs = await database.pool.query(
      `SELECT t.email, j.status, to_char(j.scheduled_end_at AT TIME ZONE 'Africa/Nairobi', 'HH24:MI') AS ends
       FROM teacher_follow_up_jobs j JOIN teachers t ON t.teacher_id = j.teacher_id
       WHERE j.school_id = $1 ORDER BY ends`,
      [admin.school_id],
    );
    expect(jobs.rows).toEqual([
      { email: "grace@school.example", status: "queued", ends: "08:40" },
      { email: "peter@school.example", status: "queued", ends: "09:20" },
    ]);
  });

  it("running it again does not duplicate anything", async () => {
    await prepareDailyFollowUpQueue(tuesday.at, admin.school_id);
    const count = await database.pool.query(
      "SELECT COUNT(*)::int AS n FROM teacher_follow_up_jobs WHERE school_id = $1",
      [admin.school_id],
    );
    expect(count.rows[0].n).toBe(2);
    const calendar = await database.pool.query(
      "SELECT COUNT(*)::int AS n FROM school_calendar WHERE school_id = $1",
      [admin.school_id],
    );
    expect(calendar.rows[0].n).toBe(2);
  });

  it("another workspace's timetable is never queued", async () => {
    const other = (
      await createAccount({
        account_type: "individual",
        full_name: "Solo Teacher",
        email: "solo@example.com",
        pin: "482913",
      })
    ).teacher;
    await confirmSchoolOpenDays(other.school_id, tuesday.date, tuesday.date);
    const result = await prepareDailyFollowUpQueue(tuesday.at, other.school_id);
    expect(result.schools[0].queued).toBe(0);
  });
});
