import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ getPool: () => null }));
const { cleanList } = await import("../lib/agent/suggest-test-graph.ts");

describe("cleaning a model's list items", () => {
  it("splits one run-on numbered string into separate steps", () => {
    expect(cleanList("1. Pair the learners. 2. Give one puzzle. 3. Note who explains.")).toEqual([
      "Pair the learners.",
      "Give one puzzle.",
      "Note who explains.",
    ]);
  });

  it("removes numbering and bullets the page would otherwise repeat", () => {
    expect(cleanList(["1. Ask a question", "Step 2: Wait five seconds", "- Note the answer"])).toEqual([
      "Ask a question",
      "Wait five seconds",
      "Note the answer",
    ]);
  });

  it("splits on new lines and leaves clean lists and non-lists alone", () => {
    expect(cleanList("First thing\nSecond thing")).toEqual(["First thing", "Second thing"]);
    expect(cleanList(["Already clean", "Also clean"])).toEqual(["Already clean", "Also clean"]);
    expect(cleanList(42)).toBe(42);
  });
});
