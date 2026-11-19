"use client";

import { useState } from "react";
import { normalisePhone } from "@/lib/utils/phone";

const COUNTRIES = [
  { code: "254", label: "Kenya (+254)" },
  { code: "256", label: "Uganda (+256)" },
  { code: "255", label: "Tanzania (+255)" },
  { code: "250", label: "Rwanda (+250)" },
  { code: "251", label: "Ethiopia (+251)" },
  { code: "234", label: "Nigeria (+234)" },
  { code: "233", label: "Ghana (+233)" },
  { code: "27", label: "South Africa (+27)" },
  { code: "44", label: "United Kingdom (+44)" },
  { code: "1", label: "USA / Canada (+1)" },
  { code: "other", label: "Other country code…" },
];

/** Country code + number, checked as you type; the server checks again before dialling. */
export default function DemoCallNumberForm({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [country, setCountry] = useState("254");
  const [otherCode, setOtherCode] = useState("");
  const [number, setNumber] = useState("");
  const [touched, setTouched] = useState(false);
  const code = country === "other" ? otherCode : country;
  const check = normalisePhone(code, number);

  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-sm">
          <span className="font-medium text-gray-900 dark:text-gray-100">Country</span>
          <select
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
          >
            {COUNTRIES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {country === "other" && (
          <label className="block text-sm">
            <span className="font-medium text-gray-900 dark:text-gray-100">Code</span>
            <span className="mt-1 flex items-center rounded-md border border-gray-300 bg-white px-2 dark:border-gray-600 dark:bg-gray-900">
              +
              <input
                value={otherCode}
                onChange={(event) => setOtherCode(event.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                inputMode="numeric"
                placeholder="e.g. 260"
                className="w-16 bg-transparent py-2 pl-1 text-sm outline-none"
                aria-label="Country code"
              />
            </span>
          </label>
        )}
        <label className="block flex-1 text-sm">
          <span className="font-medium text-gray-900 dark:text-gray-100">Phone number</span>
          <input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            onBlur={() => setTouched(true)}
            inputMode="tel"
            autoComplete="tel"
            placeholder={country === "254" ? "0712 345 678" : "Phone number"}
            className="mt-1 block w-full min-w-48 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
          />
        </label>
      </div>
      <input type="hidden" name="country" value={code} />
      <input type="hidden" name="number" value={number} />
      {touched && !check.ok && (
        <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
          {check.message}
        </p>
      )}
      {check.ok && (
        <p className="text-xs text-gray-600 dark:text-gray-400">DIRA will call {check.e164}.</p>
      )}
      <button
        type="submit"
        disabled={!check.ok}
        className="rounded-md bg-dira-teal px-4 py-2 text-sm font-medium text-white hover:bg-dira-teal-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        Call me now
      </button>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Up to three demo calls per number a day. The number is used for this call only and is
        not saved.
      </p>
    </form>
  );
}
