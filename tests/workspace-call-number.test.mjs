import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, seedTwoYearSchool } from "./helpers/pglite-db.mjs";

const holder = vi.hoisted(() => ({ pool: null }));
const provider = vi.hoisted(() => ({
  initiateAfricaTalkingCall: vi.fn(async () => ({ httpStatus: 201, sessionId: "ATVid_num_1" })),
}));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("../lib/external-mcp/voice.ts", () => ({
  AfricaTalkingCallError: class AfricaTalkingCallError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  },
  initiateAfricaTalkingCall: provider.initiateAfricaTalkingCall,
}));

const { normalisePhone } = await import("../lib/utils/phone.ts");
const { reserveWorkspaceCall, WorkspaceCallLimitError } = await import(
  "../lib/services/workspace-demo-call.ts"
);
const { queueDemoWorkspaceCall } = await import("../lib/services/follow-up-queue.ts");
const { dispatchOneDueFollowUp } = await import("../lib/services/follow-up-dispatch.ts");

describe("checking a typed phone number", () => {
  it("accepts the ways Kenyans write a number", () => {
    for (const typed of ["0712 345 678", "712345678", "+254 712 345 678", "254712345678", "(0712) 345-678", "0112345678"]) {
      const result = normalisePhone("254", typed);
      expect(result.ok, typed).toBe(true);
    }
    expect(normalisePhone("254", "0712 345 678")).toEqual({ ok: true, e164: "+254712345678" });
    expect(normalisePhone("254", "0112345678")).toEqual({ ok: true, e164: "+254112345678" });
  });

  it("explains what is wrong with a bad Kenyan number", () => {
    expect(normalisePhone("254", "0812345678")).toMatchObject({ ok: false, message: expect.stringMatching(/starts with 7 or 1/) });
    expect(normalisePhone("254", "07123")).toMatchObject({ ok: false });
    expect(normalisePhone("254", "0712abc678")).toMatchObject({ ok: false, message: expect.stringMatching(/only contain digits/) });
    expect(normalisePhone("254", "")).toMatchObject({ ok: false, message: expect.stringMatching(/Enter/) });
    expect(normalisePhone("254", "+256 772 123 456")).toMatchObject({ ok: false, message: expect.stringMatching(/different country code/) });
  });

  it("accepts other countries within international length limits", () => {
    expect(normalisePhone("256", "0772 123 456")).toEqual({ ok: true, e164: "+256772123456" });
    expect(normalisePhone("44", "07700 900123")).toEqual({ ok: true, e164: "+447700900123" });
    expect(normalisePhone("1", "(415) 555-0123")).toEqual({ ok: true, e164: "+14155550123" });
    expect(normalisePhone("", "0712345678")).toMatchObject({ ok: false, message: expect.stringMatching(/country code/) });
    expect(normalisePhone("44", "1234567890123456")).toMatchObject({ ok: false, message: expect.stringMatching(/too short or too long/) });
  });
});

describe("calling a typed number from the demo workspace", () => {
  let database;
  const sql = (text, params) => database.pool.query(text, params);
  const context = { teacher_id: "T_CUR", school_id: "SCH1" };

  beforeAll(async () => {
    database = await createTestDatabase();
    holder.pool = database.pool;
    await seedTwoYearSchool(database.pool);
    vi.stubEnv("AFRICASTALKING_USERNAME_VOICE", "app-user");
    vi.stubEnv("AFRICASTALKING_API_KEY_VOICE", "key");
    vi.stubEnv("AFRICASTALKING_VOICE_FROM", "+254711000000");
    vi.stubEnv("DIRA_SESSION_SECRET", "a-test-session-secret-that-is-long-enough");
    await sql("UPDATE teachers SET phone_e164 = '+254700000001', voice_consent_at = NOW() WHERE teacher_id = 'T_CUR'");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await database?.close();
  });
  beforeEach(async () => {
    provider.initiateAfricaTalkingCall.mockClear();
    await sql("DELETE FROM teacher_calls");
    await sql("DELETE FROM teacher_follow_up_jobs");
  });

  it("rings the typed number, not the teacher's stored one, in the demo workspace", async () => {
    await sql("UPDATE schools SET is_demo = TRUE WHERE school_id = 'SCH1'");
    const queued = await queueDemoWorkspaceCall(context);
    const result = await dispatchOneDueFollowUp(new Date(), context, queued.follow_up_job_id, {
      demoWorkspaceDestination: "+254722333444",
    });
    expect(result?.status).toBe("provider_accepted");
    expect(provider.initiateAfricaTalkingCall.mock.calls[0][0].destination).toBe("+254722333444");
  });

  it("can never redirect a call in a real school", async () => {
    await sql("UPDATE schools SET is_demo = FALSE WHERE school_id = 'SCH1'");
    const job = await sql(
      `INSERT INTO teacher_follow_up_jobs (calendar_entry_id, school_id, class_id, teacher_id,
         scheduled_date, scheduled_end_at, idempotency_key, is_manual_demo)
       VALUES (NULL, 'SCH1', 'C_CUR', 'T_CUR', CURRENT_DATE, NOW(), $1, TRUE) RETURNING follow_up_job_id`,
      [`forced-${randomUUID()}`],
    );
    const result = await dispatchOneDueFollowUp(new Date(), context, job.rows[0].follow_up_job_id, {
      demoWorkspaceDestination: "+254722333444",
    });
    expect(result).toBeNull();
    expect(provider.initiateAfricaTalkingCall).not.toHaveBeenCalled();
  });

  it("allows three calls per number a day, and stores only a hash of it", async () => {
    for (let i = 0; i < 3; i += 1) await reserveWorkspaceCall("+254799888777");
    await expect(reserveWorkspaceCall("+254799888777")).rejects.toBeInstanceOf(WorkspaceCallLimitError);
    await expect(reserveWorkspaceCall("+254799888778")).resolves.toBeTruthy();
    const stored = await sql(
      "SELECT metadata::text AS m FROM agent_activity_logs WHERE event_type = 'workspace_demo_call_requested'",
    );
    expect(stored.rows.every((row) => !row.m.includes("799888777"))).toBe(true);
  });
});
