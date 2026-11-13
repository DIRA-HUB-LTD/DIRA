import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "./helpers/pglite-db.mjs";
import { seedLongViewLearner, validNoteReply } from "./helpers/long-view-fixture.mjs";

const holder = vi.hoisted(() => ({ pool: null, replies: [] }));
vi.mock("@/lib/db/client", () => ({ getPool: () => holder.pool }));
vi.mock("@/lib/models", () => ({
  DIRA_AGENT_MODEL: "glm-5.3-flash",
  createAgentCompletion: vi.fn(async () => {
    const next = holder.replies.shift();
    if (next instanceof Error) throw next;
    return { content: next ?? null, toolCalls: [], usage: null };
  }),
}));

const models = await import("@/lib/models");
const {
  approvePathwayNote,
  discardPathwayNote,
  draftPathwayNote,
  evaluatePathwayGate,
  findLanguageProblems,
  listPathwayNotes,
  validateNoteContent,
} = await import("../lib/services/pathway-note.ts");
const { assessEvidenceReadiness } = await import("../lib/services/evidence-readiness.ts");

const CURRENT = { teacher_id: "T_CUR", school_id: "SCH1" };

describe("pathway gate (deterministic)", () => {
  const observation = (teacher_id, academic_year, term, status = "not_required") => ({
    teacher_id,
    academic_year,
    term,
    teacher_review_status: status,
  });

  it("requires reviewed evidence from 2 teachers, 2 terms and a completed test", () => {
    const observations = [
      observation("A", 2025, "Term 1"),
      observation("A", 2025, "Term 1"),
      observation("B", 2026, "Term 3"),
      observation("B", 2026, "Term 3"),
    ];
    const completed = [{ status: "COMPLETED", outcome_observation_id: "O" }];
    expect(evaluatePathwayGate(observations, completed).eligible).toBe(true);
    expect(evaluatePathwayGate(observations, []).eligible).toBe(false);
    const oneTeacher = observations.map((item) => ({ ...item, teacher_id: "A" }));
    expect(evaluatePathwayGate(oneTeacher, completed).eligible).toBe(false);
  });

  it("does not count observations still awaiting teacher review", () => {
    const observations = [
      observation("A", 2025, "Term 1"),
      observation("B", 2026, "Term 3"),
      observation("B", 2026, "Term 3", "recorded"),
      observation("B", 2026, "Term 3", "recorded"),
    ];
    const gate = evaluatePathwayGate(observations, [{ status: "COMPLETED", outcome_observation_id: "O" }]);
    expect(gate.eligible).toBe(false);
    expect(gate.checks.find((check) => check.key === "eligible_observations").actual).toBe(2);
  });
});

