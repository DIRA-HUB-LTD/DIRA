/**
 * Who may see a learner's history.
 *
 * Policy (DIRA_HUB_ROADMAP.md §5.2, founder decision D3):
 *   A teacher who CURRENTLY teaches a learner (an active enrolment in a class the
 *   teacher has a currently valid timetable slot for) sees that learner's FULL
 *   history at the same school: every year, every class, every teacher.
 *   History recorded at another school is never visible (it stays behind unless a
 *   guardian approves an export, which is not built yet).
 *
 * Before this module, each query only showed observations from classes the teacher
 * taught in the same academic year, so a Grade 4 teacher could not see Grade 3
 * evidence. That broke the "long view" the product promises.
 *
 * The fragment is plain SQL so every query applies the identical rule. Parameters
 * are passed by placeholder name (e.g. "$2") and never interpolated from user input.
 */
export function teacherCurrentlyTeachesLearnerSql(
  learnerIdColumn: string,
  schoolParam: string,
  teacherParam: string,
): string {
  return `EXISTS (
    SELECT 1
    FROM learner_enrollments visibility_enrollment
    JOIN timetable_assignments visibility_assignment
      ON visibility_assignment.class_id = visibility_enrollment.class_id
     AND visibility_assignment.school_id = visibility_enrollment.school_id
     AND visibility_assignment.academic_year = visibility_enrollment.academic_year
    WHERE visibility_enrollment.learner_id = ${learnerIdColumn}
      AND visibility_enrollment.school_id = ${schoolParam}
      AND visibility_enrollment.enrolment_status <> 'Withdrawn'
      AND visibility_enrollment.enrolled_from <= CURRENT_DATE
      AND (visibility_enrollment.enrolled_to IS NULL OR visibility_enrollment.enrolled_to >= CURRENT_DATE)
      AND visibility_assignment.teacher_id = ${teacherParam}
      AND visibility_assignment.valid_from <= CURRENT_DATE
      AND (visibility_assignment.valid_to IS NULL OR visibility_assignment.valid_to >= CURRENT_DATE)
  )`;
}
