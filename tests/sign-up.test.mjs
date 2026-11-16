import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, seedTwoYearSchool } from "./helpers/pglite-db.mjs";

const holder = vi.hoisted(() => ({ pool: null }));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { createAccount, SignUpError, signUpSchema } = await import("../lib/services/sign-up.ts");
const { signInTeacher, postSignInDestination, signUpIsEnabled } = await import(
  "../lib/auth/teacher-session.ts"
);

const SECRET = "a-test-session-secret-that-is-long-enough";

describe("sign-up input", () => {
  const person = { full_name: "Wanjiru Kamau", email: "  Wanjiru@Example.com ", pin: "482913" };

  it("accepts an individual and an enterprise account, and lower-cases the email", () => {
    const individual = signUpSchema.parse({ account_type: "individual", ...person });
    expect(individual.email).toBe("wanjiru@example.com");
    expect(
      signUpSchema.safeParse({ account_type: "enterprise", organisation_name: "Moi Primary", ...person })
        .success,
    ).toBe(true);
  });

  it("requires an organisation name for an enterprise and a choice of account type", () => {
    expect(signUpSchema.safeParse({ account_type: "enterprise", ...person }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...person }).success).toBe(false);
    expect(signUpSchema.safeParse({ account_type: "other", ...person }).success).toBe(false);
  });

  it("requires a 6 to 8 digit PIN and a real email", () => {
    for (const pin of ["1234", "12345", "123456789", "abcdef"]) {
      expect(signUpSchema.safeParse({ account_type: "individual", ...person, pin }).success).toBe(false);
    }
    expect(
      signUpSchema.safeParse({ account_type: "individual", ...person, email: "not-an-email" }).success,
    ).toBe(false);
  });
});

describe("sign-up against the database", () => {
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

  const person = (over = {}) => ({
    full_name: "Wanjiru Kamau",
    email: "wanjiru@example.com",
    pin: "482913",
    ...over,
  });

  it("creates a personal workspace with one admin teacher, who can sign in by email", async () => {
    const result = await createAccount({ account_type: "individual", ...person() });
    expect(result.teacher).toMatchObject({ role: "admin", workspace_kind: "personal" });
    expect(result.next).toBe("/welcome");

    const school = await database.pool.query("SELECT * FROM schools WHERE school_id = $1", [
      result.teacher.school_id,
    ]);
    expect(school.rows[0]).toMatchObject({ kind: "personal", timezone: "Africa/Nairobi" });
    const members = await database.pool.query("SELECT * FROM teachers WHERE school_id = $1", [
      result.teacher.school_id,
    ]);
    expect(members.rows).toHaveLength(1);
    expect(members.rows[0].pin_hash).toMatch(/^scrypt\$/);

    const byEmail = await signInTeacher("Wanjiru@Example.com", "482913");
    expect(byEmail.teacher.teacher_id).toBe(result.teacher.teacher_id);
    const byId = await signInTeacher(result.teacher.teacher_id, "482913");
    expect(byId.teacher.school_id).toBe(result.teacher.school_id);
  });

  it("creates an enterprise workspace named for the organisation, with the signer as admin", async () => {
    const result = await createAccount({
      account_type: "enterprise",
      organisation_name: "Moi Primary School",
      ...person({ email: "head@moi.example" }),
    });
    expect(result.teacher).toMatchObject({ role: "admin", workspace_kind: "school" });
    const school = await database.pool.query("SELECT school_name, kind FROM schools WHERE school_id = $1", [
      result.teacher.school_id,
    ]);
    expect(school.rows[0]).toEqual({ school_name: "Moi Primary School", kind: "school" });
  });

  it("refuses a second account with the same email and leaves no orphan workspace", async () => {
    const before = await database.pool.query("SELECT COUNT(*)::int AS n FROM schools");
    await expect(
      createAccount({ account_type: "individual", ...person({ email: "WANJIRU@example.com" }) }),
    ).rejects.toMatchObject({ code: "email_taken" });
    const after = await database.pool.query("SELECT COUNT(*)::int AS n FROM schools");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("keeps a new workspace separate from every other workspace", async () => {
    const result = await createAccount({
      account_type: "individual",
      ...person({ email: "isolated@example.com" }),
    });
    const own = await database.pool.query(
      "SELECT COUNT(*)::int AS n FROM learner_enrollments WHERE school_id = $1",
      [result.teacher.school_id],
    );
    expect(own.rows[0].n).toBe(0);
  });

  it("sends a new workspace to setup, and an existing seeded school straight to the app", async () => {
    const created = await createAccount({
      account_type: "individual",
      ...person({ email: "setup@example.com" }),
    });
    expect(await postSignInDestination(created.teacher.school_id)).toBe("/welcome");
    // Schools that existed before the migration are marked complete by it; the test
    // seeds SCH1 afterwards, so mark it the same way.
    await database.pool.query("UPDATE schools SET setup_completed_at = NOW() WHERE school_id = 'SCH1'");
    expect(await postSignInDestination("SCH1")).toBe("/this-week");
  });

  it("is closed in production unless switched on", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DIRA_SIGN_UP_ENABLED", "");
    expect(signUpIsEnabled()).toBe(false);
    await expect(
      createAccount({ account_type: "individual", ...person({ email: "closed@example.com" }) }),
    ).rejects.toBeInstanceOf(SignUpError);
    vi.stubEnv("DIRA_SIGN_UP_ENABLED", "true");
    expect(signUpIsEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DIRA_SIGN_UP_ENABLED", "");
  });
});
