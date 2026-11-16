import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  postSignInDestination,
  SignInError,
  signInTeacher,
} from "@/lib/auth/teacher-session";

export const runtime = "nodejs";

const bodySchema = z.object({
  teacher_id: z.string().trim().min(1).max(200),
  pin: z.string().regex(/^\d{4,8}$/),
});

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request must contain valid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter your email (or teacher ID) and your 4–8 digit PIN" },
      { status: 400 },
    );
  }
  try {
    const { teacher, token } = await signInTeacher(parsed.data.teacher_id, parsed.data.pin);
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
    return NextResponse.json({ teacher, next: await postSignInDestination(teacher.school_id) });
  } catch (error) {
    if (error instanceof SignInError) {
      const status =
        error.code === "not_configured" ? 503 : error.code === "too_many_attempts" ? 429 : 401;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Teacher sign-in failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Sign-in failed" }, { status: 500 });
  }
}
