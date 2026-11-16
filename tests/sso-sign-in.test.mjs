import { generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "./helpers/pglite-db.mjs";

const holder = vi.hoisted(() => ({ pool: null }));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const oidc = await import("../lib/auth/oidc.ts");
const { resolveSsoSignIn } = await import("../lib/services/sso-sign-in.ts");
const { createAccount } = await import("../lib/services/sign-up.ts");
const { signInTeacher } = await import("../lib/auth/teacher-session.ts");

const CLIENT_ID = "dira-client-id";
const NONCE = "nonce-123";
const TID = "11111111-2222-3333-4444-555555555555";
const SECRET = "a-test-session-secret-that-is-long-enough";

let privateKey;
let publicKey;
beforeAll(async () => {
  ({ privateKey, publicKey } = await generateKeyPair("RS256"));
});

function token(claims, { iss, aud = CLIENT_ID, expiresIn = "5m" } = {}) {
  return new SignJWT({ nonce: NONCE, ...claims })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}
const verify = (provider, jwt) =>
  oidc.verifyIdToken(provider, jwt, { clientId: CLIENT_ID, nonce: NONCE }, publicKey);

describe("ID token verification", () => {
  it("accepts a Google token and trusts the email only when Google says it is verified", async () => {
    const jwt = await token(
      { sub: "g-1", email: "Ann@School.org", email_verified: true, name: "Ann", hd: "School.org" },
      { iss: "https://accounts.google.com" },
    );
    expect(await verify("google", jwt)).toEqual({
      provider: "google",
      subject: "g-1",
      email: "ann@school.org",
      emailVerified: true,
      name: "Ann",
      tenant: "school.org",
    });
  });

  it("accepts a Microsoft token, scopes the subject to the tenant, and never trusts the email", async () => {
    const jwt = await token(
      { sub: "pairwise", oid: "oid-9", tid: TID, email: "Bo@School.org", name: "Bo" },
      { iss: `https://login.microsoftonline.com/${TID}/v2.0` },
    );
    expect(await verify("microsoft", jwt)).toMatchObject({
      subject: `${TID}.oid-9`,
      email: "bo@school.org",
      emailVerified: false,
      tenant: TID,
    });
  });

  it("gives personal Microsoft accounts no tenant", async () => {
    const consumer = oidc.MICROSOFT_CONSUMER_TENANT;
    const jwt = await token(
      { sub: "s", oid: "o", tid: consumer, preferred_username: "me@outlook.com" },
      { iss: `https://login.microsoftonline.com/${consumer}/v2.0` },
    );
    expect((await verify("microsoft", jwt)).tenant).toBeNull();
  });

  it("rejects the wrong audience, the wrong nonce, an expired token and a foreign key", async () => {
    const iss = "https://accounts.google.com";
    await expect(verify("google", await token({ sub: "a" }, { iss, aud: "someone-else" }))).rejects.toThrow();
    await expect(
      verify("google", await token({ sub: "a", nonce: "replayed" }, { iss })),
    ).rejects.toThrow(/does not belong/);
    await expect(verify("google", await token({ sub: "a" }, { iss, expiresIn: "-1m" }))).rejects.toThrow();
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({ nonce: NONCE, sub: "a" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(iss)
      .setAudience(CLIENT_ID)
      .setExpirationTime("5m")
      .sign(other.privateKey);
    await expect(verify("google", forged)).rejects.toThrow();
  });

  it("rejects a Google token from another issuer, and a Microsoft issuer that disagrees with tid", async () => {
    await expect(
      verify("google", await token({ sub: "a" }, { iss: "https://evil.example" })),
    ).rejects.toThrow();
    await expect(
      verify(
        "microsoft",
        await token(
          { sub: "a", oid: "o", tid: TID },
          { iss: "https://login.microsoftonline.com/99999999-0000-0000-0000-000000000000/v2.0" },
        ),
      ),
    ).rejects.toThrow(/issuer/);
  });
});

describe("the redirect", () => {
  it("builds a PKCE authorization URL with state and nonce", () => {
    const url = new URL(
      oidc.buildAuthorizeUrl("microsoft", {
        clientId: CLIENT_ID,
        redirectUri: "https://dira.example/cb",
        state: "S",
        nonce: "N",
        verifier: "V".repeat(43),
      }),
    );
    expect(url.host).toBe("login.microsoftonline.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(oidc.codeChallenge("V".repeat(43)));
    expect(url.searchParams.get("state")).toBe("S");
    expect(url.searchParams.get("nonce")).toBe("N");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
  });

  it("only lists providers that have both an id and a secret", () => {
    expect(
      oidc.configuredProviders({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", MICROSOFT_CLIENT_ID: "c" }),
    ).toEqual(["google"]);
  });

  it("seals the flow in a signed, expiring cookie that cannot be altered", () => {
    const flow = { provider: "google", state: "s", nonce: "n", verifier: "v", intent: "signin" };
    const now = Date.UTC(2026, 10, 16);
    const sealed = oidc.sealFlow(flow, SECRET, now);
    expect(oidc.openFlow(sealed, SECRET, now)).toMatchObject(flow);
    expect(oidc.openFlow(sealed, SECRET, now + 11 * 60 * 1000)).toBeNull();
    expect(oidc.openFlow(sealed, `${SECRET}-other`, now)).toBeNull();
    const [body, sig] = sealed.split(".");
    const edited = Buffer.from(JSON.stringify({ ...flow, intent: "signup", exp: 9e9 })).toString("base64url");
    expect(oidc.openFlow(`${edited}.${sig}`, SECRET, now)).toBeNull();
    expect(body).toBeTruthy();
  });
});

describe("who a sign-in is", () => {
  let database;
  const claims = (over = {}) => ({
    provider: "microsoft",
    subject: `${TID}.u1`,
    email: "head@moi.example",
    emailVerified: false,
    name: "Head Teacher",
    tenant: TID,
    ...over,
  });
  const signUp = { intent: "signup", account_type: "enterprise", organisation_name: "Moi Primary" };

  beforeAll(async () => {
    database = await createTestDatabase();
    holder.pool = database.pool;
    vi.stubEnv("DIRA_SESSION_SECRET", SECRET);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await database?.close();
  });

  it("signs a school up with Microsoft: an admin with no PIN, and the school's tenant recorded", async () => {
    const result = await resolveSsoSignIn(claims(), signUp);
    expect(result).toMatchObject({ created: true, next: "/welcome" });
    expect(result.teacher).toMatchObject({ role: "admin", workspace_kind: "school" });
    const school = await database.pool.query(
      "SELECT school_name, sso_provider, sso_tenant FROM schools WHERE school_id = $1",
      [result.teacher.school_id],
    );
    expect(school.rows[0]).toEqual({ school_name: "Moi Primary", sso_provider: "microsoft", sso_tenant: TID });
    const teacher = await database.pool.query("SELECT pin_hash FROM teachers WHERE teacher_id = $1", [
      result.teacher.teacher_id,
    ]);
    expect(teacher.rows[0].pin_hash).toBeNull();
  });

  it("signs the same person in again without creating anything", async () => {
    const before = await database.pool.query("SELECT COUNT(*)::int AS n FROM schools");
    const again = await resolveSsoSignIn(claims(), { intent: "signin" });
    expect(again.created).toBe(false);
    expect((await database.pool.query("SELECT COUNT(*)::int AS n FROM schools")).rows[0].n).toBe(before.rows[0].n);
  });

  it("links a colleague from the same Microsoft tenant to the staff list by email, and turns their PIN off", async () => {
    const admin = await resolveSsoSignIn(claims(), { intent: "signin" });
    await database.pool.query(
      `INSERT INTO teachers (teacher_id, school_id, display_name, email, pin_hash)
       VALUES ('T-STAFF', $1, 'Grace W', 'grace@moi.example', $2)`,
      [admin.teacher.school_id, (await import("../lib/auth/pin.ts")).hashPin("482913")],
    );
    expect((await signInTeacher("grace@moi.example", "482913")).teacher.teacher_id).toBe("T-STAFF");

    const linked = await resolveSsoSignIn(
      claims({ subject: `${TID}.u2`, email: "grace@moi.example", name: "Grace" }),
      { intent: "signin" },
    );
    expect(linked.teacher.teacher_id).toBe("T-STAFF");
    await expect(signInTeacher("grace@moi.example", "482913")).rejects.toMatchObject({
      code: "invalid_credentials",
    });
  });

  it("does NOT link a Microsoft sign-in from another tenant that claims the same email", async () => {
    await database.pool.query(
      "INSERT INTO teachers (teacher_id, school_id, display_name, email) SELECT 'T-VIC', school_id, 'Victim', 'victim@moi.example' FROM teachers WHERE teacher_id = 'T-STAFF'",
    );
    const attacker = claims({
      subject: "99999999-0000-0000-0000-000000000000.evil",
      email: "victim@moi.example",
      tenant: "99999999-0000-0000-0000-000000000000",
    });
    await expect(resolveSsoSignIn(attacker, { intent: "signin" })).rejects.toMatchObject({ code: "cannot_link" });
    await expect(resolveSsoSignIn({ ...attacker, tenant: null }, signUp)).rejects.toMatchObject({
      code: "cannot_link",
    });
  });

  it("links Google only when the email is verified, and then PIN sign-in stops working", async () => {
    const owner = await createAccount({
      account_type: "individual",
      full_name: "Pat Ode",
      email: "pat@gmail.example",
      pin: "482913",
    });
    const google = (over) => ({
      provider: "google",
      subject: "g-pat",
      email: "pat@gmail.example",
      emailVerified: true,
      name: "Pat",
      tenant: null,
      ...over,
    });
    await expect(
      resolveSsoSignIn(google({ emailVerified: false }), { intent: "signin" }),
    ).rejects.toMatchObject({ code: "cannot_link" });

    const result = await resolveSsoSignIn(google(), { intent: "signin" });
    expect(result.teacher.teacher_id).toBe(owner.teacher.teacher_id);
    await expect(signInTeacher("pat@gmail.example", "482913")).rejects.toMatchObject({
      code: "invalid_credentials",
    });
  });

  it("says so when there is no account and the person did not choose to sign up", async () => {
    await expect(
      resolveSsoSignIn(claims({ subject: "x", email: "new@nowhere.example" }), { intent: "signin" }),
    ).rejects.toMatchObject({ code: "no_account" });
  });

  it("needs an email, and respects the production sign-up gate", async () => {
    await expect(resolveSsoSignIn(claims({ subject: "y", email: null }), signUp)).rejects.toMatchObject({
      code: "no_email",
    });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DIRA_SIGN_UP_ENABLED", "");
    await expect(
      resolveSsoSignIn(claims({ subject: "z", email: "late@nowhere.example" }), signUp),
    ).rejects.toMatchObject({ code: "sign_up_closed" });
    vi.stubEnv("NODE_ENV", "test");
  });
});
