import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  insertObservation,
  isoDate,
  seedTwoYearSchool,
} from "./helpers/pglite-db.mjs";

const holder = vi.hoisted(() => ({ pool: null }));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));

const { FOCUS_LIST_SIZE, focusPeriodFor, getFocusList, localDate } = await import(
  "../lib/services/focus-rotation.ts"
);

describe("focus period arithmetic", () => {
  it("uses fixed 14-day periods starting on Mondays", () => {
    expect(focusPeriodFor("2026-11-13")).toEqual({
      period_start: "2026-11-02",
      period_end: "2026-11-15",
    });
    expect(focusPeriodFor("2026-11-16").period_start).toBe("2026-11-16");
    expect(focusPeriodFor("2026-11-15").period_start).toBe("2026-11-02");
    expect(new Date("2026-11-02T00:00:00Z").getUTCDay()).toBe(1);
  });

  it("rejects malformed dates", () => {
    expect(() => focusPeriodFor("13/11/2026")).toThrow();
  });

  it("computes today in the school's timezone", () => {
    // 22:30 UTC on 13 Nov is already 14 Nov in Nairobi (UTC+3).
    const now = new Date("2026-11-13T22:30:00Z");
    expect(localDate(now, "Africa/Nairobi")).toBe("2026-11-14");
    expect(localDate(now, "Not/AZone")).toBe("2026-11-13");
  });
});

describe("fortnightly focus list", () => {
  let database;
  let years;
  const today = isoDate(0);

  beforeAll(async () => {
    database = await createTestDatabase();
    holder.pool = database.pool;
    years = await seedTwoYearSchool(database.pool);
    // A large class: 25 more learners in T_CUR's class C_CUR.
    for (let index = 1; index <= 25; index += 1) {
      const id = `BIG${String(index).padStart(2, "0")}`;
      await database.pool.query(
        "INSERT INTO learners (learner_id, display_name) VALUES ($1, $2)",
        [id, `Learner ${index}`],
      );
      await database.pool.query(
        `INSERT INTO learner_enrollments
           (learner_id, class_id, school_id, academic_year, enrolment_status, enrolled_from)
         VALUES ($1, 'C_CUR', 'SCH1', $2, 'Active', $3)`,
        [id, years.thisYear, isoDate(-200)],
      );
    }
    // Most learners have been observed this year; three have not.
    for (let index = 1; index <= 22; index += 1) {
      await insertObservation(database.pool, {
        learner_id: `BIG${String(index).padStart(2, "0")}`,
        teacher_id: index % 2 === 0 ? "T_CUR" : "T_ALSO",
        class_id: "C_CUR",
        academic_year: years.thisYear,
        date: isoDate(-40 + index),
      });
    }
  });

  afterAll(async () => {
    await database?.close();
  });

  it("picks at most 10 learners, only from the teacher's own classes", async () => {
    const list = await getFocusList({ teacher_id: "T_CUR", school_id: "SCH1" }, today);
    expect(list.learners).toHaveLength(FOCUS_LIST_SIZE);
    const ids = list.learners.map((item) => item.learner_id);
    expect(ids).not.toContain("L3"); // other class
    expect(ids).not.toContain("L_SCH2"); // other school
  });

  it("puts learners with no observation this year first", async () => {
    const list = await getFocusList({ teacher_id: "T_CUR", school_id: "SCH1" }, today);
    const unobserved = ["BIG23", "BIG24", "BIG25", "L1", "L2"];
    const firstFive = list.learners.slice(0, 5);
    expect(firstFive.map((item) => item.learner_id).sort()).toEqual(unobserved.sort());
    expect(firstFive.every((item) => item.reason === "no_observation_this_year")).toBe(true);
    // Then learners this teacher has never observed (observed only by T_ALSO).
    expect(list.learners[5].reason).toBe("not_observed_by_this_teacher");
  });

  it("stays the same for the whole fortnight, even after observations are logged", async () => {
    const context = { teacher_id: "T_CUR", school_id: "SCH1" };
    const before = await getFocusList(context, today);
    await insertObservation(database.pool, {
      learner_id: "BIG23",
      teacher_id: "T_CUR",
      class_id: "C_CUR",
      academic_year: years.thisYear,
      date: today,
    });
    const after = await getFocusList(context, today);
    expect(after.learners.map((item) => item.learner_id)).toEqual(
      before.learners.map((item) => item.learner_id),
    );
    expect(after.learners.find((item) => item.learner_id === "BIG23").observed_this_period).toBe(true);
  });

  it("gives each teacher their own list", async () => {
    const other = await getFocusList({ teacher_id: "T_OTHER", school_id: "SCH1" }, today);
    expect(other.learners.map((item) => item.learner_id)).toEqual(["L3"]);
  });

  it("rotates to a fresh list in the next fortnight", async () => {
    const context = { teacher_id: "T_CUR", school_id: "SCH1" };
    const current = await getFocusList(context, today);
    const nextStart = focusPeriodFor(today).period_end;
    const nextDay = new Date(`${nextStart}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const next = await getFocusList(context, nextDay.toISOString().slice(0, 10));
    expect(next.period_start).not.toBe(current.period_start);
    // BIG23 was observed this year now, so it no longer leads the list.
    expect(next.learners[0].learner_id).not.toBe("BIG23");
  });
});
