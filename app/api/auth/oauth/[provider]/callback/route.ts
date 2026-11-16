import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCode,
  isSsoProvider,
  openFlow,
  OidcError,
  providerCredentials,
  SSO_FLOW_COOKIE,
  verifyIdToken,
} from "@/lib/auth/oidc";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/teacher-session";
import { SignUpError } from "@/lib/services/sign-up";
import { resolveSsoSignIn, SsoError } from "@/lib/services/sso-sign-in";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The provider sends the person back here with a code. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const origin = request.nextUrl.origin;
  const back = (error: string) => {
    const response = NextResponse.redirect(new URL(`/sign-in?error=${error}`, origin));
    response.cookies.delete({ name: SSO_FLOW_COOKIE, path: "/api/auth/oauth" });
    return response;
  };

  if (!isSsoProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  const credentials = providerCredentials(provider);
  const secret = process.env.DIRA_SESSION_SECRET?.trim();
  const flow = secret ? openFlow(request.cookies.get(SSO_FLOW_COOKIE)?.value, secret) : null;
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");

  if (params.get("error")) return back("cancelled");
  // The state must be the one we issued to this browser for this provider.
  if (!credentials || !flow || flow.provider !== provider || !code || !state || !sameValue(state, flow.state)) {
    return back("failed");
  }

  try {
    const redirectUri = new URL(`/api/auth/oauth/${provider}/callback`, origin).toString();
    const idToken = await exchangeCode(provider, {
      code,
      redirectUri,
      verifier: flow.verifier,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    });
    const claims = await verifyIdToken(provider, idToken, {
      clientId: credentials.clientId,
      nonce: flow.nonce,
    });
    const { token, next } = await resolveSsoSignIn(claims, flow);
    const response = NextResponse.redirect(new URL(next, origin));
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    response.cookies.delete({ name: SSO_FLOW_COOKIE, path: "/api/auth/oauth" });
    return response;
  } catch (error) {
    if (error instanceof SsoError) return back(error.code);
    if (error instanceof SignUpError) return back("email_taken");
    console.error("SSO sign-in failed", {
      provider,
      errorName: error instanceof Error ? error.name : "UnknownError",
      oidc: error instanceof OidcError,
    });
    return back("failed");
  }
}
