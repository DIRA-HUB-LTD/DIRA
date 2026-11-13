import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveTeacherContext } from "@/lib/auth/teacher-context";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { assessEvidenceReadiness } from "@/lib/services/evidence-readiness";
import { EvidenceSummaryNotFoundError } from "@/lib/services/evidence-summary";
import {
  draftPathwayNote,
  listPathwayNotes,
  PathwayNoteError,
} from "@/lib/services/pathway-note";

export const runtime = "nodejs";
export const maxDuration = 90;

function failure(error: unknown) {
  if (error instanceof EvidenceSummaryNotFoundError) {
    return NextResponse.json({ error: "Learner is not currently assigned to this teacher" }, { status: 404 });
  }
  if (error instanceof PathwayNoteError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
  }
  console.error("Pathway note request failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json({ error: "The pathway note request failed" }, { status: 500 });
}

/** Notes for this learner plus the evidence gate status. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ learnerId: string }> },
) {
  const context = await resolveTeacherContext();
  if (!context) return NextResponse.json({ error: "A teacher context is required" }, { status: 503 });
  const { learnerId } = await params;
  try {
    const [notes, readiness] = await Promise.all([
      listPathwayNotes(learnerId, context),
      assessEvidenceReadiness(learnerId, context),
    ]);
    return NextResponse.json({ notes, gate: readiness.pathway_gate });
  } catch (error) {
    return failure(error);
  }
}

/** Draft a note. A draft is never shared; a named teacher must approve it. */
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
    const result = await draftPathwayNote(learnerId, context, { submissionId: randomUUID() });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return failure(error);
  }
}
