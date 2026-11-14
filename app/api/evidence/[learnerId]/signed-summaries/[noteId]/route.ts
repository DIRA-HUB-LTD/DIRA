import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { getSignedInTeacher } from "@/lib/auth/teacher-session";
import {
  approveSignedSummary,
  discardSignedSummary,
  SignedSummaryError,
} from "@/lib/services/signed-summary";

export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), text: z.string().max(4000).optional() }),
  z.object({ action: z.literal("discard") }),
]);

/**
 * The human approval gate. Only a NAMED, signed-in teacher (never the demo
 * fallback) who currently teaches the learner may approve or discard a draft.
 * Approval records who approved, when, and the exact text. Nothing is sent.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ learnerId: string; noteId: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const teacher = await getSignedInTeacher();
  if (!teacher) {
    return NextResponse.json(
      { error: "Sign in as a named teacher to approve or discard a signed summary.", code: "sign_in_required" },
      { status: 401 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request must contain valid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { learnerId, noteId } = await params;
  try {
    if (parsed.data.action === "approve") {
      const note = await approveSignedSummary(noteId, learnerId, teacher, parsed.data.text);
      return NextResponse.json({ note, approved_by: teacher.display_name });
    }
    await discardSignedSummary(noteId, learnerId, teacher);
    return NextResponse.json({ discarded: true });
  } catch (error) {
    if (error instanceof SignedSummaryError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    console.error("Signed summary decision failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "The decision could not be saved" }, { status: 500 });
  }
}
