import { NextRequest, NextResponse } from "next/server";
import { getSignedInTeacher } from "@/lib/auth/teacher-session";
import { CalendarConnectionError, completeConnection } from "@/lib/services/calendar-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Keeper sends the teacher back here after they approve access. */
export async function GET(request: NextRequest) {
  const done = (outcome: "connected" | "failed") =>
    NextResponse.redirect(new URL(`/welcome?calendar=${outcome}`, request.nextUrl.origin));

  const teacher = await getSignedInTeacher();
  if (!teacher) {
    return NextResponse.redirect(new URL("/sign-in", request.nextUrl.origin));
  }
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  if (params.get("error") || !code || !state) return done("failed");

  try {
    await completeConnection(
      teacher,
      new URL("/api/calendar/callback", request.nextUrl.origin).toString(),
      code,
      state,
    );
    return done("connected");
  } catch (error) {
    console.error("Calendar callback failed", {
      code: error instanceof CalendarConnectionError ? error.code : undefined,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return done("failed");
  }
}
