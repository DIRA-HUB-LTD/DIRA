import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/teacher-session";
import { createAccount, SignUpError, signUpSchema } from "@/lib/services/sign-up";

export const runtime = "nodejs";

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
  const parsed = signUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Check the form: choose an account type, enter your full name, a valid email and a 6–8 digit PIN" +
          " (and your organisation's name for an enterprise account).",
      },
      { status: 400 },
    );
  }
  try {
    const { teacher, token, next } = await createAccount(parsed.data);
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
    return NextResponse.json({ teacher, next }, { status: 201 });
  } catch (error) {
    if (error instanceof SignUpError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "not_enabled" ? 403 : 409 },
      );
    }
    console.error("Sign-up failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Sign-up failed" }, { status: 500 });
  }
}
