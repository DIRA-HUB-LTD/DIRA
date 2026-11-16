"use client";

import { useState } from "react";

/** Opens the synthetic-data workspace as a demo teacher. No account needed. */
export default function DemoAccessButton({ className = "" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/demo", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "The demo could not be opened");
        return;
      }
      window.location.href = typeof body.next === "string" ? body.next : "/this-week";
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={`rounded-md border-2 border-dira-amber bg-white px-5 py-3 text-sm font-semibold text-dira-teal-deep hover:bg-dira-amber/10 disabled:opacity-60 dark:bg-gray-900 dark:text-dira-amber ${className}`}
      >
        {busy ? "Opening…" : "Explore with synthetic data"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}
