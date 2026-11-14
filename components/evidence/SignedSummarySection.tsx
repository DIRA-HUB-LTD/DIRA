"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";

interface GateCheck {
  key: string;
  label: string;
  required: number;
  actual: number;
  met: boolean;
}

interface Note {
  note_id: string;
  status: "DRAFT" | "APPROVED" | "DISCARDED";
  sentences: Array<{ text: string; citations: string[] }>;
  draft_text: string;
  limitations: string[];
  approved_text: string | null;
  approved_at: string | null;
  approved_by_teacher_id: string | null;
  created_at: string;
}

/**
 * Signed evidence summary: the foot of the Learner Evidence Card.
 * When the evidence gate is met, the cited evidence on the card can be turned into
 * a short, plain-language summary for a conversation with the learner's family.
 * The agent can only draft. A named, signed-in teacher signs it, and DIRA never
 * sends it: the teacher raises it with the family personally.
 */
export default function SignedSummarySection({ learnerId }: { learnerId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [gate, setGate] = useState<{ eligible: boolean; checks: GateCheck[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const base = `/api/evidence/${encodeURIComponent(learnerId)}/signed-summaries`;

  const load = useCallback(async () => {
    const response = await fetch(base, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    setNotes(body.notes ?? []);
    setGate(body.gate ?? null);
    const draft = (body.notes ?? []).find((note: Note) => note.status === "DRAFT");
    if (draft) setEditText(draft.draft_text);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function draft() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(base, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setMessage(body.message ?? body.error ?? "The summary could not be drafted.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function decide(noteId: string, action: "approve" | "discard") {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${base}/${encodeURIComponent(noteId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "approve" ? { action, text: editText } : { action }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(body.error ?? "The decision could not be saved.");
        return;
      }
      setMessage(
        action === "approve"
          ? `Signed by ${body.approved_by}. DIRA has not sent this anywhere. Raise it with the family yourself.`
          : "Draft discarded.",
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  const openDraft = notes.find((note) => note.status === "DRAFT");
  const approved = notes.filter((note) => note.status === "APPROVED");

  return (
    <section
      aria-label="Sign this summary"
      className="rounded-lg border border-[#e8eaf0] bg-white p-3 dark:border-[#26364b] dark:bg-[#111e30] sm:p-4"
    >
      <h2 className="text-lg font-bold text-[#101d4c] dark:text-gray-100">Sign this summary</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        When the evidence is strong enough, DIRA turns the cited evidence on this card into a short
        summary you can use in a conversation with the learner&apos;s family. You edit it and sign it
        as yourself. DIRA never sends it. It never labels the learner or picks a pathway.
      </p>

      {gate && !gate.eligible && !openDraft && (
        <div className="mt-4">
          <p className="text-sm font-medium">Not enough evidence yet. Still needed:</p>
          <ul className="mt-2 space-y-1 text-sm">
            {gate.checks.map((check) => (
              <li key={check.key} className={check.met ? "text-green-700 dark:text-green-400" : ""}>
                {check.met ? "✓" : "○"} {check.label}: {check.actual} of {check.required}
              </li>
            ))}
          </ul>
        </div>
      )}

      {gate?.eligible && !openDraft && (
        <Button className="mt-4" onClick={draft} disabled={busy}>
          {busy ? "Drafting…" : "Draft a summary to sign"}
        </Button>
      )}

      {openDraft && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Draft. Not signed and not shared
          </p>
          <ol className="space-y-2 text-sm">
            {openDraft.sentences.map((sentence, index) => (
              <li key={index}>
                {sentence.text}{" "}
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  [{sentence.citations.join(", ")}]
                </span>
              </li>
            ))}
          </ol>
          <div className="text-xs text-gray-600 dark:text-gray-400">
            <p className="font-medium">What this cannot tell us:</p>
            <ul className="list-disc pl-5">
              {openDraft.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </div>
          <label className="block text-sm font-medium">
            Your wording (edit before signing)
            <textarea
              className="mt-1 h-28 w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100"
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
              maxLength={4000}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => decide(openDraft.note_id, "approve")} disabled={busy}>
              Sign as yourself
            </Button>
            <Button variant="outline-solid" onClick={() => decide(openDraft.note_id, "discard")} disabled={busy}>
              Discard
            </Button>
            <Link href="/sign-in" className="self-center text-xs text-blue-600 underline dark:text-blue-400">
              Signing requires sign-in
            </Link>
          </div>
        </div>
      )}

      {approved.length > 0 && (
        <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
          <p className="text-sm font-medium">Signed summaries</p>
          {approved.map((note) => (
            <div key={note.note_id} className="mt-2 text-sm">
              <p>{note.approved_text}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Signed by {note.approved_by_teacher_id} on{" "}
                {note.approved_at ? new Date(note.approved_at).toLocaleDateString() : ""}. Not sent
                by DIRA.
              </p>
            </div>
          ))}
        </div>
      )}

      {message && (
        <p role="status" className="mt-3 text-sm text-gray-700 dark:text-gray-200">
          {message}
        </p>
      )}
    </section>
  );
}
