import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  corroborate,
  DEFAULT_CORROBORATION,
  findUnknownCitations,
  fingerprint,
  generateValidated,
  GenerationFailedError,
  groupByCategory,
  normalizeText,
  validateCitations,
  verifyExcerpt,
} from "@dira/assessment-engine";

function item(id, over = {}) {
  return {
    id,
    group: "participation",
    observer: "T1",
    date: "2026-02-02",
    context: "Group task",
    text: "Offered an idea.",
    reviewed: true,
    theme: null,
    ...over,
  };
}

describe("engine is domain-neutral and self-contained", () => {
  const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
  const files = fs.readdirSync(srcDir).filter((file) => file.endsWith(".ts"));

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("imports nothing from next, pg, react or the app, and never reads the environment", () => {
    for (const file of files) {
      const source = fs.readFileSync(path.join(srcDir, file), "utf8");
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
      for (const specifier of imports) {
        const allowed = specifier.startsWith("./") || specifier === "node:crypto";
        expect(allowed, `${file} imports "${specifier}"`).toBe(true);
      }
      expect(source, `${file} reads process.env`).not.toMatch(/process\.env/);
    }
  });

  it("uses no education vocabulary", () => {
    for (const file of files) {
      const source = fs.readFileSync(path.join(srcDir, file), "utf8").toLowerCase();
      for (const word of ["teacher", "learner", "classroom", "school", "student"]) {
        expect(source, `${file} mentions "${word}"`).not.toContain(word);
      }
    }
  });
});

describe("normalizeText", () => {
  it("lower-cases, collapses whitespace and trims", () => {
    expect(normalizeText("  Hello \n  WORLD\t")).toBe("hello world");
  });
});

describe("groupByCategory", () => {
  it("splits reviewed from awaiting review, keeps the first copy of an id, sorts groups", () => {
    const groups = groupByCategory([
      item("b1", { group: "b" }),
      item("a1", { group: "a" }),
      item("a2", { group: "a", reviewed: false }),
      item("a1", { group: "a", text: "duplicate id, ignored" }),
    ]);
    expect(groups).toEqual([
      { group: "a", ids: ["a1", "a2"], eligibleIds: ["a1"], awaitingReviewIds: ["a2"] },
      { group: "b", ids: ["b1"], eligibleIds: ["b1"], awaitingReviewIds: [] },
    ]);
  });
});

describe("corroborate", () => {
  it("defaults to the thresholds DIRA has always used", () => {
    expect(DEFAULT_CORROBORATION).toEqual({
      minDistinct: 3,
      minObservers: 2,
      minContexts: 2,
      minPeriods: 3,
      minRepeats: 2,
    });
  });

  it("ignores unreviewed items", () => {
    expect(corroborate([item("u", { reviewed: false })])).toEqual([]);
  });

  it("removes exact repeats but not paraphrases", () => {
    const [signal] = corroborate([
      item("x1"),
      item("x2", { text: "  OFFERED an   idea. " }),
      item("x3", { text: "Put forward a suggestion.", date: "2026-02-09" }),
    ]);
    expect(signal.ids).toEqual(["x1", "x3"]);
    expect(signal.duplicateIds).toEqual(["x2"]);
    expect(signal.variationIds).toEqual(["x1", "x3"]);
  });

  it("is more corroborated only when every threshold is met", () => {
    const enough = [
      item("1", { observer: "T1", date: "2026-01-01", context: "A", text: "one" }),
      item("2", { observer: "T2", date: "2026-02-01", context: "B", text: "two" }),
      item("3", { observer: "T3", date: "2026-03-01", context: "C", text: "three" }),
    ];
    expect(corroborate(enough)[0].status).toBe("more_corroborated");
    expect(corroborate(enough.slice(0, 2))[0].status).toBe("under_corroborated");
  });

  it("takes its thresholds from the config, so another product can set its own", () => {
    const two = [
      item("1", { observer: "T1", date: "2026-01-01", context: "A", text: "one" }),
      item("2", { observer: "T2", date: "2026-02-01", context: "B", text: "two" }),
    ];
    const strict = corroborate(two, DEFAULT_CORROBORATION)[0];
    const relaxed = corroborate(two, {
      minDistinct: 2,
      minObservers: 2,
      minContexts: 2,
      minPeriods: 2,
      minRepeats: 2,
    })[0];
    expect(strict.status).toBe("under_corroborated");
    expect(relaxed.status).toBe("more_corroborated");
  });

  it("distinguishes a single item from a repeated signal", () => {
    expect(corroborate([item("1")])[0].kind).toBe("single");
    expect(
      corroborate([item("1"), item("2", { date: "2026-02-09", text: "again" })])[0].kind,
    ).toBe("repeated");
  });

  it("only reports a theme when every item agrees", () => {
    const agree = corroborate([
      item("1", { theme: "Participation" }),
      item("2", { theme: " participation ", date: "2026-02-09", text: "b" }),
    ])[0];
    const disagree = corroborate([
      item("1", { theme: "Participation" }),
      item("2", { theme: "Leadership", date: "2026-02-09", text: "b" }),
    ])[0];
    expect(agree.theme).toBe("Participation");
    expect(disagree.theme).toBeNull();
  });

  it("returns the weakest signal first", () => {
    const signals = corroborate([
      item("w1", { group: "weak" }),
      item("s1", { group: "strong", observer: "T1", date: "2026-01-01", context: "A", text: "1" }),
      item("s2", { group: "strong", observer: "T2", date: "2026-02-01", context: "B", text: "2" }),
      item("s3", { group: "strong", observer: "T3", date: "2026-03-01", context: "C", text: "3" }),
    ]);
    expect(signals.map((signal) => signal.group)).toEqual(["weak", "strong"]);
  });
});

