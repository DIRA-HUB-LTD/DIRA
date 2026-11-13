import { NextResponse } from "next/server";
import { getSignedInTeacher, signInIsConfigured } from "@/lib/auth/teacher-session";

export const runtime = "nodejs";

export async function GET() {
  try {
    const teacher = await getSignedInTeacher();
    return NextResponse.json({ teacher, sign_in_configured: signInIsConfigured() });
  } catch {
    return NextResponse.json({ teacher: null, sign_in_configured: signInIsConfigured() });
  }
}
