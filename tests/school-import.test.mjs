import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, seedTwoYearSchool } from "./helpers/pglite-db.mjs";

const holder = vi.hoisted(() => ({ pool: null }));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { parseCsv, parseSchoolImport } = await import("../lib/import/school-csv.ts");
const { applySchoolImport } = await import("../lib/services/school-import.ts");
const { createAccount } = await import("../lib/services/sign-up.ts");
const { verifyPin } = await import("../lib/auth/pin.ts");

const STAFF = "full_name,email,role\nGrace Wanjiku,Grace@School.example,teacher\nJoseph Mwangi,joseph@school.example,admin\n";
const LEARNERS =
  "admission_number,full_name,grade,stream\n1042,Amani Otieno,Grade 4,A\n1043,\"Baraka, Jr. Kimani\",Grade 4,A\n1044,Chebet Rono,Grade 5,B\n";
const TIMETABLE =
  "teacher_email,grade,stream,weekday,period,start,end,subject\ngrace@school.example,Grade 4,A,Mon,1,8:00,08:40,Mathematics\njoseph@school.example,Grade 5,B,Tuesday,2,09:00,09:40,English\n";

describe("CSV parsing", () => {
  it("handles quotes, commas inside quotes, CRLF, a BOM and blank lines", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });
});

describe("validation", () => {
  it("accepts good sheets and normalises emails, weekdays and times", () => {
    const parsed = parseSchoolImport({ staff: STAFF, learners: LEARNERS, timetable: TIMETABLE });
    expect(parsed.errors).toEqual([]);
    expect(parsed.staff[0].email).toBe("grace@school.example");
    expect(parsed.learners[1].full_name).toBe("Baraka, Jr. Kimani");
    expect(parsed.timetable[0]).toMatchObject({ weekday: 1, start: "08:00", end: "08:40" });
    expect(parsed.timetable[1].weekday).toBe(2);
  });

  it("reports every bad row with its spreadsheet row number", () => {
    const { errors } = parseSchoolImport({
      staff: "full_name,email,role\nA,not-an-email,teacher\nGrace Wanjiku,g@x.example,principal\n",
      learners:
        "admission_number,full_name,grade,stream\n1,Amani O,Grade 4,A\n1,Amani Again,Grade 4,B\n2,Bea K,,A\n",
      timetable:
        "teacher_email,grade,stream,weekday,period,start,end,subject\ng@x.example,Grade 4,A,Sat,1,08:00,08:40,Maths\ng@x.example,Grade 4,A,Mon,1,09:00,08:00,Maths\n",
    });
    expect(errors.map((e) => `${e.file}:${e.row}`)).toEqual([
      "staff:2",
      "staff:3",
      "learners:3",
      "learners:4",
      "timetable:2",
      "timetable:3",
    ]);
    expect(errors.find((e) => e.file === "learners" && e.row === 3)?.message).toMatch(/more than once/);
  });

  it("reports missing columns once for the whole file", () => {
    const { errors } = parseSchoolImport({ learners: "full_name,grade\nA,B\n" });
    expect(errors).toEqual([
      { file: "learners", row: 0, message: "Missing column(s): admission_number, stream" },
    ]);
  });
});

