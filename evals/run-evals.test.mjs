// DIRA eval runner.
//
//   npm run eval            LIVE: real model (ZAI_API_KEY or DIRA_MODEL_BASE_URL), 5 repeats
//   npm run eval:scripted   harness self-check with a deterministic stand-in model
//
// Every repeat uses a fresh in-memory PostgreSQL with the real schema, the real
// profile agent, the real in-process DIRA MCP server and the real services.
// Reports are written to evals/results/. Only LIVE results are evidence.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../tests/helpers/pglite-db.mjs";
import { TASKS } from "./tasks.mjs";
import { scriptedCompletion } from "./scripted-model.mjs";

const MODE = process.env.EVAL_MODE === "live" ? "live" : "scripted";
const REPEATS = Number(process.env.EVAL_REPEATS ?? (MODE === "live" ? 5 : 1));
const ONLY = process.env.EVAL_TASKS?.split(",").map((id) => id.trim()).filter(Boolean);

const holder = vi.hoisted(() => ({ pool: null }));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));
// Also expose the pool through the client's test-only global seam: on Windows a
// lower-case drive letter in the working directory can make Vitest load a second copy
// of a module that the alias mock misses.
function usePool(pool) {
  holder.pool = pool;
  globalThis.__diraTestPool = pool;
}
vi.mock("@/lib/models", async (importOriginal) => {
  const actual = await importOriginal();
  if (process.env.EVAL_MODE === "live") return actual;
  return { ...actual, createAgentCompletion: (messages, tools) => scriptedCompletion(messages, tools) };
});

const { runProfileUpdateAgent } = await import("../lib/agent/profile-update-agent.ts");
const { createAgentCompletion, DIRA_AGENT_MODEL } = await import("@/lib/models");

if (MODE === "live" && !process.env.ZAI_API_KEY?.trim() && !process.env.DIRA_MODEL_BASE_URL?.trim()) {
  throw new Error(
    "Live evals need a model: set ZAI_API_KEY, or DIRA_MODEL_BASE_URL + DIRA_MODEL_NAME for a self-hosted open-weights model, in .env.local. (npm run eval:scripted checks the harness without a model.)",
  );
}

const results = [];

function captureToolResults(complete) {
  const toolResults = [];
  const wrapped = async (messages, tools, context) => {
    // Record tool results the agent passed back to the model (newest last).
    const assistantCalls = new Map();
    for (const message of messages) {
      if (message.role === "assistant") {
        for (const item of message.tool_calls ?? []) assistantCalls.set(item.id, item.function.name);
      }
    }
    toolResults.length = 0;
    for (const message of messages) {
      if (message.role === "tool") {
        toolResults.push({ tool: assistantCalls.get(message.tool_call_id), content: message.content });
      }
    }
    return complete(messages, tools, context);
  };
  return { wrapped, toolResults };
}

async function runOnce(task) {
  const database = await createTestDatabase();
  usePool(database.pool);
  const savedEnv = {};
  for (const [key, value] of Object.entries(task.env ?? {})) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
  const restoreFetch = MODE === "scripted" ? stubNetwork() : () => {};
  const startedAt = Date.now();
  try {
    await task.setup(database.pool);
    const { wrapped, toolResults } = captureToolResults(createAgentCompletion);
    let result = null;
    let error = null;
    for (let run = 0; run < (task.runs ?? 1); run += 1) {
      try {
        result = await runProfileUpdateAgent(task.learner, task.context, { deps: { complete: wrapped } });
      } catch (caught) {
        error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught);
      }
    }
    const durationMs = Date.now() - startedAt;
    const usage = await database.pool.query(
      `SELECT COALESCE(SUM(input_tokens),0)::int AS input_tokens,
              COALESCE(SUM(output_tokens),0)::int AS output_tokens,
              COALESCE(SUM(cost_usd),0)::float AS cost_usd,
              COUNT(*)::int AS model_calls,
              COUNT(*) FILTER (WHERE cost_status = 'calculated')::int AS priced_calls
       FROM agent_activity_logs WHERE event_type = 'model_call'`,
    );
    let pass = false;
    let reason = error ?? "";
    if (result) {
      [pass, reason] = await task.check({ pool: database.pool, result, toolResults: [...toolResults] });
    } else if (!error) {
      reason = "agent returned no result";
    }
    return {
      pass,
      reason,
      status: result?.status ?? "error",
      action_sequence: result ? result.actions.map((action) => `${action.tool}:${action.status}`).join(" > ") : "(error)",
      duration_ms: durationMs,
      ...usage.rows[0],
    };
  } finally {
    restoreFetch();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await database.close();
  }
}

