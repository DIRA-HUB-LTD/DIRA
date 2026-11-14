import { beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => []);
vi.mock("@/lib/agent/logger", () => ({
  logAgentEvent: vi.fn(async (event) => {
    logged.push(event);
    return true;
  }),
}));
vi.mock("@/lib/models", () => ({ createAgentCompletion: vi.fn() }));

const { PROFILE_AGENT_LIMITS, runProfileUpdateAgent } = await import(
  "../lib/agent/profile-update-agent.ts"
);

const CONTEXT = { teacher_id: "T_CUR", school_id: "SCH1" };
const schema = (props) => ({
  type: "object",
  properties: Object.fromEntries(props.map((name) => [name, { type: "string" }])),
  required: props,
});

/** A fake DIRA MCP session whose readiness changes as actions succeed. */
function fakeSession({ readinessSequence, failures = {} }) {
  const calls = [];
  let readinessIndex = 0;
  return {
    calls,
    async listTools() {
      return [
        { name: "check_evidence_readiness", inputSchema: schema(["learner_id"]) },
        { name: "suggest_test", inputSchema: schema(["learner_id", "submission_id"]) },
        { name: "assess_test_outcome", inputSchema: schema(["learner_id", "test_id"]) },
        { name: "draft_signed_summary", inputSchema: schema(["learner_id"]) },
        { name: "get_learner_observations", inputSchema: schema(["learner_id"]) },
        { name: "log_observation", inputSchema: schema(["learner_id", "content"]) },
      ];
    },
    async callTool(name, args) {
      calls.push({ name, args });
      if (failures[name]) {
        if (failures[name] === "throw") throw new Error("boom");
        return { isError: true, structuredContent: { error: failures[name] }, content: [] };
      }
      if (name === "check_evidence_readiness") {
        const value = readinessSequence[Math.min(readinessIndex, readinessSequence.length - 1)];
        readinessIndex += 1;
        return { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] };
      }
      if (name === "assess_test_outcome") {
        const value = { status: "assessed", assessment: { test_id: args.test_id, classification: "SUPPORTS" } };
        return { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] };
      }
      if (name === "draft_signed_summary") {
        const value = { ok: true, status: "drafted", note_id: "n1" };
        return { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] };
      }
      if (name === "suggest_test") {
        const value = { ok: true, status: "proposed", test_id: "TEST-NEW" };
        return { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] };
      }
      return { structuredContent: {}, content: [{ type: "text", text: "{}" }] };
    },
    close: vi.fn(async () => {}),
  };
}

let callCounter = 0;
const toolCall = (name, args = {}) => ({
  id: `call-${(callCounter += 1)}`,
  name,
  arguments: JSON.stringify(args),
});
const turn = (...toolCalls) => ({ content: null, toolCalls, usage: null });
const finish = (content) => ({ content, toolCalls: [], usage: null });

function scriptedModel(turns) {
  const seen = [];
  const complete = vi.fn(async (messages, tools) => {
    seen.push({ messages: structuredClone(messages), tools });
    return turns.shift() ?? finish("Done.");
  });
  return { complete, seen };
}

const READY_TO_ASSESS = {
  available_actions: ["assess_test_outcome"],
  tests_needing_assessment: ["TEST-DONE"],
};
const READY_TO_DRAFT = { available_actions: ["draft_signed_summary"], tests_needing_assessment: [] };
const NOTHING = { available_actions: ["wait_for_more_evidence"], tests_needing_assessment: [] };

beforeEach(() => {
  logged.length = 0;
});

