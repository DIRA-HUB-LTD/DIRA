import "server-only";

import { getPool } from "@/lib/db/client";
import {
  prepareSuggestionEvidence,
  type SuggestTestContext,
  type SuggestionObservation,
} from "@/lib/mcp-tools/suggestTest";
import { loadCurrentAssessments } from "@/lib/services/evidence-reasoning";
import { buildEvidenceSummary } from "@/lib/services/evidence-summary";
import { evaluateSummaryGate, type SummaryGate } from "@/lib/services/signed-summary";
import { loadPreviousSuggestions } from "@/lib/services/suggestion-workflow";

/**
 * Deterministic evidence readiness for one learner: what the evidence currently
 * supports, and what is missing. The profile-update agent calls this first and
 * after every action ("checks itself"), and the agent's tool guards use the same
 * result, so the model cannot act on evidence that is not there.
 */

export type ReadinessAction =
  | "suggest_test"
  | "assess_test_outcome"
  | "draft_signed_summary"
  | "wait_for_more_evidence";

export interface EvidenceReadiness {
  learner_id: string;
  observation_count: number;
  eligible_observation_count: number;
  awaiting_review_count: number;
  academic_years: number[];
  suggestion: {
    ready: boolean;
    status: string;
    message: string;
    signal?: {
      observation_type: string;
      distinct_dates: number;
      distinct_teachers: number;
      distinct_contexts: number;
      observation_ids: string[];
    };
  };
  open_tests: Array<{ test_id: string; status: string; activity_date: string }>;
  tests_needing_assessment: string[];
  summary_gate: SummaryGate;
  open_summary_draft_id: string | null;
  available_actions: ReadinessAction[];
}

export async function assessEvidenceReadiness(
  learnerIdInput: string,
  context: SuggestTestContext,
): Promise<EvidenceReadiness> {
  const learnerId = learnerIdInput.trim();
  // Throws EvidenceSummaryNotFoundError when the teacher does not currently teach the learner.
  const snapshot = await buildEvidenceSummary(learnerId, context);
  const previous = await loadPreviousSuggestions(learnerId, context);

  const observations: SuggestionObservation[] = snapshot.observations.map((item) => ({
    observation_id: item.observation_id,
    learner_id: learnerId,
    teacher_id: item.teacher_id,
    observation_type: item.observation_type as SuggestionObservation["observation_type"],
    original_observation: item.original_observation,
    reviewed_observation: item.reviewed_observation,
    observation_date: item.observation_date,
    observed_at: item.observed_at,
    activity_context: item.activity_context,
    subject: item.subject,
    term: item.term,
    possible_theme: null,
    teacher_review_status: item.teacher_review_status as SuggestionObservation["teacher_review_status"],
  }));
  const preparation = prepareSuggestionEvidence(
    learnerId,
    observations,
    previous.map((test) => ({
      test_id: test.test_id,
      suggested_activity: test.suggested_activity,
      status: test.status,
      activity_date: test.activity_date,
      evidence_ids: test.evidence_ids,
    })),
  );

  const completedWithOutcome = snapshot.tests.filter(
    (test) => test.status === "COMPLETED" && test.outcome_observation_id !== null,
  );
  const assessments = await loadCurrentAssessments(
    completedWithOutcome.map((test) => test.test_id),
    context,
  );
  const assessed = new Set(assessments.map((item) => item.test_id));
  const testsNeedingAssessment = completedWithOutcome
    .filter((test) => !assessed.has(test.test_id) && test.hypothesis)
    .map((test) => test.test_id);

  const gate = evaluateSummaryGate(snapshot.observations, snapshot.tests);
  const draft = await getPool().query<{ note_id: string }>(
    `SELECT note_id::text AS note_id FROM signed_summaries
     WHERE learner_id = $1 AND drafted_for_teacher_id = $2 AND status = 'DRAFT'`,
    [learnerId, context.teacher_id],
  );
  const openDraftId = draft.rows[0]?.note_id ?? null;

  const available: ReadinessAction[] = [];
  if (preparation.ok) available.push("suggest_test");
  if (testsNeedingAssessment.length) available.push("assess_test_outcome");
  if (gate.eligible && !openDraftId) available.push("draft_signed_summary");
  if (available.length === 0) available.push("wait_for_more_evidence");

  const eligible = snapshot.observations.filter((item) =>
    ["not_required", "confirmed", "updated"].includes(item.teacher_review_status),
  );
  return {
    learner_id: learnerId,
    observation_count: snapshot.observations.length,
    eligible_observation_count: eligible.length,
    awaiting_review_count: snapshot.observations.length - eligible.length,
    academic_years: [...new Set(snapshot.observations.map((item) => item.academic_year))].sort(),
    suggestion: preparation.ok
      ? {
          ready: true,
          status: preparation.status,
          message: "An under-corroborated repeated signal can be explored with a small classroom test.",
          signal: {
            observation_type: preparation.candidate.observation_type,
            distinct_dates: preparation.candidate.distinct_dates,
            distinct_teachers: preparation.candidate.distinct_teachers,
            distinct_contexts: preparation.candidate.distinct_contexts,
            observation_ids: preparation.candidate.observation_ids,
          },
        }
      : { ready: false, status: preparation.status, message: preparation.message },
    open_tests: snapshot.tests
      .filter((test) => test.status === "SUGGESTED" || test.status === "ACCEPTED")
      .map((test) => ({ test_id: test.test_id, status: test.status, activity_date: test.activity_date })),
    tests_needing_assessment: testsNeedingAssessment,
    summary_gate: gate,
    open_summary_draft_id: openDraftId,
    available_actions: available,
  };
}
