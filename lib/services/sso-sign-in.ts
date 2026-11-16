import "server-only";

import { getPool } from "@/lib/db/client";
import type { SsoClaims, SsoFlow } from "@/lib/auth/oidc";
import {
  issueSessionToken,
  postSignInDestination,
  signUpIsEnabled,
  type SignedInTeacher,
} from "@/lib/auth/teacher-session";
import { insertWorkspace } from "@/lib/services/sign-up";

import { SSO_ERROR_MESSAGES, type SsoErrorCode } from "@/lib/auth/sso-messages";

export class SsoError extends Error {
  constructor(
    public readonly code: SsoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SsoError";
  }
}

interface TeacherRow extends SignedInTeacher {
  sso_provider: string | null;
  sso_tenant: string | null;
}

const TEACHER_SELECT = `SELECT t.teacher_id, t.school_id, t.display_name, t.role, s.kind AS workspace_kind,
                               s.sso_provider, s.sso_tenant
                        FROM teachers t JOIN schools s ON s.school_id = t.school_id`;

function publicTeacher(row: TeacherRow): SignedInTeacher {
  return {
    teacher_id: row.teacher_id,
    school_id: row.school_id,
    display_name: row.display_name,
    role: row.role,
    workspace_kind: row.workspace_kind,
  };
}

/**
 * Decide who a verified Microsoft or Google sign-in is, and return a DIRA session for them.
 *
 * 1. Already linked: sign in.
 * 2. An account with the same email exists: link it ONLY when the provider's word can be
 *    trusted for that email:
 *      - Google: the email is verified.
 *      - Microsoft: its email claim is not verified, so the person must come from the same
 *        Microsoft tenant the school registered with.
 *    Linking turns off PIN sign-in for that account, so anyone who had set a PIN on an
 *    email they did not own can no longer get in.
 * 3. No account: create one if the person chose to sign up, otherwise say so.
 */
export async function resolveSsoSignIn(
  claims: SsoClaims,
  flow: Pick<SsoFlow, "intent" | "account_type" | "organisation_name">,
): Promise<{ teacher: SignedInTeacher; token: string; next: string; created: boolean }> {
  const pool = getPool();
  const finish = async (teacher: SignedInTeacher, created: boolean) => ({
    teacher,
    token: issueSessionToken(teacher),
    next: await postSignInDestination(teacher.school_id),
    created,
  });

  const linked = await pool.query<TeacherRow>(
    `${TEACHER_SELECT}
     JOIN oauth_identities i ON i.teacher_id = t.teacher_id AND i.school_id = t.school_id
     WHERE i.provider = $1 AND i.subject = $2`,
    [claims.provider, claims.subject],
  );
  if (linked.rows[0]) return finish(publicTeacher(linked.rows[0]), false);

  if (!claims.email) {
    throw new SsoError("no_email", SSO_ERROR_MESSAGES.no_email);
  }

  const existing = await pool.query<TeacherRow>(`${TEACHER_SELECT} WHERE t.email = $1`, [claims.email]);
  const match = existing.rows[0];
  if (match) {
    const trusted =
      (claims.provider === "google" && claims.emailVerified) ||
      (claims.provider === "microsoft" &&
        match.sso_provider === "microsoft" &&
        match.sso_tenant !== null &&
        match.sso_tenant === claims.tenant);
    if (!trusted) throw new SsoError("cannot_link", SSO_ERROR_MESSAGES.cannot_link);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO oauth_identities (provider, subject, teacher_id, school_id, email)
         VALUES ($1, $2, $3, $4, $5)`,
        [claims.provider, claims.subject, match.teacher_id, match.school_id, claims.email],
      );
      await client.query("UPDATE teachers SET pin_hash = NULL WHERE teacher_id = $1", [match.teacher_id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return finish(publicTeacher(match), false);
  }

  if (flow.intent !== "signup") throw new SsoError("no_account", SSO_ERROR_MESSAGES.no_account);
  if (!signUpIsEnabled()) throw new SsoError("sign_up_closed", SSO_ERROR_MESSAGES.sign_up_closed);

  const teacher = await insertWorkspace({
    account_type: flow.account_type === "enterprise" ? "enterprise" : "individual",
    organisation_name: flow.organisation_name,
    full_name: claims.name ?? claims.email.split("@")[0],
    email: claims.email,
    pin_hash: null,
    sso: { provider: claims.provider, subject: claims.subject, tenant: claims.tenant },
  });
  return finish(teacher, true);
}