describe("profile-update agent", () => {
  it("plans a multi-step run: check, act, re-check, act, then summarise", async () => {
    const session = fakeSession({ readinessSequence: [READY_TO_ASSESS, READY_TO_DRAFT, NOTHING] });
    const { complete } = scriptedModel([
      turn(toolCall("check_evidence_readiness")),
      turn(toolCall("assess_test_outcome", { test_id: "TEST-DONE" })),
      turn(toolCall("check_evidence_readiness")),
      turn(toolCall("draft_signed_summary")),
      finish("I assessed the completed test and drafted a summary for you to sign for you to review."),
    ]);
    const result = await runProfileUpdateAgent("L1", CONTEXT, { deps: { session, complete } });
    expect(result.status).toBe("completed");
    expect(result.actions.map((action) => [action.tool, action.status])).toEqual([
      ["check_evidence_readiness", "success"],
      ["assess_test_outcome", "success"],
      ["check_evidence_readiness", "success"],
      ["draft_signed_summary", "success"],
    ]);
    expect(result.summary).toMatch(/drafted a summary for you to sign/);
    expect(session.close).toHaveBeenCalled();
    expect(logged.at(-1)).toMatchObject({ event_type: "run_finished", status: "success" });
  });

  it("blocks an action before readiness is checked, and the model recovers", async () => {
    const session = fakeSession({ readinessSequence: [READY_TO_DRAFT, NOTHING] });
    const { complete, seen } = scriptedModel([
      turn(toolCall("draft_signed_summary")),
      turn(toolCall("check_evidence_readiness")),
      turn(toolCall("draft_signed_summary")),
      finish("Drafted after checking."),
    ]);
    const result = await runProfileUpdateAgent("L1", CONTEXT, { deps: { session, complete } });
    expect(result.actions[0]).toMatchObject({ tool: "draft_signed_summary", status: "blocked" });
    expect(seen[1].messages.at(-1).content).toMatch(/^BLOCKED: Call check_evidence_readiness first/);
    expect(result.actions.at(-1)).toMatchObject({ tool: "draft_signed_summary", status: "success" });
    expect(result.status).toBe("partial");
    expect(logged.some((event) => event.event_type === "tool_blocked")).toBe(true);
  });

  it("requires a fresh check after each action (the evidence changed)", async () => {
    const session = fakeSession({ readinessSequence: [READY_TO_ASSESS] });
    const { complete } = scriptedModel([
      turn(toolCall("check_evidence_readiness")),
      turn(toolCall("assess_test_outcome", { test_id: "TEST-DONE" }), toolCall("draft_signed_summary")),
      finish("Stopped."),
    ]);
    const result = await runProfileUpdateAgent("L1", CONTEXT, { deps: { session, complete } });
    expect(result.actions[2]).toMatchObject({ tool: "draft_signed_summary", status: "blocked" });
    expect(session.calls.map((call) => call.name)).not.toContain("draft_signed_summary");
  });

  it("refuses actions the evidence does not allow, and unknown tests", async () => {
    const session = fakeSession({ readinessSequence: [READY_TO_ASSESS] });
    const { complete } = scriptedModel([
      turn(toolCall("check_evidence_readiness")),
      turn(
        toolCall("draft_signed_summary"),
        toolCall("suggest_test"),
        toolCall("assess_test_outcome", { test_id: "TEST-INVENTED" }),
      ),
      finish("Nothing allowed."),
    ]);
    const result = await runProfileUpdateAgent("L1", CONTEXT, { deps: { session, complete } });
    expect(result.actions.slice(1).every((action) => action.status === "blocked")).toBe(true);
    expect(result.actions[3].detail).toMatch(/TEST-INVENTED/);
    expect(session.calls).toHaveLength(1);
  });

  it("cannot act on another learner or set the submission id", async () => {
    const session = fakeSession({
      readinessSequence: [{ available_actions: ["suggest_test"], tests_needing_assessment: [] }],
    });
    const { complete, seen } = scriptedModel([
      turn(toolCall("check_evidence_readiness", { learner_id: "L999" })),
      turn(toolCall("suggest_test", { learner_id: "L999", submission_id: "mine" })),
      finish("Suggested a test."),
    ]);
    const result = await runProfileUpdateAgent("L1", CONTEXT, { deps: { session, complete } });
    expect(session.calls.every((call) => call.args.learner_id === "L1")).toBe(true);
    expect(session.calls[1].args.submission_id).toBe(`profile-${result.run_id}`);
    // The model never even sees those parameters.
    const offered = seen[0].tools.find((tool) => tool.name === "suggest_test");
    expect(Object.keys(offered.parameters.properties)).toEqual([]);
  });

  it("is never offered tools outside its allowlist, and blocks them if named", async () => {
    const session = fakeSession({ readinessSequence: [NOTHING] });
    const { complete, seen } = scriptedModel([
      turn(toolCall("log_observation", { content: "made up" }), toolCall("accept_suggested_test")),
      finish("Stopped."),
    ]);
    const result = await runProfileUpdateAgent("L1", CONTEXT, { deps: { session, complete } });
    expect(seen[0].tools.map((tool) => tool.name)).not.toContain("log_observation");
    expect(result.actions.every((action) => action.status === "blocked")).toBe(true);
    expect(result.status).toBe("failed");
    expect(session.calls).toHaveLength(0);
  });

  it("recovers from a failing tool and reports a partial run", async () => {
    const session = fakeSession({
      readinessSequence: [READY_TO_ASSESS, NOTHING],
      failures: { assess_test_outcome: "invalid_model_output" },
    });
    const { complete, seen } = scriptedModel([
      turn(toolCall("check_evidence_readiness")),
      turn(toolCall("assess_test_outcome", { test_id: "TEST-DONE" })),
      finish("The assessment failed; please try again later."),
    ]);
    const result = await runProfileUpdateAgent("L1", CONTEXT, { deps: { session, complete } });
    expect(result.actions[1]).toMatchObject({ status: "error", detail: "invalid_model_output" });
    expect(seen[2].messages.at(-1).content).toMatch(/invalid_model_output/);
    expect(result.status).toBe("partial");
  });

  it("survives a tool that throws", async () => {
    const session = fakeSession({ readinessSequence: [READY_TO_ASSESS], failures: { assess_test_outcome: "throw" } });
    const { complete } = scriptedModel([
      turn(toolCall("check_evidence_readiness")),
      turn(toolCall("assess_test_outcome", { test_id: "TEST-DONE" })),
      finish("Could not assess."),
    ]);
    const result = await runProfileUpdateAgent("L1", CONTEXT, { deps: { session, complete } });
    expect(result.actions[1]).toMatchObject({ status: "error", detail: "Error" });
    expect(result.status).toBe("partial");
  });

  it("stops at the turn limit and says so", async () => {
    const session = fakeSession({ readinessSequence: [NOTHING] });
    const { complete } = scriptedModel(
      Array.from({ length: 20 }, () => turn(toolCall("check_evidence_readiness"))),
    );
    const result = await runProfileUpdateAgent("L1", CONTEXT, { deps: { session, complete } });
    expect(complete).toHaveBeenCalledTimes(PROFILE_AGENT_LIMITS.maxModelTurns);
    expect(result.status).toBe("partial");
    expect(result.summary).toMatch(/step limit/);
  });

  it("logs the failure and closes the session if the model errors", async () => {
    const session = fakeSession({ readinessSequence: [NOTHING] });
    const complete = vi.fn(async () => {
      throw new Error("model down");
    });
    await expect(runProfileUpdateAgent("L1", CONTEXT, { deps: { session, complete } })).rejects.toThrow(
      "model down",
    );
    expect(session.close).toHaveBeenCalled();
    expect(logged.at(-1)).toMatchObject({ event_type: "run_finished", status: "error" });
  });
});
