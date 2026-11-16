import "server-only";

import { randomBytes, randomInt } from "node:crypto";
import { getPool } from "@/lib/db/client";
import { hashPin } from "@/lib/auth/pin";
import type { SignedInTeacher } from "@/lib/auth/teacher-session";
import type { ParsedSchoolImport, RowError } from "@/lib/import/school-csv";

export interface ImportCounts {
  staff_created: number;
  staff_updated: number;
  classes_created: number;
  learners_created: number;
  learners_updated: number;
  timetable_lessons: number;
}

export interface NewStaffCredential {
  full_name: string;
  email: string;
  teacher_id: string;
  /** Shown once to the administrator. Only its hash is stored. */
  pin: string;
}

export interface ImportResult {
  mode: "preview" | "commit";
  ok: boolean;
  errors: RowError[];
  counts: ImportCounts;
  credentials: NewStaffCredential[];
}

const id = (prefix: string) => `${prefix}-${randomBytes(6).toString("hex")}`;

function emptyCounts(): ImportCounts {
  return {
    staff_created: 0,
    staff_updated: 0,
    classes_created: 0,
    learners_created: 0,
    learners_updated: 0,
    timetable_lessons: 0,
  };
}

/**
 * Apply a validated upload to the admin's own workspace, in ONE transaction.
 *
 * Preview and commit run exactly the same statements; a preview rolls back at the end.
 * So what the preview reports is what a commit does, and nothing is written until commit.
 * Re-importing the same sheets updates rows (keyed by email, admission number and the
 * class/day/period slot) instead of duplicating them.
 */
