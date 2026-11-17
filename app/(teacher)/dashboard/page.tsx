import { connection } from "next/server";
import Card from "@/components/ui/Card";
import CallsMonthCalendar from "@/components/dashboard/CallsMonthCalendar";
import WeeklyObservationsChart from "@/components/dashboard/WeeklyObservationsChart";
import { resolveTeacherContext } from "@/lib/auth/teacher-context";
import { getSignedInTeacher } from "@/lib/auth/teacher-session";
import { loadImpactDashboard, type ImpactDashboard } from "@/lib/services/impact-dashboard";

function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}

function Stat({ value, label, detail }: { value: string; label: string; detail?: string }) {
  return (
    <Card className="p-4">
      <p className="text-3xl font-bold text-gray-900 dark:text-gray-50">{value}</p>
      <p className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-200">{label}</p>
      {detail && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{detail}</p>}
    </Card>
  );
}

function Step({ value, label, of }: { value: number; label: string; of?: number }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-gray-100 py-2 last:border-0 dark:border-gray-800">
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <span className="text-right">
        <span className="text-lg font-semibold text-gray-900 dark:text-gray-50">{value}</span>
        {of !== undefined && (
          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{percent(value, of)}</span>
        )}
      </span>
    </li>
  );
}

export default async function DashboardPage() {
  await connection();
  const context = await resolveTeacherContext();
  if (!context) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Dashboard unavailable</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Sign in to see your dashboard.</p>
      </Card>
    );
  }
  const signedIn = await getSignedInTeacher();
  const wholeSchool = signedIn?.role === "admin";

  let data: ImpactDashboard;
  try {
    data = await loadImpactDashboard({
      schoolId: context.school_id,
      teacherId: wholeSchool ? null : context.teacher_id,
    });
  } catch (error) {
    console.error("Dashboard failed to load", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Dashboard unavailable</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          The numbers could not be loaded just now. Everything else in DIRA still works; try again
          in a moment.
        </p>
      </Card>
    );
  }

  const { visibility: v, followThrough: f } = data;
  const termStart = new Date(`${v.this_term_start}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    timeZone: "UTC",
  });
  const monthName = new Date(`${data.month_start}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          {wholeSchool ? "Your whole school" : "Your classes"}: who is being seen, what was tried,
          and what happened. Every number is counted from the records in DIRA.
        </p>
      </div>

      <section aria-labelledby="seen-heading" className="space-y-3">
        <h2 id="seen-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Every learner seen
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            value={`${v.seen_this_term} of ${v.learners}`}
            label="Learners observed this term"
            detail={`${percent(v.seen_this_term, v.learners)} of your learners, since ${termStart}`}
          />
          <Stat
            value={`${v.seen_twice_this_term}`}
            label="Observed at least twice this term"
            detail="Two dated notes start to show a pattern rather than a moment"
          />
          <Stat
            value={`${v.seen_ever} of ${v.learners}`}
            label="Learners with a written record"
            detail={`${v.observations_total} observations in total, kept with each learner`}
          />
          <Stat
            value={`${v.multi_teacher}`}
            label="Seen by more than one teacher"
            detail={
              v.multi_year > 0
                ? `${v.multi_year} have evidence across two or more school years`
                : "The record stays with the learner when the teacher changes"
            }
          />
        </div>
      </section>

      <Card className="p-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Observations per week</h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          The last 12 weeks. A steady line means observation has become a routine, not something
          left for assessment week.
        </p>
        <WeeklyObservationsChart weeks={data.weeks} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">From a note to a next step</h2>
          <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
            Short classroom activities DIRA suggested, and what teachers did with them.
          </p>
          <ul>
            <Step value={f.suggested} label="Activities suggested" />
            <Step value={f.accepted} label="Accepted by a teacher" of={f.suggested} />
            <Step value={f.outcomes} label="Tried, with the outcome recorded" of={f.accepted} />
            <Step value={f.assessed} label="Outcomes assessed against the question" of={f.outcomes} />
          </ul>
          <p className="mt-3 rounded-md bg-dira-amber/15 p-3 text-sm text-gray-800 dark:bg-dira-amber/20 dark:text-gray-100">
            <strong>{f.not_enough_evidence}</strong> times DIRA said &ldquo;not enough evidence
            yet&rdquo; instead of drawing a conclusion. That is the system working: it asks for
            more observation before it says anything about a child.
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Summaries a teacher signed</h2>
          <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
            When there is enough evidence, DIRA drafts a short summary. Only a named teacher can
            sign it, and DIRA never sends it.
          </p>
          <ul>
            <Step value={f.summaries_drafted} label="Summaries drafted from the evidence" />
            <Step value={f.summaries_signed} label="Edited and signed by a teacher" of={f.summaries_drafted} />
          </ul>
          <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-gray-100">How DIRA measures impact</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-600 dark:text-gray-400">
            <li>Visibility: how many learners have at least two dated observations each term.</li>
            <li>Follow-through: suggested, accepted, tried, and assessed.</li>
            <li>The long view: evidence from more than one teacher and more than one year.</li>
            <li>No labels: DIRA records what was seen. It never ranks or diagnoses a child.</li>
          </ul>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">After-lesson calls · {monthName}</h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          {wholeSchool ? "Calls for every teacher in your school" : "Your calls"}, from the timetable.
        </p>
        <CallsMonthCalendar monthStart={data.month_start} today={data.today} items={data.calendar} />
      </Card>
    </div>
  );
}
