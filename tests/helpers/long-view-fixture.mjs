// A learner (L1) with enough tested, multi-teacher, multi-term evidence for the
// pathway gate: reviewed observations from two teachers across two academic years,
// plus a completed classroom test with a recorded outcome.
import { insertObservation, isoDate, seedTwoYearSchool } from "./pglite-db.mjs";

export async function seedLongViewLearner(pool) {
  const years = await seedTwoYearSchool(pool);
  const ids = [];
  const lastYear = [
    ["2-10", "Organised the group materials without being asked."],
    ["3-14", "Suggested a plan to the group and others followed it."],
  ];
  for (const [monthDay, text] of lastYear) {
    ids.push(
      await insertObservation(pool, {
        learner_id: "L1",
        teacher_id: "T_PREV",
        class_id: "C_PREV",
        academic_year: years.lastYear,
        date: `${years.lastYear}-${monthDay.padStart(5, "0")}`,
        term: "Term 1",
        text,
        context: monthDay === "2-10" ? "Science practical" : "Group project",
      }),
    );
  }
  for (const [offset, text, context] of [
    [-60, "Took the lead in sharing out roles during group work.", "Group work"],
    [-30, "Helped two classmates finish their part of the task.", "Maths groups"],
  ]) {
    ids.push(
      await insertObservation(pool, {
        learner_id: "L1",
        teacher_id: "T_CUR",
        class_id: "C_CUR",
        academic_year: years.thisYear,
        date: isoDate(offset),
        term: "Term 3",
        text,
        context,
      }),
    );
  }
  const outcomeId = await insertObservation(pool, {
    observation_id: "OBS-OUTCOME",
    learner_id: "L1",
    teacher_id: "T_CUR",
    class_id: "C_CUR",
    academic_year: years.thisYear,
    date: isoDate(-10),
    term: "Term 3",
    type: "test_result",
    text: "With no assigned leader, organised the group and checked everyone had a role.",
    context: "Leaderless group task",
  });
  await pool.query(
    `INSERT INTO activity_tests (
       test_id, learner_id, suggested_activity, activity_date, conducting_teacher_id, status,
       accepted_at, completed_at, outcome_observation_id, exploration_question, hypothesis)
     VALUES ('TEST-DONE', 'L1', 'Leaderless group task', $1::date, 'T_CUR', 'COMPLETED',
             NOW(), NOW(), $2, 'Does the learner organise a group without an assigned role?',
             'The learner may take organising roles across settings.')`,
    [isoDate(-10), outcomeId],
  );
  return { years, observationIds: ids, outcomeId, testId: "TEST-DONE" };
}

/** A model reply for the pathway note that cites real IDs. */
export function validNoteReply(observationIds, testId) {
  return JSON.stringify({
    sentences: [
      {
        text: "Across two school years, Amani was observed organising group tasks and sharing out roles.",
        citations: [observationIds[0], observationIds[2]],
      },
      {
        text: "When a group task was tried with no assigned leader, Amani organised the group and checked everyone had a role.",
        citations: [testId],
      },
    ],
    limitations: ["These are a few classroom observations and one activity, not a complete picture."],
  });
}
