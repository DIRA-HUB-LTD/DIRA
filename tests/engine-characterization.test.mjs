import { describe, expect, it } from "vitest";
import {
  findUnderCorroboratedSignals,
  groupObservationsByType,
  prepareSuggestionEvidence,
  proposalFingerprint,
} from "../lib/mcp-tools/suggestTest.ts";

// CHARACTERIZATION TESTS (roadmap P1).
// These pin what the evidence logic returns TODAY, so that moving it into
// packages/assessment-engine can be proven to change nothing. Expected values
// live in tests/__snapshots__/engine-characterization.test.mjs.snap, recorded from
// the code before it was extracted. If one of these fails after a refactor, the
// refactor changed behaviour: fix the refactor, do not update the snapshot.

function obs(id, over = {}) {
  const date = over.observation_date ?? "2026-02-02";
  return {
    observation_id: id,
    learner_id: "L1",
    teacher_id: "T1",
    observation_type: "participation",
    original_observation: "Offered an idea during the group task.",
    reviewed_observation: null,
    observation_date: date,
    observed_at: new Date(`${date}T09:00:00Z`),
    activity_context: "Group task",
    subject: "Mathematics",
    term: "Term 1",
    possible_theme: null,
    teacher_review_status: "confirmed",
    ...over,
  };
}

// A mix that exercises every branch of the corroboration rules.
const MIXED = [
  // participation: three teachers, three contexts, three dates -> more_corroborated
  obs("P1", { teacher_id: "T1", observation_date: "2026-01-12", activity_context: "Group task", possible_theme: "Participation" }),
  obs("P2", { teacher_id: "T2", observation_date: "2026-02-09", activity_context: "Pair work", original_observation: "Spoke up in pairs.", possible_theme: "Participation" }),
  obs("P3", { teacher_id: "T3", observation_date: "2026-03-16", activity_context: "Whole class", original_observation: "Answered a question aloud.", possible_theme: "Participation" }),
  // academic: exact duplicate (same teacher/date/context/text modulo case and spacing)
  obs("A1", { observation_type: "academic", original_observation: "Explained the steps of the problem.", observation_date: "2026-02-03" }),
  obs("A2", { observation_type: "academic", original_observation: "  EXPLAINED the steps   of the problem. ", observation_date: "2026-02-03" }),
  obs("A3", { observation_type: "academic", original_observation: "Skipped the working out.", observation_date: "2026-02-10", teacher_id: "T2", activity_context: "Quiz" }),
  // behavioral: reviewed text overrides the original; only one teacher/context
  obs("B1", { observation_type: "behavioral", reviewed_observation: "Started the task without prompting.", original_observation: "Started task.", observation_date: "2026-02-04" }),
  obs("B2", { observation_type: "behavioral", original_observation: "Started the task promptly.", observation_date: "2026-02-11" }),
  obs("B3", { observation_type: "behavioral", original_observation: "Started the task promptly.", observation_date: "2026-02-18" }),
  // extracurricular: single observation, plus conflicting themes
  obs("E1", { observation_type: "extracurricular", original_observation: "Led warm-up at football.", activity_context: "Football", possible_theme: "Leadership" }),
  // other: not reviewed yet, so it must not count as evidence
  obs("O1", { observation_type: "other", teacher_review_status: "recorded", original_observation: "Seemed tired." }),
  obs("O2", { observation_type: "other", teacher_review_status: "updated", original_observation: "Brought a book to read.", observation_date: "2026-02-20" }),
  // the same id twice: only the first is kept
  obs("P1", { original_observation: "A later copy that must be ignored." }),
  // null activity context is not a context
  obs("X1", { observation_type: "participation", activity_context: null, observation_date: "2026-04-01", teacher_id: "T4", original_observation: "Joined in." }),
];

