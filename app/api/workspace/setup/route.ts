import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { getSignedInTeacher } from "@/lib/auth/teacher-session";
import { getPool } from "@/lib/db/client";

export const runtime = "nodejs";

/** "Skip for now": the signed-in teacher's workspace stops being sent to the connect step. */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const teacher = await getSignedInTeacher();
  if (!teacher) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  await getPool().query(
    "UPDATE schools SET setup_completed_at = COALESCE(setup_completed_at, NOW()) WHERE school_id = $1",
    [teacher.school_id],
  );
  return NextResponse.json({ ok: true });
}
