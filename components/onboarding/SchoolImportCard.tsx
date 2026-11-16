"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

interface RowError {
  file: string;
  row: number;
  message: string;
}
interface ImportResult {
  mode: "preview" | "commit";
  ok: boolean;
  errors: RowError[];
  counts: Record<string, number>;
  credentials: { full_name: string; email: string; teacher_id: string; pin: string }[];
}

const SHEETS = [
  { name: "staff", label: "Staff", hint: "Your teachers (full name, email, role)" },
  { name: "learners", label: "Learners", hint: "Admission number, name, grade and stream" },
  { name: "timetable", label: "Timetable", hint: "Who teaches which class, and when" },
] as const;

const COUNT_LABELS: Record<string, string> = {
  staff_created: "teachers to add",
  staff_updated: "teachers to update",
  classes_created: "classes to create",
  learners_created: "learners to add",
  learners_updated: "learners to update",
  timetable_lessons: "lessons",
};

/** Enterprise admins: upload staff, learners and timetable as CSV, preview, then commit. */
export default function SchoolImportCard({ alreadyImported }: { alreadyImported: boolean }) {
  const [files, setFiles] = useState<Partial<Record<(typeof SHEETS)[number]["name"], File>>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(mode: "preview" | "commit") {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("mode", mode);
      for (const sheet of SHEETS) {
        const file = files[sheet.name];
        if (file) form.set(sheet.name, file);
      }
      const response = await fetch("/api/workspace/import", { method: "POST", body: form });
      const body = await response.json().catch(() => ({}));
      if (response.status === 422 || response.ok) {
        setResult(body as ImportResult);
      } else {
        setResult(null);
        setError(typeof body.error === "string" ? body.error : "The upload failed");
      }
    } finally {
      setBusy(false);
    }
  }

  const hasFile = Object.values(files).some(Boolean);
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        Upload your school&apos;s data
      </h2>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
        Upload up to three CSV sheets (in Excel or Google Sheets, choose Save as CSV). You will see a
        preview first and nothing is saved until you confirm. Uploading again later updates the same
        records.
        {alreadyImported && " This workspace already has an import; uploading again updates it."}
      </p>
      <ul className="mt-4 space-y-3">
        {SHEETS.map((sheet) => (
          <li key={sheet.name} className="text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="font-medium text-gray-800 dark:text-gray-200" htmlFor={`file-${sheet.name}`}>
                {sheet.label}
                <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">{sheet.hint}</span>
              </label>
              <a
                className="text-xs text-blue-600 underline dark:text-blue-400"
                href={`/api/workspace/import?template=${sheet.name}`}
              >
                Download template
              </a>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label
                htmlFor={`file-${sheet.name}`}
                className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dira-teal bg-white px-3 py-1.5 text-sm font-medium text-dira-teal shadow-sm hover:bg-dira-cream focus-within:ring-2 focus-within:ring-dira-amber dark:bg-gray-900 dark:hover:bg-gray-800"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                  <path d="M10 3a1 1 0 0 1 1 1v6.586l1.293-1.293a1 1 0 1 1 1.414 1.414l-3 3a1 1 0 0 1-1.414 0l-3-3a1 1 0 1 1 1.414-1.414L9 10.586V4a1 1 0 0 1 1-1Z" />
                  <path d="M4 13a1 1 0 0 1 1 1v1h10v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z" />
                </svg>
                {files[sheet.name] ? "Change file" : "Choose file"}
                <input
                  id={`file-${sheet.name}`}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(event) => {
                    setResult(null);
                    setFiles((current) => ({ ...current, [sheet.name]: event.target.files?.[0] }));
                  }}
                />
              </label>
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {files[sheet.name]?.name ?? "No file chosen"}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {result && result.errors.length > 0 && (
        <div role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
          <p className="font-medium">Nothing was saved. Fix these and upload again:</p>
          <ul className="mt-1 list-disc pl-5">
            {result.errors.slice(0, 30).map((item, index) => (
              <li key={index}>
                {item.file}
                {item.row > 0 ? `, row ${item.row}` : ""}: {item.message}
              </li>
            ))}
          </ul>
          {result.errors.length > 30 && <p className="mt-1">…and {result.errors.length - 30} more.</p>}
        </div>
      )}

      {result?.ok && result.mode === "preview" && (
        <div className="mt-4 text-sm text-gray-800 dark:text-gray-200">
          <p className="font-medium">Preview. Nothing has been saved yet.</p>
          <ul className="mt-1 list-disc pl-5">
            {Object.entries(result.counts)
              .filter(([, value]) => value > 0)
              .map(([key, value]) => (
                <li key={key}>
                  {value} {COUNT_LABELS[key] ?? key}
                </li>
              ))}
          </ul>
        </div>
      )}

      {result?.ok && result.mode === "commit" && (
        <div role="status" className="mt-4 text-sm text-green-700 dark:text-green-400">
          <p className="font-medium">Saved.</p>
          {result.credentials.length > 0 && (
            <div className="mt-2 text-gray-800 dark:text-gray-200">
              <p>
                New teachers can sign in with their email and the PIN below. Share each PIN privately.
                <strong> This is the only time these PINs are shown.</strong>
              </p>
              <ul className="mt-1 space-y-1 font-mono text-xs">
                {result.credentials.map((credential) => (
                  <li key={credential.teacher_id}>
                    {credential.full_name} · {credential.email} · PIN {credential.pin}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3">
            <a className="font-medium text-blue-600 underline dark:text-blue-400" href="/this-week">
              Continue to DIRA
            </a>
          </p>
        </div>
      )}

      {!(result?.ok && result.mode === "commit") && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" disabled={busy || !hasFile} onClick={() => send("preview")}>
            {busy ? "Checking…" : "Preview"}
          </Button>
          {result?.ok && result.mode === "preview" && (
            <Button type="button" disabled={busy} onClick={() => send("commit")}>
              Save to my school
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
