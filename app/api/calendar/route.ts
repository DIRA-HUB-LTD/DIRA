import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { getSignedInTeacher } from "@/lib/auth/teacher-session";
import {
  CalendarConnectionError,
  checkConnection,
  disconnect,
  getConnectionStatus,
  startConnection,
} from "@/lib/services/calendar-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["connect", "check", "disconnect"]) });

function redirectUri(request: NextRequest): string {
  return new URL("/api/calendar/callback", request.nextUrl.origin).toString();
}

export async function GET() {
  const teacher = await getSignedInTeacher();
  if (!teacher) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  return NextResponse.json(await getConnectionStatus(teacher));
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const teacher = await getSignedInTeacher();
  if (!teacher) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    if (parsed.data.action === "connect") {
      return NextResponse.json(await startConnection(teacher, redirectUri(request)));
    }
    if (parsed.data.action === "check") {
      return NextResponse.json(await checkConnection(teacher, redirectUri(request)));
    }
    await disconnect(teacher);
    return NextResponse.json({ status: "revoked" });
  } catch (error) {
    if (error instanceof CalendarConnectionError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "not_configured" ? 503 : error.code === "not_connected" ? 409 : 400 },
      );
    }
    console.error("Calendar action failed", {
      action: parsed.data.action,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Could not reach the calendar service. Try again." },
      { status: 502 },
    );
  }
}
