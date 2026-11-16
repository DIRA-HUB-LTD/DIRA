import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "./helpers/pglite-db.mjs";

const holder = vi.hoisted(() => ({ pool: null, auth: null, connect: null }));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: (...args) => holder.auth(...args),
}));
vi.mock("@/lib/agent/mcp-client", () => ({
  connectMcpServer: (...args) => holder.connect(...args),
}));

const { open, seal, connectionSecretIsUsable } = await import("../lib/auth/secret-box.ts");
const {
  calendarConnectionIsConfigured,
  checkConnection,
  completeConnection,
  disconnect,
  getConnectionStatus,
  readCount,
  startConnection,
} = await import("../lib/services/calendar-connection.ts");
const { createAccount } = await import("../lib/services/sign-up.ts");

const SECRET = "a-connection-secret-that-is-long-enough!!";
const REDIRECT = "https://dira.example/api/calendar/callback";
const VERIFIER = "pkce-verifier-that-must-never-be-stored-in-clear";

describe("secret box", () => {
  it("round-trips, and refuses tampering, a wrong key and short keys", () => {
    const sealed = seal("hello tokens", SECRET);
    expect(sealed).not.toContain("hello");
    expect(open(sealed, SECRET)).toBe("hello tokens");
    expect(open(sealed, `${SECRET}-other`)).toBeNull();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(open(parts.join("."), SECRET)).toBeNull();
    expect(open(null, SECRET)).toBeNull();
    expect(() => seal("x", "short")).toThrow();
    expect(connectionSecretIsUsable("short")).toBe(false);
    expect(seal("same", SECRET)).not.toBe(seal("same", SECRET)); // fresh IV each time
  });
});

describe("reading a count from a tool result", () => {
  it("accepts a number, {count}, or a sentence, and gives up safely otherwise", () => {
    const text = (value) => ({ content: [{ type: "text", text: value }] });
    expect(readCount(text("7"))).toBe(7);
    expect(readCount(text('{"count":3}'))).toBe(3);
    expect(readCount(text("You have 4 events"))).toBe(4);
    expect(readCount(text("none"))).toBeNull();
    expect(readCount({})).toBeNull();
  });
});

