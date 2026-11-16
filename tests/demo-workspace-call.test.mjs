import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, seedTwoYearSchool } from "./helpers/pglite-db.mjs";

const holder = vi.hoisted(() => ({ pool: null }));
const provider = vi.hoisted(() => ({
  initiateAfricaTalkingCall: vi.fn(async () => ({ httpStatus: 201, sessionId: "ATVid_demo_1" })),
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

const { queueDemoWorkspaceCall, DemoCallError } = await import("../lib/services/follow-up-queue.ts");
const { dispatchOneDueFollowUp } = await import("../lib/services/follow-up-dispatch.ts");
const { confirmDraft, listDrafts, listOpenTests } = await import("../lib/services/call-observations.ts");

const NUMBER = "+254700000001";
const context = { teacher_id: "T_CUR", school_id: "SCH1" };

describe("the demo workspace's Call me now", () => {
  let database;
  const sql = (text, params) => database.pool.query(text, params);

  beforeAll(async () => {
    database = await createTestDatabase();
    holder.pool = database.pool;
    await seedTwoYearSchool(database.pool);
    vi.stubEnv("AFRICASTALKING_USERNAME_VOICE", "sandbox-user");
    vi.stubEnv("AFRICASTALKING_API_KEY_VOICE", "key");
    vi.stubEnv("AFRICASTALKING_VOICE_FROM", "+254711000000");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await database?.close();
  });
  beforeEach(async () => {
    provider.initiateAfricaTalkingCall.mockClear();
    await sql("DELETE FROM teacher_calls");
    await sql("DELETE FROM teacher_follow_up_jobs");
    await sql("UPDATE schools SET is_demo = FALSE WHERE school_id = 'SCH1'");
    await sql("UPDATE teachers SET phone_e164 = NULL, voice_consent_at = NULL");
  });

  const makeDemo = () => sql("UPDATE schools SET is_demo = TRUE WHERE school_id = 'SCH1'");
  const giveContact = () =>
    sql("UPDATE teachers SET phone_e164 = $1, voice_consent_at = NOW() WHERE teacher_id = 'T_CUR'", [NUMBER]);

  it("is refused in a real school, even with a phone on record", async () => {
    await giveContact();
    await expect(queueDemoWorkspaceCall(context)).rejects.toMatchObject({ code: "not_demo" });
  });

  it("needs a phone number and consent on the teacher's record", async () => {
    await makeDemo();
    await expect(queueDemoWorkspaceCall(context)).rejects.toMatchObject({ code: "no_phone" });
  });

  it("queues one job and rings the teacher's stored phone in real mode", async () => {
    await makeDemo();
    await giveContact();
    const queued = await queueDemoWorkspaceCall(context);
    expect(queued.already_queued).toBe(false);

    const result = await dispatchOneDueFollowUp(new Date(), context, queued.follow_up_job_id);
    expect(result).toMatchObject({ status: "provider_accepted", is_demo: false });
    expect(provider.initiateAfricaTalkingCall).toHaveBeenCalledTimes(1);
    expect(provider.initiateAfricaTalkingCall.mock.calls[0][0]).toMatchObject({
      destination: NUMBER,
      mode: "real",
    });
  });

  it("will not ring again within the cooldown", async () => {
    await makeDemo();
    await giveContact();
    const first = await queueDemoWorkspaceCall(context);
    await dispatchOneDueFollowUp(new Date(), context, first.follow_up_job_id);
    await expect(queueDemoWorkspaceCall(context)).rejects.toMatchObject({ code: "too_soon" });
  });

  it("stops at the daily limit", async () => {
    await makeDemo();
    await giveContact();
    for (let i = 0; i < 20; i += 1) {
      await sql(
        `INSERT INTO teacher_follow_up_jobs
           (calendar_entry_id, school_id, class_id, teacher_id, scheduled_date, scheduled_end_at,
            idempotency_key, is_manual_demo, status, created_at)
         VALUES (NULL, 'SCH1', 'C_CUR', 'T_CUR', CURRENT_DATE, NOW(), $1, TRUE, 'provider_accepted',
                 NOW() - interval '1 hour')`,
        [`daily-${i}-${randomUUID()}`],
      );
    }
    await expect(queueDemoWorkspaceCall(context)).rejects.toMatchObject({ code: "daily_limit" });
  });

  it("a manual job in a real school can never be claimed", async () => {
    await giveContact(); // SCH1 is not a demo workspace
    const inserted = await sql(
      `INSERT INTO teacher_follow_up_jobs
         (calendar_entry_id, school_id, class_id, teacher_id, scheduled_date, scheduled_end_at,
          idempotency_key, is_manual_demo)
       VALUES (NULL, 'SCH1', 'C_CUR', 'T_CUR', CURRENT_DATE, NOW(), $1, TRUE)
       RETURNING follow_up_job_id`,
      [`forced-${randomUUID()}`],
    );
    const result = await dispatchOneDueFollowUp(new Date(), context, inserted.rows[0].follow_up_job_id);
    expect(result).toBeNull();
    expect(provider.initiateAfricaTalkingCall).not.toHaveBeenCalled();
  });

  it("can be switched off", async () => {
    await makeDemo();
    await giveContact();
    vi.stubEnv("DIRA_DEMO_WORKSPACE_CALLS", "false");
    await expect(queueDemoWorkspaceCall(context)).rejects.toBeInstanceOf(DemoCallError);
    vi.stubEnv("DIRA_DEMO_WORKSPACE_CALLS", "");
  });
});

describe("tying a call draft to the right learner and test", () => {
  let database;
  const sql = (text, params) => database.pool.query(text, params);
  let draftId;

  beforeAll(async () => {
    database = await createTestDatabase();
    holder.pool = database.pool;
    await seedTwoYearSchool(database.pool);
    await sql(
      `INSERT INTO activity_tests (test_id, learner_id, suggested_activity, activity_date,
         conducting_teacher_id, exploration_question, status, accepted_at)
       VALUES ('TEST_L1', 'L1', 'Pair explain', CURRENT_DATE, 'T_CUR', 'Does pair talk help?', 'ACCEPTED', NOW()),
              ('TEST_L2_SUGGESTED', 'L2', 'Other', CURRENT_DATE, 'T_CUR', NULL, 'SUGGESTED', NULL),
              ('TEST_OTHER_TEACHER', 'L3', 'Elsewhere', CURRENT_DATE, 'T_OTHER', NULL, 'ACCEPTED', NOW())`,
    );
    const call = await sql(
      `INSERT INTO teacher_calls (teacher_id, status, is_demo) VALUES ('T_CUR', 'completed', FALSE)
       RETURNING call_id`,
    );
    const recording = await sql(
      `INSERT INTO call_recordings (call_id, recording_url, status, transcript_text, processing_status)
       VALUES ($1, 'https://example.test/r.wav', 'transcribed', 'Amani explained a step.', 'done')
       RETURNING recording_id`,
      [call.rows[0].call_id],
    );
    const draft = await sql(
      `INSERT INTO observation_drafts (recording_id, call_id, teacher_id, school_id, segment_index,
         segment_text, observation_type, status)
       VALUES ($1, $2, 'T_CUR', 'SCH1', 0, 'Amani explained a step after a prompt.', 'participation', 'needs_learner')
       RETURNING draft_id`,
      [recording.rows[0].recording_id, call.rows[0].call_id],
    );
    draftId = draft.rows[0].draft_id;
  });
  afterAll(async () => {
    await database?.close();
  });

  it("lists this teacher's drafts (the Call Drafts page depends on it)", async () => {
    const drafts = await listDrafts(context);
    expect(drafts.map((draft) => draft.draft_id)).toEqual([draftId]);
    expect(await listDrafts({ teacher_id: "T_OTHER", school_id: "SCH1" })).toEqual([]);
  });

  it("lists only this teacher's accepted tests", async () => {
    const tests = await listOpenTests(context);
    expect(tests.map((test) => test.test_id)).toEqual(["TEST_L1"]);
    expect(tests[0].label).toBe("Does pair talk help?");
  });

  it("refuses a test that belongs to a different learner, and saves nothing", async () => {
    await expect(confirmDraft(draftId, "L2", context, "TEST_L1")).rejects.toThrow();
    const draft = await sql("SELECT status FROM observation_drafts WHERE draft_id = $1", [draftId]);
    expect(draft.rows[0].status).toBe("needs_learner");
    const test = await sql("SELECT status FROM activity_tests WHERE test_id = 'TEST_L1'");
    expect(test.rows[0].status).toBe("ACCEPTED");
  });

  it("confirming with the right learner and test saves a test result and completes the test", async () => {
    const { observation_id } = await confirmDraft(draftId, "L1", context, "TEST_L1");
    const test = await sql(
      "SELECT status, outcome_observation_id FROM activity_tests WHERE test_id = 'TEST_L1'",
    );
    expect(test.rows[0]).toEqual({ status: "COMPLETED", outcome_observation_id: observation_id });
    const observation = await sql(
      "SELECT observation_type, linked_test_id, capture_method FROM observations WHERE observation_id = $1",
      [observation_id],
    );
    expect(observation.rows[0]).toEqual({
      observation_type: "test_result",
      linked_test_id: "TEST_L1",
      capture_method: "basic_phone_callback",
    });
  });
});
