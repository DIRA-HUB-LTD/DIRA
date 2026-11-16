"use client";

import { useState } from "react";

interface Choice {
  id: string;
  name: string;
}

interface OpenTest {
  test_id: string;
  learner_id: string;
  label: string;
  activity_date: string;
}

/**
 * Confirm a call draft: pick the learner, and, when that learner has an accepted test
 * waiting for its outcome, optionally record this as the test's outcome. The test list
 * follows the chosen learner, so a draft can never be tied to someone else's test (the
 * server checks this again).
 */
export default function DraftConfirmForm({
  draftId,
  choices,
  tests,
  action,
}: {
  draftId: string;
  choices: Choice[];
  tests: OpenTest[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [learnerId, setLearnerId] = useState(choices.length === 1 ? choices[0].id : "");
  const forLearner = tests.filter((test) => test.learner_id === learnerId);
  const [chosenTest, setChosenTest] = useState<{ learner: string; test: string }>({
    learner: "",
    test: "",
  });
  // The selection only counts while it belongs to the learner shown; a single waiting
  // test is pre-selected as the likely match.
  const testId =
    chosenTest.learner === learnerId && chosenTest.test !== "__none__"
      ? chosenTest.test
      : chosenTest.learner === learnerId
        ? ""
        : forLearner.length === 1
          ? forLearner[0].test_id
          : "";

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="draftId" value={draftId} />
      <label className="sr-only" htmlFor={`learner-${draftId}`}>
        Learner
      </label>
      <select
        id={`learner-${draftId}`}
        name="learnerId"
        value={learnerId}
        onChange={(event) => setLearnerId(event.target.value)}
        className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
      >
        {choices.length !== 1 && <option value="">Choose learner…</option>}
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor={`test-${draftId}`}>
        Test this is the outcome of
      </label>
      <select
        id={`test-${draftId}`}
        name="testId"
        value={testId}
        disabled={!learnerId || forLearner.length === 0}
        onChange={(event) =>
          setChosenTest({ learner: learnerId, test: event.target.value || "__none__" })
        }
        className="max-w-xs rounded-md border border-gray-300 px-2 py-1 text-sm disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800"
      >
        <option value="">
          {!learnerId
            ? "Choose a learner first"
            : forLearner.length === 0
              ? "No test waiting for this learner"
              : "Not the outcome of a test"}
        </option>
        {forLearner.map((test) => (
          <option key={test.test_id} value={test.test_id}>
            Outcome of: {test.label.length > 70 ? `${test.label.slice(0, 67)}…` : test.label}
          </option>
        ))}
      </select>

      <button type="submit" className="rounded-md bg-dira-teal px-3 py-1 text-sm text-white hover:bg-dira-teal-deep">
        Confirm
      </button>
    </form>
  );
}
