"use client";

import Link from "next/link";
import { useState } from "react";
import Button from "@/components/ui/Button";

interface AgentAction {
  tool: string;
  status: "success" | "error" | "blocked";
  detail: string;
}

interface AgentResult {
  run_id: string;
  status: "completed" | "partial" | "failed";
  summary: string;
  actions: AgentAction[];
  model_turns: number;
}

const TOOL_LABEL: Record<string, string> = {
  check_evidence_readiness: "Checked what the evidence supports",
  get_learner_observations: "Read the learner's observations",
  get_previous_suggestions: "Read previous tests",
  retrieve_education_resources: "Looked up approved education guidance",
  suggest_test: "Suggested a small classroom test",
  assess_test_outcome: "Compared a test outcome with its hypothesis",
  draft_pathway_note: "Drafted a pathway note for your review",
};

const STATUS_STYLE: Record<AgentAction["status"], string> = {
  success: "text-green-700 dark:text-green-400",
  error: "text-red-700 dark:text-red-400",
  blocked: "text-amber-700 dark:text-amber-400",
};

/** Lets the teacher run the profile-update agent and see every step it took. */
export default function ProfileAgentPanel({ learnerId }: { learnerId: string }) {
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/evidence/${encodeURIComponent(learnerId)}/profile-update`, {
        method: "POST",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "The profile update failed.");
        return;
      }
      setResult(body);
      // Refresh server-rendered evidence (new assessment, test or draft).
      setTimeout(() => window.location.reload(), 4000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-[#d8e0ee] bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Update this profile</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            DIRA&apos;s agent checks what the evidence supports, decides what to do next (assess a
            completed test, suggest a new one, or draft a note for you), and checks again after each
            step. It cannot approve or send anything.
          </p>
        </div>
        <Button onClick={run} disabled={busy}>
          {busy ? "Agent working…" : "Run profile update"}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <p className="text-sm">
            <span className="font-medium">
              {result.status === "completed" ? "Done" : result.status === "partial" ? "Partly done" : "Could not finish"}
              :
            </span>{" "}
            {result.summary}
          </p>
          <ol className="space-y-1 text-sm">
            {result.actions.map((action, index) => (
              <li key={index} className={STATUS_STYLE[action.status]}>
                {index + 1}. {TOOL_LABEL[action.tool] ?? action.tool}
                {action.status !== "success" && ` (${action.status}: ${action.detail})`}
                {action.status === "success" && action.detail && (
                  <span className="text-gray-500 dark:text-gray-400"> · {action.detail}</span>
                )}
              </li>
            ))}
          </ol>
          <Link
            href={`/agent-logs?run_id=${encodeURIComponent(result.run_id)}`}
            className="text-xs text-blue-600 underline dark:text-blue-400"
          >
            See the full run log (model calls, tools, cost)
          </Link>
        </div>
      )}
    </section>
  );
}
