import "server-only";

import { cookies } from "next/headers";
import { getPool } from "@/lib/db/client";
import { verifyPin } from "@/lib/auth/pin";
import {
  createSessionToken,
  SESSION_TTL_SECONDS,
  sessionSecretIsUsable,
  verifySessionToken,
} from "@/lib/auth/session-token";

export const SESSION_COOKIE = "dira_teacher_session";
const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MINUTES = 15;

export interface SignedInTeacher {
  teacher_id: string;
  school_id: string;
  display_name: string;
}

export class SignInError extends Error {
  constructor(
    public readonly code: "not_configured" | "invalid_credentials" | "too_many_attempts",
    message: string,
  ) {
    super(message);
    this.name = "SignInError";
  }
}

function sessionSecret(): string | undefined {
  return process.env.DIRA_SESSION_SECRET?.trim();
}

export function signInIsConfigured(): boolean {
  return sessionSecretIsUsable(sessionSecret());
}

/**
 * Check a teacher ID + PIN. Failed attempts are rate-limited per teacher ID.
 * Returns the session token to store in the cookie.
 */
export async function signInTeacher(
  teacherIdInput: string,
  pin: string,
): Promise<{ teacher: SignedInTeacher; token: string }> {
  const secret = sessionSecret();
  if (!sessionSecretIsUsable(secret)) {
    throw new SignInError("not_configured", "Teacher sign-in is not configured on this server.");
  }
  const teacherId = teacherIdInput.trim().slice(0, 200);
  const pool = getPool();
  const recent = await pool.query<{ failures: number }>(
    `SELECT COUNT(*)::int AS failures
     FROM teacher_sign_in_attempts
     WHERE teacher_id = $1 AND succeeded = FALSE
       AND attempted_at > NOW() - make_interval(mins => $2)`,
    [teacherId, ATTEMPT_WINDOW_MINUTES],
  );
  if ((recent.rows[0]?.failures ?? 0) >= MAX_FAILED_ATTEMPTS) {
    throw new SignInError(
      "too_many_attempts",
      `Too many failed attempts. Try again in ${ATTEMPT_WINDOW_MINUTES} minutes.`,
    );
  }

  const result = await pool.query<SignedInTeacher & { pin_hash: string | null }>(
    `SELECT teacher_id, school_id, display_name, pin_hash FROM teachers WHERE teacher_id = $1`,
    [teacherId],
  );
  const row = result.rows[0];
  const ok = verifyPin(pin, row?.pin_hash);
  await pool.query(
    "INSERT INTO teacher_sign_in_attempts (teacher_id, succeeded) VALUES ($1, $2)",
    [teacherId, ok],
  );
  if (!row || !ok) {
    throw new SignInError("invalid_credentials", "Teacher ID or PIN is incorrect.");
  }
  const teacher = {
    teacher_id: row.teacher_id,
    school_id: row.school_id,
    display_name: row.display_name,
  };
  return { teacher, token: createSessionToken(teacher, secret) };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

/**
 * The teacher signed in on this request, or null. Never falls back to the demo
 * teacher. Use this for consequential actions such as approving a signed summary.
 */
export async function getSignedInTeacher(): Promise<SignedInTeacher | null> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    // Called outside a request (e.g. the in-process MCP server or a script).
    return null;
  }
  const session = verifySessionToken(token, sessionSecret());
  if (!session) return null;
  const result = await getPool().query<SignedInTeacher>(
    `SELECT teacher_id, school_id, display_name FROM teachers
     WHERE teacher_id = $1 AND school_id = $2`,
    [session.teacher_id, session.school_id],
  );
  return result.rows[0] ?? null;
}
