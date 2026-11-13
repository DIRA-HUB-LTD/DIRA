import { NextRequest, NextResponse } from "next/server";
import { runProfileUpdateAgent } from "@/lib/agent/profile-update-agent";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { resolveTeacherContext } from "@/lib/auth/teacher-context";
import { GlmConfigurationError, GlmRequestError } from "@/lib/models";

export const runtime = "nodejs";
export const maxDuration = 180;

/** Run the profile-update agent for one learner, on demand. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ learnerId: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const context = await resolveTeacherContext();
  if (!context) return NextResponse.json({ error: "A teacher context is required" }, { status: 503 });
  const { learnerId } = await params;
  try {
    const result = await runProfileUpdateAgent(learnerId, context, { trigger: "manual" });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GlmConfigurationError) {
      return NextResponse.json({ error: "The model provider is not configured on this server." }, { status: 503 });
    }
    if (error instanceof GlmRequestError) {
      return NextResponse.json({ error: "The model service could not be reached. Try again shortly." }, { status: 502 });
    }
    console.error("Profile update agent failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "The profile update failed" }, { status: 500 });
  }
}
