"use client";

import { useEffect, useState } from "react";

type Provider = "microsoft" | "google";
const LABELS: Record<Provider, string> = { microsoft: "Microsoft", google: "Google" };

interface Props {
  intent: "signin" | "signup";
  accountType?: "individual" | "enterprise";
  organisation?: string;
}

/** "Continue with Microsoft / Google", shown only for providers this server has configured. */
export default function SsoButtons({ intent, accountType, organisation = "" }: Props) {
  const [providers, setProviders] = useState<Provider[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { sso_providers?: Provider[] } | null) => {
        if (active && body?.sso_providers) setProviders(body.sso_providers);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (providers.length === 0) return null;

  const needsOrganisation = intent === "signup" && accountType === "enterprise";
  const blocked = needsOrganisation && organisation.trim().length < 2;

  function href(provider: Provider) {
    const params = new URLSearchParams({ intent });
    if (accountType) params.set("account_type", accountType);
    if (needsOrganisation) params.set("organisation_name", organisation.trim());
    return `/api/auth/oauth/${provider}/start?${params.toString()}`;
  }

  const classes =
    "flex w-full items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";

  return (
    <div className="space-y-2">
      {providers.map((provider) =>
        blocked ? (
          <span key={provider} aria-disabled="true" className={`${classes} cursor-not-allowed opacity-50`}>
            Continue with {LABELS[provider]}
          </span>
        ) : (
          // A plain link on purpose: the browser must leave the site for the provider.
          <a key={provider} href={href(provider)} className={classes}>
            Continue with {LABELS[provider]}
          </a>
        ),
      )}
      {blocked && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Enter your school&apos;s name first.
        </p>
      )}
      <p className="pt-1 text-center text-xs text-gray-500 dark:text-gray-400">or use your PIN</p>
    </div>
  );
}
