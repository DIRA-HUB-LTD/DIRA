import type { NextRequest } from "next/server";

/**
 * Reject cross-site POSTs to cookie-authenticated routes (CSRF defence in depth,
 * alongside SameSite=Lax cookies). Requires an Origin header matching this site.
 */
export function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    return (
      originUrl.origin === request.nextUrl.origin &&
      (process.env.NODE_ENV !== "production" || originUrl.protocol === "https:")
    );
  } catch {
    return false;
  }
}
