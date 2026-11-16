import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { getSignedInTeacher } from "@/lib/auth/teacher-session";
import { completeTour } from "@/lib/services/demo-access";

export const runtime = "nodejs";

/** Finish or skip the guided tour. Either way it is not shown again. */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const teacher = await getSignedInTeacher();
  if (!teacher) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  await completeTour(teacher);
  return NextResponse.json({ ok: true });
}