describe("importing into a workspace", () => {
  let database;
  let admin;
  let seededEnrolments;
  const counts = (sql, params = []) =>
    database.pool.query(sql, params).then((r) => Object.values(r.rows[0])[0]);

  beforeAll(async () => {
    database = await createTestDatabase();
    holder.pool = database.pool;
    await seedTwoYearSchool(database.pool);
    seededEnrolments = await counts(
      "SELECT COUNT(*)::int FROM learner_enrollments WHERE school_id = 'SCH1'",
    );
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
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await database?.close();
  });

  const parsed = () => parseSchoolImport({ staff: STAFF, learners: LEARNERS, timetable: TIMETABLE });

  it("a preview reports the counts but writes nothing, and shows no PINs", async () => {
    const before = await counts("SELECT COUNT(*)::int FROM learners");
    const preview = await applySchoolImport(admin, parsed(), "preview");
    expect(preview).toMatchObject({
      ok: true,
      counts: {
        staff_created: 1,
        staff_updated: 1,
        classes_created: 2,
        learners_created: 3,
        timetable_lessons: 2,
      },
      credentials: [],
    });
    expect(await counts("SELECT COUNT(*)::int FROM learners")).toBe(before);
    expect(await counts("SELECT COUNT(*)::int FROM data_imports")).toBe(0);
  });

  it("a commit saves everything in this workspace, gives new staff a PIN, and marks setup done", async () => {
    const result = await applySchoolImport(admin, parsed(), "commit");
    expect(result.ok).toBe(true);
    expect(result.credentials).toHaveLength(1);
    expect(result.credentials[0].email).toBe("grace@school.example");

    const stored = await database.pool.query("SELECT pin_hash FROM teachers WHERE teacher_id = $1", [
      result.credentials[0].teacher_id,
    ]);
    expect(verifyPin(result.credentials[0].pin, stored.rows[0].pin_hash)).toBe(true);

    // Learners are enrolled in this workspace only, and a teacher is assigned to the class.
    expect(
      await counts("SELECT COUNT(*)::int FROM learner_enrollments WHERE school_id = $1", [admin.school_id]),
    ).toBe(3);
    expect(
      await counts("SELECT COUNT(*)::int FROM timetable_assignments WHERE school_id = $1 AND teacher_id = $2", [
        admin.school_id,
        result.credentials[0].teacher_id,
      ]),
    ).toBe(1);
    expect(
      await counts("SELECT setup_completed_at IS NOT NULL FROM schools WHERE school_id = $1", [
        admin.school_id,
      ]),
    ).toBe(true);
    // The seeded school was not touched.
    expect(await counts("SELECT COUNT(*)::int FROM learner_enrollments WHERE school_id = 'SCH1'")).toBe(
      seededEnrolments,
    );
  });

  it("importing the same sheets again changes nothing (idempotent) and issues no new PINs", async () => {
    const again = await applySchoolImport(admin, parsed(), "commit");
    expect(again.ok).toBe(true);
    expect(again.counts).toMatchObject({
      staff_created: 0,
      classes_created: 0,
      learners_created: 0,
      learners_updated: 3,
    });
    expect(again.credentials).toEqual([]);
    expect(
      await counts("SELECT COUNT(*)::int FROM learners WHERE school_id = $1", [admin.school_id]),
    ).toBe(3);
    expect(
      await counts("SELECT COUNT(*)::int FROM timetable_assignments WHERE school_id = $1", [admin.school_id]),
    ).toBe(2);
  });

  it("does not let an import change the importing admin's own role", async () => {
    const demote = parseSchoolImport({
      staff: "full_name,email,role\nJoseph Mwangi,joseph@school.example,teacher\n",
    });
    await applySchoolImport(admin, demote, "commit");
    expect(await counts("SELECT role FROM teachers WHERE teacher_id = $1", [admin.teacher_id])).toBe("admin");
  });

  it("refuses an email that already belongs to another workspace, and saves nothing", async () => {
    const clash = parseSchoolImport({
      staff: "full_name,email,role\nSomeone,other@elsewhere.example,teacher\n",
      learners: "admission_number,full_name,grade,stream\n9001,New Learner,Grade 6,C\n",
    });
    await createAccount({
      account_type: "individual",
      full_name: "Someone Else",
      email: "other@elsewhere.example",
      pin: "123456",
    });
    const result = await applySchoolImport(admin, clash, "commit");
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({ file: "staff", row: 2 });
    expect(await counts("SELECT COUNT(*)::int FROM learners WHERE external_ref = '9001'")).toBe(0);
  });

  it("refuses a timetable row for a teacher who is not on the staff list, and saves nothing", async () => {
    const bad = parseSchoolImport({
      learners: "admission_number,full_name,grade,stream\n9002,Late Learner,Grade 7,D\n",
      timetable:
        "teacher_email,grade,stream,weekday,period,start,end,subject\nnobody@school.example,Grade 7,D,Mon,1,08:00,08:40,Maths\n",
    });
    const result = await applySchoolImport(admin, bad, "commit");
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toMatch(/not in your staff list/);
    expect(await counts("SELECT COUNT(*)::int FROM learners WHERE external_ref = '9002'")).toBe(0);
  });

  it("only an administrator can import", async () => {
    const result = await applySchoolImport({ ...admin, role: "teacher" }, parsed(), "commit");
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toMatch(/administrator/);
  });
});
