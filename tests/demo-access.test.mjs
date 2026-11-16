import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, seedTwoYearSchool } from "./helpers/pglite-db.mjs";

const holder = vi.hoisted(() => ({ pool: null }));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { startDemoSession, teacherExtras, completeTour } = await import("../lib/services/demo-access.ts");
const { createAccount } = await import("../lib/services/sign-up.ts");
const { verifySessionToken } = await import("../lib/auth/session-token.ts");

const SECRET = "a-test-session-secret-that-is-long-enough";

describe("the public demo and the guided tour", () => {
  let database;

  beforeAll(async () => {
    database = await createTestDatabase();
    holder.pool = database.pool;
    await seedTwoYearSchool(database.pool);
    vi.stubEnv("DIRA_SESSION_SECRET", SECRET);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await database?.close();
  });

  it("has nothing to open when no demo school exists", async () => {
    vi.stubEnv("DIRA_DEMO_SCHOOL_ID", "SCH-NOPE");
    expect(await startDemoSession()).toBeNull();
  });

  it("opens the configured demo school as its first teacher and flags it", async () => {
    vi.stubEnv("DIRA_DEMO_SCHOOL_ID", "SCH1");
    const session = await startDemoSession();
    expect(session.teacher).toMatchObject({ school_id: "SCH1", workspace_kind: "school" });
    expect(verifySessionToken(session.token, SECRET)).toMatchObject({ school_id: "SCH1" });
    const school = await database.pool.query("SELECT is_demo, setup_completed_at FROM schools WHERE school_id = 'SCH1'");
    expect(school.rows[0].is_demo).toBe(true);
    expect(school.rows[0].setup_completed_at).not.toBeNull();
    expect((await teacherExtras(session.teacher)).is_demo).toBe(true);
  });

  it("prefers the flagged school over the configured id afterwards", async () => {
    vi.stubEnv("DIRA_DEMO_SCHOOL_ID", "SCH2");
    expect((await startDemoSession()).teacher.school_id).toBe("SCH1");
  });

  it("never opens a real workspace", async () => {
    const real = await createAccount({
      account_type: "enterprise",
      organisation_name: "Real School",
      full_name: "Head",
      email: "head@real.example",
      pin: "482913",
    });
    expect((await startDemoSession()).teacher.school_id).not.toBe(real.teacher.school_id);
    expect((await teacherExtras(real.teacher)).is_demo).toBe(false);
  });

  it("shows the tour once: pending until finished or skipped", async () => {
    const teacher = { teacher_id: "T_CUR", school_id: "SCH1" };
    expect((await teacherExtras(teacher)).tour_pending).toBe(true);
    await completeTour(teacher);
    expect((await teacherExtras(teacher)).tour_pending).toBe(false);
    expect((await teacherExtras({ teacher_id: "T_ALSO", school_id: "SCH1" })).tour_pending).toBe(true);
  });
});
