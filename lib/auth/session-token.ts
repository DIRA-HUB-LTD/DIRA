// Signed session tokens for the pilot teacher sign-in.
// Format: base64url(JSON payload) "." base64url(HMAC-SHA256(payload, secret)).
// Pure functions so they are unit-tested without Next.js.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_TTL_SECONDS = 8 * 60 * 60; // one school day

export interface SessionPayload {
  teacher_id: string;
  school_id: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

export function sessionSecretIsUsable(secret: string | undefined): secret is string {
  return typeof secret === "string" && Buffer.byteLength(secret) >= 32;
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createSessionToken(
  teacher: { teacher_id: string; school_id: string },
  secret: string,
  nowMs = Date.now(),
): string {
  if (!sessionSecretIsUsable(secret)) throw new Error("Session secret must be at least 32 bytes");
  const payload: SessionPayload = {
    teacher_id: teacher.teacher_id,
    school_id: teacher.school_id,
    exp: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string | undefined,
  nowMs = Date.now(),
): SessionPayload | null {
  if (!token || !sessionSecretIsUsable(secret)) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const expected = Buffer.from(sign(encoded, secret));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as SessionPayload).teacher_id !== "string" ||
    typeof (payload as SessionPayload).school_id !== "string" ||
    typeof (payload as SessionPayload).exp !== "number"
  ) {
    return null;
  }
  const session = payload as SessionPayload;
  return session.exp > Math.floor(nowMs / 1000) ? session : null;
}
