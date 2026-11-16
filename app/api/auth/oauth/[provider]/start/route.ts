import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  buildAuthorizeUrl,
  isSsoProvider,
  providerCredentials,
  randomToken,
  sealFlow,
  SSO_FLOW_COOKIE,
  SSO_FLOW_TTL_SECONDS,
} from "@/lib/auth/oidc";
import { signInIsConfigured } from "@/lib/auth/teacher-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  intent: z.enum(["signin", "signup"]).default("signin"),
  account_type: z.enum(["individual", "enterprise"]).optional(),
  organisation_name: z.string().trim().min(2).max(160).optional(),
});

/** Send the browser to Google or Microsoft. Visited as a normal link, so this is a GET. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const back = (error: string) =>
    NextResponse.redirect(new URL(`/sign-in?error=${error}`, request.nextUrl.origin));

  if (!isSsoProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  const credentials = providerCredentials(provider);
  if (!credentials || !signInIsConfigured()) return back("failed");

  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return back("failed");
  const { intent, account_type, organisation_name } = query.data;
  if (intent === "signup" && (!account_type || (account_type === "enterprise" && !organisation_name))) {
    return back("failed");
  }

  const flow = {
    provider,
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(48),
    intent,
    account_type,
    organisation_name: account_type === "enterprise" ? organisation_name : undefined,
  };
  const redirectUri = new URL(`/api/auth/oauth/${provider}/callback`, request.nextUrl.origin).toString();
  const response = NextResponse.redirect(
    buildAuthorizeUrl(provider, { clientId: credentials.clientId, redirectUri, ...flow }),
  );
  response.cookies.set(SSO_FLOW_COOKIE, sealFlow(flow, process.env.DIRA_SESSION_SECRET!.trim()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/oauth",
    maxAge: SSO_FLOW_TTL_SECONDS,
  });
  return response;
}
