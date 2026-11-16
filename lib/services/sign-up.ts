import "server-only";

import { randomBytes } from "node:crypto";
import { z } from "zod/v4";
import { getPool } from "@/lib/db/client";
import { hashPin } from "@/lib/auth/pin";
import {
  issueSessionToken,
  postSignInDestination,
  signUpIsEnabled,
  type SignedInTeacher,
} from "@/lib/auth/teacher-session";

export const DEFAULT_TIMEZONE = "Africa/Nairobi";

const person = {
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  // New accounts need a longer PIN than the legacy 4 digits.
  pin: z.string().regex(/^\d{6,8}$/),
};

export const signUpSchema = z.discriminatedUnion("account_type", [
  z.object({ account_type: z.literal("individual"), ...person }),
  z.object({
    account_type: z.literal("enterprise"),
    organisation_name: z.string().trim().min(2).max(160),
    ...person,
  }),
]);

export type SignUpInput = z.infer<typeof signUpSchema>;

export class SignUpError extends Error {
  constructor(
    public readonly code: "not_enabled" | "email_taken",
    message: string,
  ) {
    super(message);
    this.name = "SignUpError";
  }
}

function newId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

/**
 * Create a workspace and its first teacher in one transaction.
 *
 * - enterprise: a `school` workspace; the person who signs up is its admin.
 * - individual: a `personal` workspace with one member, who is its admin and its teacher.
 *
 * Every row carries the new workspace's school_id, so the existing scoping rules apply.
 */
export async function createAccount(
  input: SignUpInput,
): Promise<{ teacher: SignedInTeacher; token: string; next: string }> {
  if (!signUpIsEnabled()) {
    throw new SignUpError("not_enabled", "Sign-up is not open on this server.");
  }

  const teacher = await insertWorkspace({
    account_type: input.account_type,
    organisation_name: input.account_type === "enterprise" ? input.organisation_name : undefined,
    full_name: input.full_name,
    email: input.email,
    pin_hash: hashPin(input.pin),
  });
  return {
    teacher,
    token: issueSessionToken(teacher),
    next: await postSignInDestination(teacher.school_id),
  };
}

export interface NewWorkspace {
  account_type: "individual" | "enterprise";
  organisation_name?: string;
  full_name: string;
  email: string;
  /** Null for someone who signs in with Microsoft or Google and has no PIN. */
  pin_hash: string | null;
  /** The sign-in provider and organisation, recorded on an enterprise workspace. */
  sso?: { provider: "google" | "microsoft"; subject: string; tenant: string | null };
}

/** One transaction: the workspace, its first admin teacher and, for SSO, the linked identity. */
export async function insertWorkspace(input: NewWorkspace): Promise<SignedInTeacher> {
  const email = input.email.trim().toLowerCase();
  const schoolId = newId("SCH");
  const teacherId = newId("T");
  const kind = input.account_type === "enterprise" ? "school" : "personal";
  const workspaceName =
    input.account_type === "enterprise" && input.organisation_name
      ? input.organisation_name
      : `${input.full_name}'s workspace`;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO schools (school_id, school_name, timezone, kind, sso_provider, sso_tenant)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        schoolId,
        workspaceName,
        DEFAULT_TIMEZONE,
        kind,
        kind === "school" && input.sso?.tenant ? input.sso.provider : null,
        kind === "school" ? (input.sso?.tenant ?? null) : null,
      ],
    );
    await client.query(
      `INSERT INTO teachers (teacher_id, school_id, display_name, email, role, pin_hash)
       VALUES ($1, $2, $3, $4, 'admin', $5)`,
      [teacherId, schoolId, input.full_name, email, input.pin_hash],
    );
    if (input.sso) {
      await client.query(
        `INSERT INTO oauth_identities (provider, subject, teacher_id, school_id, email)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.sso.provider, input.sso.subject, teacherId, schoolId, email],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string }).code === "23505") {
      throw new SignUpError("email_taken", "An account with this email already exists. Sign in instead.");
    }
    throw error;
  } finally {
    client.release();
  }

  return {
    teacher_id: teacherId,
    school_id: schoolId,
    display_name: input.full_name,
    role: "admin",
    workspace_kind: kind,
  };
}
