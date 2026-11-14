import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { SESSION_COOKIE } from "@/lib/auth/teacher-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  (await cookies()).delete(SESSION_COOKIE);
  return NextResponse.json({ signed_out: true });
}
