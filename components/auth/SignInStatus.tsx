"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Me {
  teacher: { teacher_id: string; display_name: string } | null;
  sign_in_configured: boolean;
}

/** Shows who is signed in. Named sign-in is required to approve signed summaries. */
export default function SignInStatus({ compact = false }: { compact?: boolean }) {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: Me | null) => {
        if (active) setMe(value);
      })
      .catch(() => {
        if (active) setMe(null);
      });
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    window.location.reload();
  }

  if (!me) return null;
  if (!me.teacher) {
    return (
      <span className="flex items-center gap-3 text-sm font-medium">
        <Link href="/sign-in" className="text-blue-600 hover:underline dark:text-blue-400">
          {compact ? "Sign in" : "Sign in as a named teacher"}
        </Link>
        {!compact && (
          <Link href="/sign-up" className="text-blue-600 hover:underline dark:text-blue-400">
            Create account
          </Link>
        )}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-700 dark:text-gray-200">
        {compact ? me.teacher.display_name.split(" ")[0] : `Signed in: ${me.teacher.display_name}`}
      </span>
      <button
        type="button"
        onClick={signOut}
        className="text-xs text-gray-500 underline hover:text-gray-800 dark:text-gray-400"
      >
        Sign out
      </button>
    </div>
  );
}
