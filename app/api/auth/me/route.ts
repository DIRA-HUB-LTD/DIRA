import { NextResponse } from "next/server";
import { configuredProviders } from "@/lib/auth/oidc";
import { getSignedInTeacher, signInIsConfigured } from "@/lib/auth/teacher-session";
import { teacherExtras } from "@/lib/services/demo-access";

export const runtime = "nodejs";

export async function GET() {
  // Microsoft and Google sign-in need the signed session cookie too.
  const sso_providers = signInIsConfigured() ? configuredProviders() : [];
  try {
    const teacher = await getSignedInTeacher();
    const extras = teacher ? await teacherExtras(teacher) : { is_demo: false, tour_pending: false };
    return NextResponse.json({ teacher, sign_in_configured: signInIsConfigured(), sso_providers, ...extras });
  } catch {
    return NextResponse.json({
      teacher: null,
      sign_in_configured: signInIsConfigured(),
      sso_providers,
      is_demo: false,
      tour_pending: false,
    });
  }
}
