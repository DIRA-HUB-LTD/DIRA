import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { getSignedInTeacher } from "@/lib/auth/teacher-session";
import {
  MAX_FILE_BYTES,
  parseSchoolImport,
  TEMPLATES,
} from "@/lib/import/school-csv";
import { applySchoolImport } from "@/lib/services/school-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES = ["staff", "learners", "timetable"] as const;

/** Download a blank template: /api/workspace/import?template=learners */
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("template");
  if (!name || !(FILES as readonly string[]).includes(name)) {
    return NextResponse.json({ error: "Unknown template" }, { status: 404 });
  }
  return new NextResponse(TEMPLATES[name as (typeof FILES)[number]], {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-template.csv"`,
    },
  });
}

/** Preview or commit an upload. Admin only; always applies to the admin's own workspace. */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const admin = await getSignedInTeacher();
  if (!admin) {
    return NextResponse.json({ error: "Sign in to upload data" }, { status: 401 });
  }
  if (admin.role !== "admin") {
    return NextResponse.json({ error: "Only an administrator can upload data" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send the files as a form upload" }, { status: 400 });
  }
  const mode = form.get("mode") === "commit" ? "commit" : "preview";

  const texts: Partial<Record<(typeof FILES)[number], string>> = {};
  for (const name of FILES) {
    const file = form.get(name);
    if (!(file instanceof File) || file.size === 0) continue;
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `${name}.csv is too large (the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB)` },
        { status: 413 },
      );
    }
    texts[name] = await file.text();
  }

  try {
    const result = await applySchoolImport(admin, parseSchoolImport(texts), mode);
    return NextResponse.json(result, { status: result.errors.length > 0 ? 422 : 200 });
  } catch (error) {
    console.error("School import failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "The import failed and nothing was saved" }, { status: 500 });
  }
}