describe("fingerprint", () => {
  it("is a stable SHA-256 hex digest that depends only on the snapshot", () => {
    const snapshot = { a: 1, b: ["x"] };
    expect(fingerprint(snapshot)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint(snapshot)).toBe(fingerprint({ a: 1, b: ["x"] }));
    expect(fingerprint(snapshot)).not.toBe(fingerprint({ a: 2, b: ["x"] }));
  });
});

describe("citations", () => {
  const allowed = new Set(["O1", "O2"]);

  it("lists unknown citations once each, in order", () => {
    expect(findUnknownCitations(["O1", "Z9", "Z9", "Q1"], allowed)).toEqual(["Z9", "Q1"]);
    expect(findUnknownCitations(["O1", "O2"], allowed)).toEqual([]);
  });

  it("reports a readable problem per unknown citation, with where it was", () => {
    expect(
      validateCitations(
        [
          { path: "sentences.0.citations", citations: ["O1"] },
          { path: "sentences.1.citations", citations: ["O2", "NOPE"] },
        ],
        allowed,
      ),
    ).toEqual(['sentences.1.citations: "NOPE" is not one of the allowed evidence IDs']);
  });
});

describe("verifyExcerpt", () => {
  const source = "The learner said:  I think we should try the   second way.";
  it("accepts words that are really in the source, ignoring case and spacing", () => {
    expect(verifyExcerpt("i think we should try the second way", source)).toBe(true);
  });
  it("rejects words that are not there, and empty excerpts", () => {
    expect(verifyExcerpt("we should give up", source)).toBe(false);
    expect(verifyExcerpt("   ", source)).toBe(false);
  });
});

describe("generateValidated", () => {
  const validate = (raw) =>
    raw === "good" ? { ok: true, value: "accepted" } : { ok: false, problems: [`bad: ${raw}`] };

  it("returns the first valid output without retrying", async () => {
    const generate = vi.fn().mockResolvedValue("good");
    await expect(generateValidated({ generate, validate })).resolves.toBe("accepted");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith({ attempt: 1, previousProblems: [] });
  });

  it("retries once, telling the model what was wrong", async () => {
    const generate = vi.fn().mockResolvedValueOnce("oops").mockResolvedValueOnce("good");
    const onInvalid = vi.fn();
    await expect(generateValidated({ generate, validate, onInvalid })).resolves.toBe("accepted");
    expect(generate).toHaveBeenNthCalledWith(2, { attempt: 2, previousProblems: ["bad: oops"] });
    expect(onInvalid).toHaveBeenCalledWith({ attempt: 1, problems: ["bad: oops"] });
  });

  it("fails closed after the correction attempt: throws, never returns invalid output", async () => {
    const generate = vi.fn().mockResolvedValue("still bad");
    const error = await generateValidated({ generate, validate }).catch((e) => e);
    expect(error).toBeInstanceOf(GenerationFailedError);
    expect(error.attempts).toBe(2);
    expect(error.problems).toEqual(["bad: still bad"]);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the model call itself throws", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("model down"));
    await expect(generateValidated({ generate, validate })).rejects.toThrow("model down");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("honours maxAttempts", async () => {
    const generate = vi.fn().mockResolvedValue("bad");
    await expect(generateValidated({ generate, validate, maxAttempts: 3 })).rejects.toThrow(
      GenerationFailedError,
    );
    expect(generate).toHaveBeenCalledTimes(3);
  });
});
