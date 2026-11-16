"use client";

import Link from "next/link";
import { useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

type AccountType = "individual" | "enterprise";

const OPTIONS: { value: AccountType; title: string; body: string }[] = [
  {
    value: "individual",
    title: "I'm an individual teacher",
    body: "A tutor, homeschool teacher or teacher working on your own. You link your calendar and DIRA works around your own sessions.",
  },
  {
    value: "enterprise",
    title: "I'm signing up a school or organisation",
    body: "You become the administrator. You upload your school's data (learners, classes, staff) and invite teachers.",
  },
];

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";

export default function SignUpPage() {
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [fullName, setFullName] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!accountType) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/sign-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_type: accountType,
          full_name: fullName,
          email,
          pin,
          ...(accountType === "enterprise" ? { organisation_name: organisation } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "Sign-up failed");
        return;
      }
      window.location.href = typeof body.next === "string" ? body.next : "/welcome";
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card className="p-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Create your account</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Who are you signing up as?
        </p>
        <div role="radiogroup" aria-label="Account type" className="mt-4 grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((option) => {
            const selected = accountType === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setAccountType(option.value)}
                className={`rounded-lg border p-4 text-left transition ${
                  selected
                    ? "border-blue-600 bg-blue-50 ring-2 ring-blue-600 dark:bg-blue-950"
                    : "border-gray-300 hover:border-gray-400 dark:border-gray-600"
                }`}
              >
                <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {option.title}
                </span>
                <span className="mt-1 block text-xs text-gray-600 dark:text-gray-300">
                  {option.body}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {accountType && (
        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            {accountType === "enterprise" && (
              <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">
                School or organisation name
                <input
                  className={inputClass}
                  value={organisation}
                  onChange={(event) => setOrganisation(event.target.value)}
                  autoComplete="organization"
                  required
                />
              </label>
            )}
            <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">
              Your full name
              <input
                className={inputClass}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
                required
              />
            </label>
            <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">
              Email
              <input
                className={inputClass}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">
              PIN (6 to 8 digits)
              <input
                className={inputClass}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                type="password"
                autoComplete="new-password"
                minLength={6}
                required
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Creating account…" : "Create account"}
            </Button>
          </form>
        </Card>
      )}

      <p className="text-center text-sm text-gray-600 dark:text-gray-300">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-blue-600 underline dark:text-blue-400">
          Sign in
        </Link>
      </p>
    </div>
  );
}
