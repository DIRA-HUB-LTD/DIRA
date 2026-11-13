// Deterministic stand-in model for checking that the eval HARNESS works without a
// model key. Results produced with it are NOT evidence of model behaviour.
//
// Policy: with tools, it checks readiness, takes the first allowed action, and
// re-checks; it finishes when nothing is allowed. Without tools (JSON mode), it
// writes a pathway note citing the first IDs it is given.

let counter = 0;

function lastReadiness(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "tool") continue;
    try {
      const value = JSON.parse(message.content);
      if (Array.isArray(value.available_actions)) return { value, index };
    } catch {
      // not JSON
    }
  }
  return null;
}

function call(name, args = {}) {
  counter += 1;
  return { id: `scripted-${counter}`, name, arguments: JSON.stringify(args) };
}

export async function scriptedCompletion(messages, tools) {
  if (tools.length === 0) {
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    if (!system.includes("guardian")) {
      // Suggest Test / hypothesis assessment schemas: the stand-in cannot write them.
      // Returning an empty object exercises the real validate -> retry -> fail-closed path.
      return { content: "{}", toolCalls: [], usage: null };
    }
    const user = messages.find((message) => message.role === "user")?.content ?? "";
    const json = user.slice(user.indexOf("{"));
    let evidence = { observations: [], completed_tests: [] };
    try {
      evidence = JSON.parse(json);
    } catch {
      // leave empty
    }
    const observationIds = evidence.observations.map((item) => item.id);
    const testIds = evidence.completed_tests.map((item) => item.id);
    return {
      content: JSON.stringify({
        sentences: [
          { text: "Across these records, the learner was observed organising group tasks.", citations: observationIds.slice(0, 2) },
          { text: "In the classroom test, the learner was observed organising the group.", citations: testIds.slice(0, 1).length ? testIds.slice(0, 1) : observationIds.slice(0, 1) },
        ],
        limitations: ["A few classroom records cannot describe the whole learner."],
      }),
      toolCalls: [],
      usage: null,
    };
  }

  const readiness = lastReadiness(messages);
  const lastMessage = messages.at(-1);
  const justActed = lastMessage?.role === "tool" && (!readiness || readiness.index !== messages.length - 1);
  if (!readiness || justActed) {
    return { content: null, toolCalls: [call("check_evidence_readiness")], usage: null };
  }
  const allowed = readiness.value.available_actions.filter((action) => tools.some((tool) => tool.name === action));
  const triedAlready = new Set(
    messages
      .filter((message) => message.role === "assistant")
      .flatMap((message) => message.tool_calls ?? [])
      .map((item) => item.function.name),
  );
  const next = allowed.find((action) => !triedAlready.has(action));
  if (!next) {
    return { content: "Scripted run finished: nothing further is allowed by the evidence.", toolCalls: [], usage: null };
  }
  const args = next === "assess_test_outcome" ? { test_id: readiness.value.tests_needing_assessment[0] } : {};
  return { content: null, toolCalls: [call(next, args)], usage: null };
}
