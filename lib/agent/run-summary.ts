// Turn one run's agent_activity_logs rows into a readable timeline with totals.
// Pure (no server imports) so it runs in the browser and in unit tests.

export interface RunEvent {
  run_id: string;
  timestamp: string;
  event_type: string;
  workflow: string | null;
  agent_action: string;
  tool_name: string;
  status: "started" | "success" | "error";
  duration_ms: number | null;
  error: string | null;
  model?: string | null;
  provider?: string | null;
  input_tokens: number | string | null;
  output_tokens: number | string | null;
  cost_usd: number | string | null;
  cost_status: "calculated" | "unknown" | "not_applicable" | null;
  metadata?: Record<string, unknown> | null;
}

export interface RunStep {
  at: string;
  kind: "run" | "model" | "tool" | "blocked" | "retrieval" | "other";
  label: string;
  status: "started" | "success" | "error";
  detail: string | null;
}

export interface RunSummary {
  run_id: string;
  workflows: string[];
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  outcome: "completed" | "partial" | "failed" | "running" | "unknown";
  model_calls: number;
  tool_calls: number;
  blocked_calls: number;
  errors: number;
  input_tokens: number;
  output_tokens: number;
  /** Sum over model calls with a calculated price. */
  cost_usd: number;
  /** calculated: every model call priced; partial: some unpriced; unknown: none priced; not_applicable: self-hosted. */
  cost_status: "calculated" | "partial" | "unknown" | "not_applicable" | "no_model_calls";
  models: string[];
  steps: RunStep[];
}

const toNumber = (value: number | string | null | undefined): number => {
  const parsed = typeof value === "string" ? Number(value) : value ?? 0;
  return Number.isFinite(parsed) ? (parsed as number) : 0;
};

function stepFor(event: RunEvent): RunStep | null {
  const base = { at: event.timestamp, status: event.status, detail: event.error };
  switch (event.event_type) {
    case "run_started":
      return { ...base, kind: "run", label: `Run started (${event.workflow ?? "agent"})` };
    case "run_finished": {
      const result = typeof event.metadata?.result_status === "string" ? event.metadata.result_status : null;
      return { ...base, kind: "run", label: `Run finished${result ? `: ${result}` : ""}` };
    }
    case "model_call":
      return {
        ...base,
        kind: "model",
        label: `Model call${event.model ? ` (${event.model})` : ""}`,
        detail:
          event.error ??
          (event.input_tokens !== null
            ? `${toNumber(event.input_tokens)} in / ${toNumber(event.output_tokens)} out tokens`
            : null),
      };
    case "tool_proposed":
      return null; // the executed/blocked event that follows says more
    case "tool_blocked":
      return {
        ...base,
        kind: "blocked",
        label: `Blocked: ${event.tool_name}`,
        detail: typeof event.metadata?.reason === "string" ? event.metadata.reason : event.error,
      };
    case "tool_executed":
      if (event.status === "started") return null;
      return { ...base, kind: "tool", label: `Tool: ${event.tool_name}` };
    case "fetch_request":
    case "fetch_connection":
    case "cache_hit":
    case "cache_miss":
      if (event.status === "started") return null;
      return {
        ...base,
        kind: "retrieval",
        label: `${event.event_type.replace(/_/g, " ")}${typeof event.metadata?.source_key === "string" ? ` (${event.metadata.source_key})` : ""}`,
      };
    default:
      if (event.status === "started") return null;
      return { ...base, kind: "other", label: `${event.agent_action} (${event.tool_name})` };
  }
}

export function summarizeRun(events: RunEvent[]): RunSummary | null {
  if (events.length === 0) return null;
  const ordered = [...events].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const modelCalls = ordered.filter((event) => event.event_type === "model_call");
  const finished = ordered.filter((event) => event.event_type === "run_finished").at(-1);
  const started = ordered.find((event) => event.event_type === "run_started");
  const priced = modelCalls.filter((event) => event.cost_status === "calculated");
  const selfHosted = modelCalls.filter((event) => event.cost_status === "not_applicable");

  let costStatus: RunSummary["cost_status"];
  if (modelCalls.length === 0) costStatus = "no_model_calls";
  else if (selfHosted.length === modelCalls.length) costStatus = "not_applicable";
  else if (priced.length === modelCalls.length - selfHosted.length) costStatus = "calculated";
  else if (priced.length > 0) costStatus = "partial";
  else costStatus = "unknown";

  let outcome: RunSummary["outcome"] = "unknown";
  if (finished) {
    const result = finished.metadata?.result_status;
    outcome =
      result === "completed" || result === "partial" || result === "failed"
        ? result
        : finished.status === "error"
          ? "failed"
          : "completed";
  } else if (started) {
    outcome = "running";
  }

  const first = ordered[0].timestamp;
  const last = ordered.at(-1)?.timestamp ?? first;
  return {
    run_id: ordered[0].run_id,
    workflows: [...new Set(ordered.map((event) => event.workflow).filter((value): value is string => Boolean(value)))],
    started_at: first,
    finished_at: finished ? last : null,
    duration_ms: Date.parse(last) - Date.parse(first),
    outcome,
    model_calls: modelCalls.length,
    tool_calls: ordered.filter((event) => event.event_type === "tool_executed" && event.status !== "started").length,
    blocked_calls: ordered.filter((event) => event.event_type === "tool_blocked").length,
    errors: ordered.filter((event) => event.status === "error").length,
    input_tokens: modelCalls.reduce((sum, event) => sum + toNumber(event.input_tokens), 0),
    output_tokens: modelCalls.reduce((sum, event) => sum + toNumber(event.output_tokens), 0),
    cost_usd: Number(priced.reduce((sum, event) => sum + toNumber(event.cost_usd), 0).toFixed(8)),
    cost_status: costStatus,
    models: [...new Set(modelCalls.map((event) => event.model).filter((value): value is string => Boolean(value)))],
    steps: ordered.map(stepFor).filter((step): step is RunStep => step !== null),
  };
}