describe("characterization: corroboration (to be extracted to the engine)", () => {
  it("groups observations by type and splits eligible from awaiting review", () => {
    expect(groupObservationsByType(MIXED)).toMatchSnapshot();
  });

  it("classifies every signal group and sorts the weakest first", () => {
    expect(findUnderCorroboratedSignals(MIXED)).toMatchSnapshot();
  });

  it("returns nothing for an empty list", () => {
    expect(groupObservationsByType([])).toEqual([]);
    expect(findUnderCorroboratedSignals([])).toEqual([]);
  });

  it("ignores observations that are not reviewed when counting", () => {
    const signals = findUnderCorroboratedSignals([
      obs("U1", { teacher_review_status: "recorded" }),
      obs("U2", { teacher_review_status: "recorded", observation_date: "2026-02-09" }),
    ]);
    expect(signals).toEqual([]);
  });

  it("breaks ties between equally weak signals by how few observations they have", () => {
    const signals = findUnderCorroboratedSignals([
      obs("T-a1", { observation_type: "academic", observation_date: "2026-02-01" }),
      obs("T-a2", { observation_type: "academic", observation_date: "2026-02-08", original_observation: "Second." }),
      obs("T-b1", { observation_type: "behavioral", observation_date: "2026-02-01" }),
    ]);
    expect(signals.map((signal) => signal.observation_type)).toMatchSnapshot();
  });
});

describe("characterization: evidence preparation outcomes", () => {
  const priorNone = [];

  it("no observations -> insufficient_evidence", () => {
    expect(prepareSuggestionEvidence("L1", [], priorNone)).toMatchSnapshot();
  });

  it("only unreviewed observations -> needs_review", () => {
    expect(
      prepareSuggestionEvidence("L1", [obs("N1", { teacher_review_status: "recorded" })], priorNone),
    ).toMatchSnapshot();
  });

  it("reviewed but no repeated under-corroborated signal -> no_suitable_activity", () => {
    expect(prepareSuggestionEvidence("L1", [obs("S1")], priorNone)).toMatchSnapshot();
  });

  it("a repeated, under-corroborated signal -> ready, with the cited evidence", () => {
    const repeated = [
      obs("R1", { observation_date: "2026-02-02" }),
      obs("R2", { observation_date: "2026-02-09", original_observation: "Joined in again." }),
    ];
    expect(prepareSuggestionEvidence("L1", repeated, priorNone)).toMatchSnapshot();
  });

  it("an ACCEPTED test already citing that evidence blocks another suggestion", () => {
    const repeated = [
      obs("R1", { observation_date: "2026-02-02" }),
      obs("R2", { observation_date: "2026-02-09", original_observation: "Joined in again." }),
    ];
    const prior = [
      { test_id: "TEST-1", suggested_activity: "Pair task", activity_date: "2026-03-01", status: "ACCEPTED", evidence_ids: ["R1"] },
    ];
    expect(prepareSuggestionEvidence("L1", repeated, prior)).toMatchSnapshot();
  });

  it("a COMPLETED test does not block a new suggestion", () => {
    const repeated = [
      obs("R1", { observation_date: "2026-02-02" }),
      obs("R2", { observation_date: "2026-02-09", original_observation: "Joined in again." }),
    ];
    const prior = [
      { test_id: "TEST-0", suggested_activity: "Old", activity_date: "2026-01-01", status: "COMPLETED", evidence_ids: ["R1"] },
    ];
    const result = prepareSuggestionEvidence("L1", repeated, prior);
    expect(result.ok).toBe(true);
    expect(result.prior_test_ids).toEqual(["TEST-0"]);
  });
});

describe("characterization: proposal fingerprint", () => {
  const proposal = {
    ok: true,
    status: "proposed",
    learner_id: "L1",
    exploration_question: "What helps the learner contribute?",
    hypothesis: "Smaller groups help.",
    reason: "Two reviewed observations.",
    cited_observations: [
      { observation_id: "R1", content: "Joined in." },
      { observation_id: "R2", content: "Joined in again." },
    ],
    suggested_activity: { title: "Pair task", duration_minutes: 10, purpose: "p", steps: ["a"], what_to_observe: ["b"] },
    what_to_log_afterward: ["What happened"],
    limitations: ["One activity is not a conclusion."],
  };

  it("is a stable SHA-256 of the proposal content", () => {
    const first = proposalFingerprint(proposal);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(proposalFingerprint(structuredClone(proposal)));
    expect(first).toMatchSnapshot();
  });

  it("changes when the content changes, and ignores fields outside the snapshot", () => {
    const base = proposalFingerprint(proposal);
    expect(proposalFingerprint({ ...proposal, hypothesis: "Different." })).not.toBe(base);
    expect(proposalFingerprint({ ...proposal, test_id: "ignored", duplicate: true })).toBe(base);
    expect(proposalFingerprint({ ...proposal, educational_references: [] })).toBe(base);
  });
});
