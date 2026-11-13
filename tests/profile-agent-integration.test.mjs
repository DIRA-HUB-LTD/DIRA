import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "./helpers/pglite-db.mjs";
import { seedLongViewLearner, validNoteReply } from "./helpers/long-view-fixture.mjs";

// End to end through the REAL in-process DIRA MCP server and a real (in-memory)
// Postgres. Only the model is scripted.
const holder = vi.hoisted(() => ({ pool: null, noteReplies: [] }));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));
vi.mock("@/lib/models", () => ({
  DIRA_AGENT_MODEL: "glm-5.3-flash",
  // Used by draft_pathway_note inside the MCP server.
  createAgentCompletion: vi.fn(async () => ({
    content: holder.noteReplies.shift() ?? null,
    toolCalls: [],
    usage: null,
  })),
}));

const { runProfileUpdateAgent } = await import("../lib/agent/profile-update-agent.ts");

let database;
let fixture;

beforeAll(async () => {
  database = await createTestDatabase();
  holder.pool = database.pool;
  fixture = await seedLongViewLearner(database.pool);
});

afterAll(async () => {
  await database?.close();
});

let id = 0;
const call = (name, args = {}) => ({ id: `c${(id += 1)}`, name, arguments: JSON.stringify(args) });

describe("profile-update agent end to end", () => {
  it("reads multi-year readiness from the database and drafts a cited note", async () => {
    holder.noteReplies = [validNoteReply(fixture.observationIds, fixture.testId)];
    const turns = [
      { content: null, toolCalls: [call("check_evidence_readiness")] },
      { content: null, toolCalls: [call("draft_pathway_note")] },
      { content: "Drafted a pathway note for your review.", toolCalls: [] },
    ];
    const seenToolResults = [];
    const complete = vi.fn(async (messages) => {
      const last = messages.at(-1);
      if (last.role === "tool") seenToolResults.push(last.content);
      return { ...turns.shift(), usage: null };
    });

    const result = await runProfileUpdateAgent(
      "L1",
      { teacher_id: "T_CUR", school_id: "SCH1" },
      { deps: { complete } },
    );

    expect(result.actions.map((action) => [action.tool, action.status])).toEqual([
      ["check_evidence_readiness", "success"],
      ["draft_pathway_note", "success"],
    ]);
    const readiness = JSON.parse(seenToolResults[0]);
    expect(readiness.academic_years).toEqual([fixture.years.lastYear, fixture.years.thisYear]);
    expect(readiness.available_actions).toContain("draft_pathway_note");

    const notes = await database.pool.query(
      "SELECT status, run_id::text AS run_id FROM pathway_notes WHERE learner_id = 'L1'",
    );
    expect(notes.rows).toEqual([{ status: "DRAFT", run_id: result.run_id }]);

    const events = await database.pool.query(
      "SELECT event_type, tool_name FROM agent_activity_logs WHERE run_id = $1",
      [result.run_id],
    );
    const types = events.rows.map((row) => row.event_type);
    // Every step of the run is in the persisted log under one run ID.
    expect(types).toEqual(
      // (model_call events come from lib/models.ts, which is scripted in this test.)
      expect.arrayContaining(["run_started", "tool_proposed", "tool_executed", "run_finished"]),
    );
    expect(events.rows.some((row) => row.tool_name === "draft_pathway_note")).toBe(true);
  });

  it("refuses a teacher who does not teach the learner, through the tool itself", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ content: null, toolCalls: [call("check_evidence_readiness")], usage: null })
      .mockResolvedValueOnce({ content: "I could not access this learner.", toolCalls: [], usage: null });
    const result = await runProfileUpdateAgent(
      "L1",
      { teacher_id: "T_OTHER", school_id: "SCH1" },
      { deps: { complete } },
    );
    expect(result.actions[0]).toMatchObject({ status: "error", detail: "learner_not_found" });
    expect(result.status).toBe("failed");
  });
});
