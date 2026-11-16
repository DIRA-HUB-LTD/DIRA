// Safe to import from client components (no server-only code here).
export type SsoErrorCode = "no_email" | "no_account" | "cannot_link" | "sign_up_closed" | "email_taken";

export const SSO_ERROR_MESSAGES: Record<SsoErrorCode | "cancelled" | "failed", string> = {
  no_email: "Your account did not share an email address, so DIRA cannot create or find your account.",
  no_account: "There is no DIRA account for this sign-in yet. Create one first.",
  cannot_link:
    "An account with this email already exists but could not be linked to this sign-in. Sign in with your PIN, or ask your school administrator.",
  sign_up_closed: "Creating new accounts is not open on this server.",
  email_taken: "An account with this email already exists. Sign in instead.",
  cancelled: "Sign-in was cancelled.",
  failed: "Sign-in failed. Try again.",
};
