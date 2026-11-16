"use client";

import { useState } from "react";

export default function SkipSetup() {
  const [busy, setBusy] = useState(false);
  async function skip() {
    setBusy(true);
    try {
      await fetch("/api/workspace/setup", { method: "POST" });
    } finally {
      window.location.href = "/this-week";
    }
  }
  return (
    <button
      type="button"
      onClick={skip}
      disabled={busy}
      className="text-sm text-gray-600 underline hover:text-gray-900 dark:text-gray-300"
    >
      Skip for now
    </button>
  );
}