export async function applySchoolImport(
  admin: Pick<SignedInTeacher, "teacher_id" | "school_id" | "role">,
  parsed: ParsedSchoolImport,
  mode: "preview" | "commit",
  now: Date = new Date(),
): Promise<ImportResult> {
  const result: ImportResult = {
    mode,
    ok: false,
    errors: [...parsed.errors],
    counts: emptyCounts(),
    credentials: [],
  };
  if (admin.role !== "admin") {
    result.errors.push({ file: "learners", row: 0, message: "Only an administrator can import data" });
    return result;
  }
  if (result.errors.length > 0) return result;
  if (parsed.staff.length + parsed.learners.length + parsed.timetable.length === 0) {
    result.errors.push({ file: "learners", row: 0, message: "Upload at least one file with data in it" });
    return result;
  }

  const schoolId = admin.school_id;
  const year = now.getUTCFullYear();
  const startOfYear = `${year}-01-01`;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    // Staff, keyed by email within this workspace.
    const teacherByEmail = new Map<string, string>();
    const existingStaff = await client.query<{ teacher_id: string; email: string }>(
      "SELECT teacher_id, email FROM teachers WHERE school_id = $1 AND email IS NOT NULL",
      [schoolId],
    );
    for (const row of existingStaff.rows) teacherByEmail.set(row.email, row.teacher_id);

    for (const staff of parsed.staff) {
      const known = teacherByEmail.get(staff.email);
      if (known) {
        // Never change the importing admin's own role from a spreadsheet.
        await client.query(
          `UPDATE teachers SET display_name = $1,
                  role = CASE WHEN teacher_id = $2 THEN role ELSE $3 END
           WHERE teacher_id = $4 AND school_id = $5`,
          [staff.full_name, admin.teacher_id, staff.role, known, schoolId],
        );
        result.counts.staff_updated += 1;
        continue;
      }
      const other = await client.query("SELECT 1 FROM teachers WHERE email = $1", [staff.email]);
      if (other.rows.length > 0) {
        result.errors.push({
          file: "staff",
          row: staff.row,
          message: `${staff.email} already has a DIRA account in another workspace`,
        });
        continue;
      }
      const teacherId = id("T");
      const pin = String(randomInt(100000, 1000000));
      await client.query(
        `INSERT INTO teachers (teacher_id, school_id, display_name, email, role, pin_hash)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [teacherId, schoolId, staff.full_name, staff.email, staff.role, hashPin(pin)],
      );
      teacherByEmail.set(staff.email, teacherId);
      result.credentials.push({
        full_name: staff.full_name,
        email: staff.email,
        teacher_id: teacherId,
        pin,
      });
      result.counts.staff_created += 1;
    }

    // Classes: one per distinct grade + stream used by learners or the timetable.
    const classKey = (grade: string, stream: string) => `${grade}\u0000${stream}`.toLowerCase();
    const wanted = new Map<string, { grade: string; stream: string }>();
    for (const learner of parsed.learners) {
      wanted.set(classKey(learner.grade, learner.stream), { grade: learner.grade, stream: learner.stream });
    }
    for (const lesson of parsed.timetable) {
      wanted.set(classKey(lesson.grade, lesson.stream), { grade: lesson.grade, stream: lesson.stream });
    }
    const classIds = new Map<string, string>();
    for (const [key, { grade, stream }] of wanted) {
      const existing = await client.query<{ class_id: string }>(
        `SELECT class_id FROM classes
         WHERE school_id = $1 AND academic_year = $2
           AND lower(grade_level) = lower($3) AND lower(stream_label) = lower($4)`,
        [schoolId, year, grade, stream],
      );
      if (existing.rows[0]) {
        classIds.set(key, existing.rows[0].class_id);
        continue;
      }
      const classId = id("C");
      await client.query(
        `INSERT INTO classes (class_id, school_id, grade_level, stream_label, academic_year)
         VALUES ($1, $2, $3, $4, $5)`,
        [classId, schoolId, grade, stream, year],
      );
      classIds.set(key, classId);
      result.counts.classes_created += 1;
    }

    // Learners and their enrolment this year, keyed by admission number.
    for (const learner of parsed.learners) {
      const classId = classIds.get(classKey(learner.grade, learner.stream))!;
      const existing = await client.query<{ learner_id: string }>(
        "SELECT learner_id FROM learners WHERE school_id = $1 AND external_ref = $2",
        [schoolId, learner.admission_number],
      );
      let learnerId = existing.rows[0]?.learner_id;
      if (learnerId) {
        await client.query("UPDATE learners SET display_name = $1 WHERE learner_id = $2", [
          learner.full_name,
          learnerId,
        ]);
        result.counts.learners_updated += 1;
      } else {
        learnerId = id("L");
        await client.query(
          `INSERT INTO learners (learner_id, display_name, school_id, external_ref)
           VALUES ($1, $2, $3, $4)`,
          [learnerId, learner.full_name, schoolId, learner.admission_number],
        );
        result.counts.learners_created += 1;
      }
      await client.query(
        `INSERT INTO learner_enrollments
           (learner_id, class_id, school_id, academic_year, enrolment_status, enrolled_from)
         VALUES ($1, $2, $3, $4, 'Active', $5)
         ON CONFLICT (learner_id, academic_year)
         DO UPDATE SET class_id = EXCLUDED.class_id, enrolment_status = 'Active', enrolled_to = NULL`,
        [learnerId, classId, schoolId, year, startOfYear],
      );
    }

    // Timetable: who teaches which class when. This is what lets a teacher open a learner.
    for (const lesson of parsed.timetable) {
      const teacherId = teacherByEmail.get(lesson.teacher_email);
      if (!teacherId) {
        result.errors.push({
          file: "timetable",
          row: lesson.row,
          message: `${lesson.teacher_email} is not in your staff list. Add them to staff.csv first.`,
        });
        continue;
      }
      await client.query(
        `INSERT INTO timetable_assignments
           (timetable_assignment_id, school_id, class_id, teacher_id, academic_year, weekday,
            period_number, start_time, end_time, subject, valid_from)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (class_id, academic_year, weekday, period_number, valid_from)
         DO UPDATE SET teacher_id = EXCLUDED.teacher_id, start_time = EXCLUDED.start_time,
                       end_time = EXCLUDED.end_time, subject = EXCLUDED.subject, valid_to = NULL`,
        [
          id("TA"),
          schoolId,
          classIds.get(classKey(lesson.grade, lesson.stream))!,
          teacherId,
          year,
          lesson.weekday,
          lesson.period,
          lesson.start,
          lesson.end,
          lesson.subject,
          startOfYear,
        ],
      );
      result.counts.timetable_lessons += 1;
    }

    if (result.errors.length > 0 || mode === "preview") {
      await client.query("ROLLBACK");
      result.ok = result.errors.length === 0;
      // Nothing was saved, so the generated PINs do not exist. Never show them.
      result.credentials = [];
      return result;
    }

    await client.query(
      "INSERT INTO data_imports (school_id, created_by, summary) VALUES ($1, $2, $3)",
      [schoolId, admin.teacher_id, JSON.stringify(result.counts)],
    );
    await client.query(
      "UPDATE schools SET setup_completed_at = COALESCE(setup_completed_at, NOW()) WHERE school_id = $1",
      [schoolId],
    );
    await client.query("COMMIT");
    result.ok = true;
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
