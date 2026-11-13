import { describe, expect, it } from "vitest";
import { summarizeRun } from "../lib/agent/run-summary.ts";

const RUN = "11111111-1111-4111-8111-111111111111";
let second = 0;
const event = (values) => ({
  run_id: RUN,
  timestamp: new Date(Date.UTC(2026, 10, 13, 9, 0, (second += 1))).toISOString(),
  workflow: "profile_update_agent",
  agent_action: values.event_type,
  tool_name: "profile_update_agent",
  status: "success",
  duration_ms: null,
  error: null,
  input_tokens: null,
  output_tokens: null,
  cost_usd: null,
  cost_status: null,
  metadata: null,
  ...values,
});

describe("run summary", () => {
  it("builds a chronological timeline with totals and cost per run", () => {
    const events = [
      event({ event_type: "run_finished", metadata: { result_status: "partial" } }),
      event({ event_type: "run_started", status: "started" }),
      event({ event_type: "model_call", model: "glm-5.3-flash", input_tokens: "1200", output_tokens: 300, cost_usd: "0.000315", cost_status: "calculated" }),
      event({ event_type: "tool_proposed", tool_name: "draft_pathway_note" }),
      event({ event_type: "tool_blocked", tool_name: "draft_pathway_note", metadata: { reason: "Call check_evidence_readiness first" } }),
      event({ event_type: "tool_executed", tool_name: "check_evidence_readiness", status: "started" }),
      event({ event_type: "tool_executed", tool_name: "check_evidence_readiness" }),
      event({ event_type: "model_call", model: "glm-5.3-flash", input_tokens: 800, output_tokens: 100, cost_usd: 0.00017, cost_status: "calculated" }),
    ];
    // Put run_finished last in time, as in reality.
    events[0].timestamp = new Date(Date.UTC(2026, 10, 13, 9, 1, 0)).toISOString();
    const summary = summarizeRun(events);
    expect(summary).toMatchObject({
      run_id: RUN,
      outcome: "partial",
      model_calls: 2,
      tool_calls: 1,
      blocked_calls: 1,
      input_tokens: 2000,
      output_tokens: 400,
      cost_usd: 0.000485,
      cost_status: "calculated",
      models: ["glm-5.3-flash"],
    });
    expect(summary.steps.map((step) => step.kind)).toEqual(["run", "model", "blocked", "tool", "model", "run"]);
    expect(summary.steps[2].detail).toMatch(/check_evidence_readiness/);
  });

  it("is honest when some model calls have no price", () => {
    const summary = summarizeRun([
      event({ event_type: "model_call", cost_usd: 0.001, cost_status: "calculated" }),
      event({ event_type: "model_call", status: "error", cost_status: "unknown", error: "GlmRequestError" }),
    ]);
    expect(summary.cost_status).toBe("partial");
    expect(summary.errors).toBe(1);
  });

  it("marks self-hosted runs as having no per-token cost", () => {
    const summary = summarizeRun([event({ event_type: "model_call", cost_status: "not_applicable" })]);
    expect(summary.cost_status).toBe("not_applicable");
  });

  it("reports a run with no finish event as still running", () => {
    expect(summarizeRun([event({ event_type: "run_started", status: "started" })]).outcome).toBe("running");
    expect(summarizeRun([])).toBeNull();
  });
});
