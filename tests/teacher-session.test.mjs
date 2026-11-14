import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, seedTwoYearSchool } from "./helpers/pglite-db.mjs";

const holder = vi.hoisted(() => ({ pool: null, cookie: undefined }));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name) =>
      name === "dira_teacher_session" && holder.cookie ? { value: holder.cookie } : undefined,
  }),
}));

const { hashPin, verifyPin } = await import("../lib/auth/pin.ts");
const { createSessionToken, verifySessionToken } = await import("../lib/auth/session-token.ts");
const { getSignedInTeacher, SignInError, signInTeacher } = await import(
  "../lib/auth/teacher-session.ts"
);
const { resolveTeacherContext } = await import("../lib/auth/teacher-context.ts");

const SECRET = "a-test-session-secret-that-is-long-enough";

describe("PIN hashing", () => {
  it("verifies the right PIN and rejects others", () => {
    const stored = hashPin("4821");
    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(verifyPin("4821", stored)).toBe(true);
    expect(verifyPin("4822", stored)).toBe(false);
    expect(verifyPin("4821", null)).toBe(false);
    expect(hashPin("4821")).not.toBe(stored); // salted
  });

  it("only accepts 4 to 8 digit PINs", () => {
    expect(() => hashPin("12")).toThrow();
    expect(() => hashPin("abcd")).toThrow();
  });
});

describe("session tokens", () => {
  const teacher = { teacher_id: "T1", school_id: "S1" };

  it("round-trips and expires after a school day", () => {
    const now = Date.UTC(2026, 10, 13, 8);
    const token = createSessionToken(teacher, SECRET, now);
    expect(verifySessionToken(token, SECRET, now)).toMatchObject(teacher);
    expect(verifySessionToken(token, SECRET, now + 9 * 3600 * 1000)).toBeNull();
  });

  it("rejects tampered payloads, wrong secrets and short secrets", () => {
    const token = createSessionToken(teacher, SECRET);
    const [, signature] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ ...teacher, teacher_id: "T2", exp: 9e9 })).toString("base64url")}.${signature}`;
    expect(verifySessionToken(forged, SECRET)).toBeNull();
    expect(verifySessionToken(token, `${SECRET}-other`)).toBeNull();
    expect(verifySessionToken(token, "short")).toBeNull();
    expect(() => createSessionToken(teacher, "short")).toThrow();
  });
});

describe("teacher sign-in against the database", () => {
  let database;

  beforeAll(async () => {
    database = await createTestDatabase();
    holder.pool = database.pool;
    await seedTwoYearSchool(database.pool);
    await database.pool.query("UPDATE teachers SET pin_hash = $1 WHERE teacher_id = 'T_CUR'", [
      hashPin("4821"),
    ]);
    vi.stubEnv("DIRA_SESSION_SECRET", SECRET);
  });

  afterEach(() => {
    holder.cookie = undefined;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await database?.close();
  });

  it("signs in with the right PIN and resolves that teacher on later requests", async () => {
    const { teacher, token } = await signInTeacher("T_CUR", "4821");
    expect(teacher).toEqual({
      teacher_id: "T_CUR",
      school_id: "SCH1",
      display_name: "Current Teacher",
    });
    holder.cookie = token;
    expect(await getSignedInTeacher()).toEqual(teacher);
    expect(await resolveTeacherContext()).toEqual({ teacher_id: "T_CUR", school_id: "SCH1" });
  });

  it("rejects a wrong PIN and a teacher without a PIN", async () => {
    await expect(signInTeacher("T_CUR", "0000")).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    await expect(signInTeacher("T_PREV", "4821")).rejects.toBeInstanceOf(SignInError);
  });

  it("locks a teacher ID after repeated failures", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signInTeacher("T_ALSO", "1111").catch(() => {});
    }
    await expect(signInTeacher("T_ALSO", "1111")).rejects.toMatchObject({
      code: "too_many_attempts",
    });
  });

  it("never treats the demo fallback as a signed-in teacher", async () => {
    holder.cookie = undefined;
    expect(await getSignedInTeacher()).toBeNull();
    // resolveTeacherContext still returns the demo teacher outside production…
    expect(await resolveTeacherContext()).not.toBeNull();
  });

  it("refuses to sign in when no session secret is configured", async () => {
    vi.stubEnv("DIRA_SESSION_SECRET", "");
    await expect(signInTeacher("T_CUR", "4821")).rejects.toMatchObject({ code: "not_configured" });
    vi.stubEnv("DIRA_SESSION_SECRET", SECRET);
  });
});
