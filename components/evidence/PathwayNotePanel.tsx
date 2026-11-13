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
 * Early-pathway note: a cited, plain-language conversation starter for a guardian.
 * The agent can only draft. A named, signed-in teacher approves, and DIRA never
 * sends it: the teacher raises it with the guardian personally.
 */
export default function PathwayNotePanel({ learnerId }: { learnerId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [gate, setGate] = useState<{ eligible: boolean; checks: GateCheck[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const base = `/api/evidence/${encodeURIComponent(learnerId)}/pathway-notes`;

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
      if (!response.ok) setMessage(body.message ?? body.error ?? "The note could not be drafted.");
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
          ? `Approved by ${body.approved_by}. DIRA has not sent this anywhere. Raise it with the guardian yourself.`
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
    <section className="mt-6 rounded-xl border border-[#d8e0ee] bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <h2 className="text-lg font-semibold">Early pathway note</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        A short, cited note you can use to start a conversation with the learner&apos;s guardian. It
        describes what was observed and tested. It never labels the learner or picks a pathway.
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
          {busy ? "Drafting…" : "Draft a pathway note"}
        </Button>
      )}

      {openDraft && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Draft. Not approved and not shared
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
            Your wording (edit before approving)
            <textarea
              className="mt-1 h-28 w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100"
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
              maxLength={4000}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => decide(openDraft.note_id, "approve")} disabled={busy}>
              Approve as the named teacher
            </Button>
            <Button variant="outline-solid" onClick={() => decide(openDraft.note_id, "discard")} disabled={busy}>
              Discard
            </Button>
            <Link href="/sign-in" className="self-center text-xs text-blue-600 underline dark:text-blue-400">
              Approval requires sign-in
            </Link>
          </div>
        </div>
      )}

      {approved.length > 0 && (
        <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
          <p className="text-sm font-medium">Approved notes</p>
          {approved.map((note) => (
            <div key={note.note_id} className="mt-2 text-sm">
              <p>{note.approved_text}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Approved by {note.approved_by_teacher_id} on{" "}
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
