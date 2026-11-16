import { NextResponse } from "next/server";
import { configuredProviders } from "@/lib/auth/oidc";
import { getSignedInTeacher, signInIsConfigured } from "@/lib/auth/teacher-session";

export const runtime = "nodejs";

export async function GET() {
  // Microsoft and Google sign-in need the signed session cookie too.
  const sso_providers = signInIsConfigured() ? configuredProviders() : [];
  try {
    const teacher = await getSignedInTeacher();
    return NextResponse.json({ teacher, sign_in_configured: signInIsConfigured(), sso_providers });
  } catch {
    return NextResponse.json({ teacher: null, sign_in_configured: signInIsConfigured(), sso_providers });
  }
}
