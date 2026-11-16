// OpenID Connect sign-in with Google and Microsoft: authorization code flow with PKCE.
// No "server-only" and no database, so the token checks are unit-tested directly.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type CryptoKey } from "jose";

export type SsoProvider = "google" | "microsoft";
export const SSO_PROVIDERS: readonly SsoProvider[] = ["microsoft", "google"];

/** Microsoft's tenant id for personal accounts (outlook.com, hotmail.com, live.com). */
export const MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

const CONFIG = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    jwks: "https://www.googleapis.com/oauth2/v3/certs",
    idEnv: "GOOGLE_CLIENT_ID",
    secretEnv: "GOOGLE_CLIENT_SECRET",
  },
  microsoft: {
    // "common" accepts work, school and personal accounts. The tenant is checked on the token.
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    jwks: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    idEnv: "MICROSOFT_CLIENT_ID",
    secretEnv: "MICROSOFT_CLIENT_SECRET",
  },
} as const;

export function isSsoProvider(value: string): value is SsoProvider {
  return value === "google" || value === "microsoft";
}

export function providerCredentials(
  provider: SsoProvider,
  env: NodeJS.ProcessEnv = process.env,
): { clientId: string; clientSecret: string } | null {
  const clientId = env[CONFIG[provider].idEnv]?.trim();
  const clientSecret = env[CONFIG[provider].secretEnv]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function configuredProviders(env: NodeJS.ProcessEnv = process.env): SsoProvider[] {
  return SSO_PROVIDERS.filter((provider) => providerCredentials(provider, env) !== null);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizeUrl(
  provider: SsoProvider,
  params: { clientId: string; redirectUri: string; state: string; nonce: string; verifier: string },
): string {
  const url = new URL(CONFIG[provider].authorize);
  url.search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: params.state,
    nonce: params.nonce,
    code_challenge: codeChallenge(params.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

/** What DIRA needs to know about the person, normalised across providers. */
export interface SsoClaims {
  provider: SsoProvider;
  /** Stable id for this person at this provider. */
  subject: string;
  email: string | null;
  /** True only when the provider vouches for the email (Google). Never true for Microsoft. */
  emailVerified: boolean;
  name: string | null;
  /** Microsoft tenant id, or Google Workspace domain. Null for personal accounts. */
  tenant: string | null;
}

export class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcError";
  }
}

const remoteKeys = new Map<SsoProvider, JWTVerifyGetKey>();
function defaultKeys(provider: SsoProvider): JWTVerifyGetKey {
  let keys = remoteKeys.get(provider);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(CONFIG[provider].jwks));
    remoteKeys.set(provider, keys);
  }
  return keys;
}

/**
 * Verify an ID token: signature (provider's keys), audience (our client id), expiry, issuer,
 * and the nonce we issued for this sign-in. Then normalise its claims.
 */
export async function verifyIdToken(
  provider: SsoProvider,
  idToken: string,
  expected: { clientId: string; nonce: string },
  keys: JWTVerifyGetKey | CryptoKey | Uint8Array = defaultKeys(provider),
): Promise<SsoClaims> {
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(idToken, keys as JWTVerifyGetKey, {
      audience: expected.clientId,
      ...(provider === "google" ? { issuer: ["https://accounts.google.com", "accounts.google.com"] } : {}),
    });
    payload = verified.payload as Record<string, unknown>;
  } catch {
    throw new OidcError("The sign-in token could not be verified");
  }

  const nonce = typeof payload.nonce === "string" ? Buffer.from(payload.nonce) : null;
  const wanted = Buffer.from(expected.nonce);
  if (!nonce || nonce.length !== wanted.length || !timingSafeEqual(nonce, wanted)) {
    throw new OidcError("The sign-in token does not belong to this sign-in");
  }
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const sub = str(payload.sub);
  if (!sub) throw new OidcError("The sign-in token has no subject");

  if (provider === "google") {
    const hd = str(payload.hd);
    return {
      provider,
      subject: sub,
      email: str(payload.email)?.toLowerCase() ?? null,
      emailVerified: payload.email_verified === true,
      name: str(payload.name),
      tenant: hd ? hd.toLowerCase() : null,
    };
  }

  // Microsoft: the issuer carries the tenant, and it must agree with the tid claim.
  const tid = str(payload.tid);
  const iss = str(payload.iss);
  if (!tid || iss !== `https://login.microsoftonline.com/${tid}/v2.0`) {
    throw new OidcError("The sign-in token has an unexpected issuer");
  }
  const oid = str(payload.oid) ?? sub;
  const email = str(payload.email) ?? str(payload.preferred_username);
  return {
    provider,
    subject: `${tid}.${oid}`,
    email: email && email.includes("@") ? email.toLowerCase() : null,
    // Microsoft's email claim is not verified. Trust is anchored on the tenant instead.
    emailVerified: false,
    name: str(payload.name),
    tenant: tid === MICROSOFT_CONSUMER_TENANT ? null : tid,
  };
}

/** Exchange the authorization code for an ID token. */
export async function exchangeCode(
  provider: SsoProvider,
  params: { code: string; redirectUri: string; verifier: string; clientId: string; clientSecret: string },
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchFn(CONFIG[provider].token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code_verifier: params.verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as { id_token?: unknown };
  if (!response.ok || typeof body.id_token !== "string") {
    throw new OidcError("The provider did not accept the sign-in");
  }
  return body.id_token;
}

// --- The short-lived cookie that carries state across the redirect to the provider ---

export interface SsoFlow {
  provider: SsoProvider;
  state: string;
  nonce: string;
  verifier: string;
  intent: "signin" | "signup";
  account_type?: "individual" | "enterprise";
  organisation_name?: string;
  exp: number;
}

export const SSO_FLOW_COOKIE = "dira_sso_flow";
export const SSO_FLOW_TTL_SECONDS = 10 * 60;

function sign(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(`sso-flow.${encoded}`).digest("base64url");
}

export function sealFlow(flow: Omit<SsoFlow, "exp">, secret: string, nowMs = Date.now()): string {
  const encoded = Buffer.from(
    JSON.stringify({ ...flow, exp: Math.floor(nowMs / 1000) + SSO_FLOW_TTL_SECONDS }),
  ).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function openFlow(token: string | undefined, secret: string, nowMs = Date.now()): SsoFlow | null {
  if (!token || Buffer.byteLength(secret) < 32) return null;
  const [encoded, signature, ...rest] = token.split(".");
  if (!encoded || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(encoded, secret));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const flow = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SsoFlow;
    return flow.exp > Math.floor(nowMs / 1000) && isSsoProvider(flow.provider) ? flow : null;
  } catch {
    return null;
  }
}