describe("note validation and language guard", () => {
  const allowed = new Set(["OBS-1", "OBS-2", "TEST-1"]);

  it("accepts a fully cited, descriptive note", () => {
    const result = validateNoteContent(
      {
        sentences: [
          { text: "Was observed sharing out roles in two group tasks.", citations: ["OBS-1", "OBS-2"] },
          { text: "In a leaderless task, organised the group.", citations: ["TEST-1"] },
        ],
        limitations: ["Only a few observations so far."],
      },
      allowed,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects invented citations and uncited sentences", () => {
    const result = validateNoteContent(
      {
        sentences: [
          { text: "Was observed sharing out roles in group tasks.", citations: ["OBS-99"] },
          { text: "Organised the group in a leaderless task.", citations: [] },
        ],
        limitations: ["Limited evidence."],
      },
      allowed,
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/OBS-99/);
  });

  it("rejects labels, diagnoses, pathway verdicts and overclaiming", () => {
    expect(findLanguageProblems("She is gifted at leading.")).not.toEqual([]);
    expect(findLanguageProblems("Signs of ADHD were seen.")).not.toEqual([]);
    expect(findLanguageProblems("He should pursue a career as a manager.")).not.toEqual([]);
    expect(findLanguageProblems("She always leads.")).not.toEqual([]);
    expect(findLanguageProblems("Was observed organising a group task.")).toEqual([]);
    // Teachers may use absolute words in their own edits; labels stay blocked.
    expect(findLanguageProblems("She never missed a session.", false)).toEqual([]);
  });
});

describe("drafting and approving a pathway note", () => {
  let database;
  let fixture;

  beforeAll(async () => {
    database = await createTestDatabase();
    holder.pool = database.pool;
    fixture = await seedLongViewLearner(database.pool);
  });

  beforeEach(() => {
    holder.replies = [];
    vi.mocked(models.createAgentCompletion).mockClear();
  });

  afterAll(async () => {
    await database?.close();
  });

  it("reports readiness, including that a note can now be drafted", async () => {
    const readiness = await assessEvidenceReadiness("L1", CURRENT);
    expect(readiness.academic_years).toEqual([fixture.years.lastYear, fixture.years.thisYear]);
    expect(readiness.pathway_gate.eligible).toBe(true);
    expect(readiness.tests_needing_assessment).toEqual(["TEST-DONE"]);
    expect(readiness.available_actions).toEqual(
      expect.arrayContaining(["draft_pathway_note", "assess_test_outcome"]),
    );
  });

  it("does not call the model when the gate is not met", async () => {
    const result = await draftPathwayNote("L2", CURRENT);
    expect(result).toMatchObject({ ok: false, status: "gate_not_met" });
    expect(models.createAgentCompletion).not.toHaveBeenCalled();
  });

  it("fails closed and saves nothing when output stays invalid after one retry", async () => {
    holder.replies = [
      JSON.stringify({ sentences: [{ text: "She is gifted.", citations: ["OBS-FAKE"] }], limitations: [] }),
      JSON.stringify({
        sentences: [
          { text: "Amani is a natural leader and always takes charge.", citations: ["OBS-FAKE"] },
          { text: "Should pursue a career in management.", citations: ["TEST-DONE"] },
        ],
        limitations: ["None."],
      }),
    ];
    await expect(draftPathwayNote("L1", CURRENT)).rejects.toMatchObject({ code: "validation_failed" });
    expect(models.createAgentCompletion).toHaveBeenCalledTimes(2);
    const saved = await database.pool.query("SELECT COUNT(*)::int AS count FROM pathway_notes");
    expect(saved.rows[0].count).toBe(0);
  });

  it("retries once with the problems listed, then saves a cited DRAFT", async () => {
    holder.replies = [
      JSON.stringify({ sentences: [{ text: "Leads groups well.", citations: ["NOPE"] }], limitations: ["x"] }),
      validNoteReply(fixture.observationIds, fixture.testId),
    ];
    const result = await draftPathwayNote("L1", CURRENT);
    expect(result.ok).toBe(true);
    expect(result.note.status).toBe("DRAFT");
    expect(result.note.test_ids).toEqual(["TEST-DONE"]);
    const retryMessages = vi.mocked(models.createAgentCompletion).mock.calls[1][0];
    expect(retryMessages.at(-1).content).toMatch(/NOPE/);
  });

  it("returns the existing open draft instead of creating another", async () => {
    const again = await draftPathwayNote("L1", CURRENT);
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(models.createAgentCompletion).not.toHaveBeenCalled();
  });

  it("refuses approval by a teacher who does not teach the learner", async () => {
    const [note] = await listPathwayNotes("L1", CURRENT);
    await expect(
      approvePathwayNote(note.note_id, "L1", { teacher_id: "T_OTHER", school_id: "SCH1" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses an approval edit that adds a label", async () => {
    const [note] = await listPathwayNotes("L1", CURRENT);
    await expect(
      approvePathwayNote(note.note_id, "L1", CURRENT, "Amani is gifted and should be streamed."),
    ).rejects.toMatchObject({ code: "invalid_text" });
  });

  it("records the named approver, time and exact approved text", async () => {
    const [note] = await listPathwayNotes("L1", CURRENT);
    const approved = await approvePathwayNote(
      note.note_id,
      "L1",
      CURRENT,
      "Amani has been seen organising group work this year and last year. I'd love to hear what you notice at home.",
    );
    expect(approved).toMatchObject({
      status: "APPROVED",
      approved_by_teacher_id: "T_CUR",
    });
    expect(approved.approved_text).toMatch(/what you notice at home/);
    expect(approved.approved_at).toBeTruthy();
    await expect(approvePathwayNote(note.note_id, "L1", CURRENT)).rejects.toMatchObject({
      code: "not_a_draft",
    });
  });

  it("lets the teacher discard a new draft", async () => {
    holder.replies = [validNoteReply(fixture.observationIds, fixture.testId)];
    const result = await draftPathwayNote("L1", CURRENT);
    expect(result.duplicate).toBe(false);
    await discardPathwayNote(result.note.note_id, "L1", CURRENT);
    const [latest] = await listPathwayNotes("L1", CURRENT);
    expect(latest.status).toBe("DISCARDED");
  });
});
