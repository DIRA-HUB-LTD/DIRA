import { connection } from "next/server";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { getPool } from "@/lib/db/client";
import { resolveTeacherContext } from "@/lib/auth/teacher-context";
import {
  getFocusList,
  localDate,
  type FocusReason,
} from "@/lib/services/focus-rotation";

const REASON_LABEL: Record<FocusReason, string> = {
  no_observation_this_year: "No observation yet this year",
  not_observed_by_this_teacher: "You have not observed them yet",
  least_recently_observed: "Longest since last observation",
};

function formatLastObserved(value: Date | null): string {
  return value ? new Date(value).toLocaleDateString() : "No observations recorded yet";
}

function formatPeriodDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export default async function ThisWeekPage() {
  await connection();


  try {
    const context = await resolveTeacherContext();
    if (!context) {
      return (
        <Card className="p-6">
          <h1 className="text-xl font-semibold">Focus list unavailable</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Add a teacher record before viewing the single-teacher demo.
          </p>
        </Card>
      );
    }

    const school = await getPool().query<{ timezone: string | null }>(
      "SELECT timezone FROM schools WHERE school_id = $1",
      [context.school_id],
    );
    const today = localDate(new Date(), school.rows[0]?.timezone);
    const focus = await getFocusList(context, today);
    const done = focus.learners.filter((learner) => learner.observed_this_period).length;

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            This fortnight&apos;s focus
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {formatPeriodDate(focus.period_start)} – {formatPeriodDate(focus.period_end)}. Keep an
            eye out for these learners from your classes. You do not need to do anything
            differently—just notice what you normally notice.
          </p>
          {focus.learners.length > 0 && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {done} of {focus.learners.length} observed so far this fortnight. The list stays the
              same until the fortnight ends, so nobody is skipped.
            </p>
          )}
        </div>

        {focus.learners.length === 0 ? (
          <Card className="p-6">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              No currently enrolled learners were found in your classes. Check that the timetable
              and enrolments have been imported.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {focus.learners.map((learner) => (
              <Card key={learner.learner_id} className="p-6">
                <div className="space-y-4">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {learner.display_name}
                      </h2>
                      {learner.observed_this_period && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-100">
                          Observed ✓
                        </span>
                      )}
                    </div>
                    {learner.grade_level && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {learner.grade_level} · Stream {learner.stream_label}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Why: {REASON_LABEL[learner.reason]}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Last observed</p>
                    <p className="text-sm text-gray-900 dark:text-gray-100">
                      {formatLastObserved(learner.last_observed_at)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1">
                      <Link href={`/learners/${encodeURIComponent(learner.learner_id)}`}>
                        View Record
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline-solid" className="flex-1">
                      <Link href={`/learners/${encodeURIComponent(learner.learner_id)}/log-observation`}>
                        Log Observation
                      </Link>
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  } catch (error) {
    console.error("Failed to load the focus list:", error);
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Focus list unavailable</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Could not load learners from PostgreSQL. Verify the database is healthy, migrated
          (npm run db:migrate), and seeded.
        </p>
      </Card>
    );
  }
}