/** Scripted mode must not touch the network (simulates live retrieval being down). */
function stubNetwork() {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("network disabled in scripted eval mode");
  };
  return () => {
    globalThis.fetch = original;
  };
}

const selected = TASKS.filter((task) => (!ONLY || ONLY.includes(task.id)));

describe(`DIRA evals (${MODE}, ${REPEATS} repeat${REPEATS === 1 ? "" : "s"})`, () => {
  for (const task of selected) {
    const runnable = MODE === "live" || task.scripted;
    it.skipIf(!runnable)(`${task.id} ${task.title}`, { timeout: 600_000 }, async () => {
      const repeats = [];
      for (let index = 0; index < REPEATS; index += 1) repeats.push(await runOnce(task));
      results.push({ task, repeats });
      // The runner records results; it does not fail the build on model behaviour.
      expect(repeats).toHaveLength(REPEATS);
    });
  }
});

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

afterAll(() => {
  if (results.length === 0) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.resolve("evals/results");
  mkdirSync(dir, { recursive: true });
  const rows = results.map(({ task, repeats }) => {
    const passes = repeats.filter((item) => item.pass).length;
    const sequences = new Set(repeats.map((item) => item.action_sequence));
    return {
      id: task.id,
      title: task.title,
      criterion: task.criterion,
      known_failure: task.knownFailure ?? null,
      passes,
      repeats: repeats.length,
      pass_rate: passes / repeats.length,
      distinct_action_sequences: sequences.size,
      median_duration_ms: median(repeats.map((item) => item.duration_ms)),
      total_cost_usd: Number(repeats.reduce((sum, item) => sum + item.cost_usd, 0).toFixed(6)),
      mean_cost_usd_per_run: Number((repeats.reduce((sum, item) => sum + item.cost_usd, 0) / repeats.length).toFixed(6)),
      unpriced_model_calls: repeats.reduce((sum, item) => sum + (item.model_calls - item.priced_calls), 0),
      runs: repeats,
    };
  });
  const report = {
    mode: MODE,
    evidence: MODE === "live",
    model: MODE === "live" ? DIRA_AGENT_MODEL : "scripted stand-in (not a model)",
    repeats: REPEATS,
    generated_at: new Date().toISOString(),
    tasks: rows,
  };
  writeFileSync(path.join(dir, `${stamp}-${MODE}.json`), JSON.stringify(report, null, 2));
  const lines = [
    `# DIRA eval results: ${MODE.toUpperCase()}`,
    "",
    MODE === "live"
      ? `Model: ${report.model}. ${REPEATS} repeats per task. Generated ${report.generated_at}.`
      : "**SCRIPTED MODE: harness self-check with a deterministic stand-in model. NOT evidence of model behaviour.**",
    "",
    "| Task | Passed | Pass rate | Distinct action sequences | Median time | Mean model cost / run | Notes |",
    "|---|---|---|---|---|---|---|",
    ...rows.map((row) =>
      `| ${row.id} ${row.title} | ${row.passes}/${row.repeats} | ${(row.pass_rate * 100).toFixed(0)}% | ${row.distinct_action_sequences} | ${(row.median_duration_ms / 1000).toFixed(1)} s | $${row.mean_cost_usd_per_run.toFixed(6)}${row.unpriced_model_calls ? ` (${row.unpriced_model_calls} unpriced calls)` : ""} | ${row.known_failure ? "Known unfixed failure. " : ""}${row.runs.find((run) => !run.pass)?.reason ?? ""} |`,
    ),
    "",
    "Distinct action sequences > 1 means the agent chose different steps across repeats (run-to-run variation).",
  ];
  writeFileSync(path.join(dir, `${stamp}-${MODE}.md`), `${lines.join("\n")}\n`);
  console.log(`\nEval report written to evals/results/${stamp}-${MODE}.md`);
  console.table(rows.map(({ id, passes, repeats, distinct_action_sequences }) => ({ id, passes, repeats, distinct_action_sequences })));
});
