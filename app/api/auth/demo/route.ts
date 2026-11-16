import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { SESSION_COOKIE, sessionCookieOptions, SignInError } from "@/lib/auth/teacher-session";
import { startDemoSession } from "@/lib/services/demo-access";

export const runtime = "nodejs";

/** "Explore with synthetic data": open the demo workspace without an account. */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  try {
    const session = await startDemoSession();
    if (!session) {
      return NextResponse.json({ error: "The demo data is not loaded on this server" }, { status: 404 });
    }
    (await cookies()).set(SESSION_COOKIE, session.token, sessionCookieOptions());
    return NextResponse.json({ teacher: session.teacher, next: "/this-week" });
  } catch (error) {
    if (error instanceof SignInError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("Demo session failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Could not open the demo" }, { status: 500 });
  }
}