describe("calendar connection", () => {
  let database;
  let teacher;
  let other;
  let issuedState;

  /** Plays Keeper's side of the OAuth handshake. */
  function fakeAuth(provider, options) {
    if (options.authorizationCode) {
      if (options.authorizationCode !== "good-code") return Promise.reject(new Error("bad code"));
      if (provider.codeVerifier() !== VERIFIER) return Promise.reject(new Error("wrong verifier"));
      return Promise.resolve(provider.saveTokens({ access_token: "ACCESS-TOKEN-SECRET", token_type: "Bearer" })).then(
        () => "AUTHORIZED",
      );
    }
    issuedState = provider.state();
    return Promise.resolve(provider.saveClientInformation({ client_id: "client-abc" }))
      .then(() => provider.saveCodeVerifier(VERIFIER))
      .then(() => {
        provider.redirectToAuthorization(new URL(`https://keeper.example/authorize?state=${issuedState}`));
        return "REDIRECT";
      });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    holder.pool = database.pool;
    vi.stubEnv("DIRA_SESSION_SECRET", "a-test-session-secret-that-is-long-enough");
    vi.stubEnv("DIRA_CONNECTION_SECRET", SECRET);
    const make = async (email) =>
      (await createAccount({ account_type: "individual", full_name: "Test Teacher", email, pin: "482913" }))
        .teacher;
    teacher = await make("a@example.com");
    other = await make("b@example.com");
  });

  beforeEach(() => {
    holder.auth = vi.fn(fakeAuth);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await database?.close();
  });

  it("reports no connection to begin with", async () => {
    expect(await getConnectionStatus(teacher)).toMatchObject({ configured: true, status: "none" });
  });

  it("starts by sending the teacher to Keeper, storing secrets encrypted and the state only as a hash", async () => {
    const started = await startConnection(teacher, REDIRECT);
    expect(started.status).toBe("redirect");
    expect(started.authorization_url).toContain("https://keeper.example/authorize");

    const row = (
      await database.pool.query("SELECT * FROM calendar_connections WHERE teacher_id = $1", [
        teacher.teacher_id,
      ])
    ).rows[0];
    expect(row.status).toBe("pending");
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(VERIFIER);
    expect(stored).not.toContain(issuedState);
    expect(open(row.secrets_encrypted, SECRET)).toContain(VERIFIER);
  });

  it("refuses a callback with the wrong state, and another teacher's callback", async () => {
    await expect(completeConnection(teacher, REDIRECT, "good-code", "forged")).rejects.toMatchObject({
      code: "bad_state",
    });
    await expect(completeConnection(other, REDIRECT, "good-code", issuedState)).rejects.toMatchObject({
      code: "bad_state",
    });
    expect((await getConnectionStatus(teacher)).status).toBe("pending");
  });

  it("refuses an expired state", async () => {
    await database.pool.query(
      "UPDATE calendar_connections SET oauth_state_expires_at = NOW() - interval '1 minute' WHERE teacher_id = $1",
      [teacher.teacher_id],
    );
    await expect(completeConnection(teacher, REDIRECT, "good-code", issuedState)).rejects.toMatchObject({
      code: "bad_state",
    });
    await startConnection(teacher, REDIRECT); // start again for the next test
  });

  it("completes with the right state, keeps tokens encrypted, marks setup done, and works only once", async () => {
    await completeConnection(teacher, REDIRECT, "good-code", issuedState);
    const status = await getConnectionStatus(teacher);
    expect(status.status).toBe("connected");
    expect(status.connected_at).not.toBeNull();

    const row = (
      await database.pool.query("SELECT * FROM calendar_connections WHERE teacher_id = $1", [
        teacher.teacher_id,
      ])
    ).rows[0];
    expect(JSON.stringify(row)).not.toContain("ACCESS-TOKEN-SECRET");
    expect(open(row.secrets_encrypted, SECRET)).toContain("ACCESS-TOKEN-SECRET");
    const school = await database.pool.query("SELECT setup_completed_at FROM schools WHERE school_id = $1", [
      teacher.school_id,
    ]);
    expect(school.rows[0].setup_completed_at).not.toBeNull();

    await expect(completeConnection(teacher, REDIRECT, "good-code", issuedState)).rejects.toMatchObject({
      code: "bad_state",
    });
  });

  it("proves the link with one read-only call and returns only a count", async () => {
    const session = {
      listTools: async () => [
        {
          name: "get_event_count",
          annotations: { readOnlyHint: true },
          inputSchema: { type: "object", properties: { from: {}, to: {} } },
        },
      ],
      callTool: vi.fn(async () => ({ content: [{ type: "text", text: '{"count":5}' }] })),
      close: vi.fn(async () => {}),
    };
    holder.connect = vi.fn(async () => session);

    expect(await checkConnection(teacher, REDIRECT)).toEqual({ tools_discovered: 1, events_next_24h: 5 });
    expect(session.callTool).toHaveBeenCalledWith("get_event_count", expect.any(Object));
    expect(session.close).toHaveBeenCalled();
    expect((await getConnectionStatus(teacher)).last_checked_at).not.toBeNull();
  });

  it("cannot check a calendar that is not connected", async () => {
    await expect(checkConnection(other, REDIRECT)).rejects.toMatchObject({ code: "not_connected" });
  });

  it("disconnecting deletes the stored secrets", async () => {
    await disconnect(teacher);
    const row = (
      await database.pool.query("SELECT status, secrets_encrypted FROM calendar_connections WHERE teacher_id = $1", [
        teacher.teacher_id,
      ])
    ).rows[0];
    expect(row).toEqual({ status: "revoked", secrets_encrypted: null });
  });

  it("is switched off without a connection secret", async () => {
    vi.stubEnv("DIRA_CONNECTION_SECRET", "");
    expect(calendarConnectionIsConfigured()).toBe(false);
    await expect(startConnection(other, REDIRECT)).rejects.toMatchObject({ code: "not_configured" });
    vi.stubEnv("DIRA_CONNECTION_SECRET", SECRET);
  });
});
