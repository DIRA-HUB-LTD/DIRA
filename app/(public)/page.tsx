import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import DemoAccessButton from "@/components/landing/DemoAccessButton";
import DemoCallDialog from "@/components/voice/DemoCallDialog";
import { getSignedInTeacher } from "@/lib/auth/teacher-session";
import { isProductionPublicDemoVoiceEnabled } from "@/lib/services/voice-config";

export const dynamic = "force-dynamic";

/** Jobs to be done: the situation a teacher is in, what they want, and what that gets them. */
const JOBS = [
  {
    when: "When a learner has been quiet all term",
    want: "I want to notice them before the year ends",
    so: "so no child slips through because nobody happened to look.",
    how: "Every fortnight DIRA gives each teacher a short focus list: the learners with the least in the record. Observing them ticks them off. The list is stable, so it is a habit, not a nag.",
  },
  {
    when: "When I have just finished a lesson",
    want: "I want to record what I saw in under a minute",
    so: "so the moment is not lost by Friday.",
    how: "Type a sentence, or let DIRA phone you after the lesson and turn what you say into a draft you review. DIRA keeps your words exactly as you said them; it never rewrites a child.",
  },
  {
    when: "When I am not sure what I am seeing",
    want: "I want a small, safe thing to try next",
    so: "so I can check rather than guess.",
    how: "When observations point the same way but the evidence is thin, DIRA suggests one short classroom activity to test it, with the sources it drew on. You accept or reject it. Nothing runs without you.",
  },
  {
    when: "When a learner moves to a new teacher, class or school",
    want: "I want what we have seen over the years to travel with them",
    so: "so the next adult does not start from zero.",
    how: "Each learner has an evidence card that spans years and teachers, every claim tied to a recorded observation. When there is enough corroborated evidence, a named teacher signs a short summary. DIRA never labels a child and never sends anything on its own.",
  },
];

const PROMISES = [
  ["No labels, ever", "DIRA describes what was seen. It does not diagnose, rank or predict a child."],
  ["Every claim cited", "Every sentence in a summary points to the observation it came from. Uncited claims are rejected."],
  ["A person signs", "Only a named, signed-in teacher can edit and sign a summary. DIRA drafts; people decide."],
  ["Nothing leaves on its own", "DIRA never sends a summary to anyone. Sharing is a human act, outside the system."],
];

export default async function LandingPage() {
  const teacher = await getSignedInTeacher();
  if (teacher) redirect("/this-week");
  const demoCalls = isProductionPublicDemoVoiceEnabled();

  return (
    <div className="space-y-20">
      {/* Hero */}
      <section className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-dira-amber-deep">
            For schools and for teachers working alone
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-tight text-dira-teal-deep dark:text-gray-50 sm:text-5xl">
            Evidence for every learner&apos;s next step.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-gray-700 dark:text-gray-300">
            DIRA helps teachers notice every child, record what they see in their own words, and
            build a cited, signed picture of each learner that lasts across years and teachers.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/sign-up"
              className="rounded-md bg-dira-teal px-5 py-3 text-sm font-semibold text-white hover:bg-dira-teal-deep"
            >
              Open an account
            </Link>
            <DemoAccessButton />
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            The demo uses synthetic learners only. No real child&apos;s data is shown.
          </p>
        </div>
        <Image
          src="/images/logo.png"
          alt=""
          width={260}
          height={260}
          priority
          className="mx-auto hidden md:block"
        />
      </section>

      {/* Jobs to be done */}
      <section>
        <h2 className="text-2xl font-bold text-dira-teal-deep dark:text-gray-50">What DIRA is for</h2>
        <p className="mt-2 max-w-2xl text-gray-700 dark:text-gray-300">
          Each of these is a job a teacher already has. DIRA exists to make it easier to do well.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {JOBS.map((job) => (
            <article
              key={job.when}
              className="flex flex-col rounded-xl border border-dira-teal/15 bg-white p-6 shadow-xs dark:border-gray-800 dark:bg-gray-900"
            >
              <p className="text-sm font-medium text-dira-amber-deep">{job.when},</p>
              <h3 className="mt-1 text-lg font-semibold text-dira-teal-deep dark:text-gray-50">
                {job.want}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">{job.so}</p>
              <p className="mt-4 flex-1 text-sm leading-relaxed text-gray-700 dark:text-gray-300">{job.how}</p>
              <Link
                href="/sign-up"
                className="mt-5 inline-block text-sm font-semibold text-dira-teal underline underline-offset-4 dark:text-dira-amber"
              >
                Open an account →
              </Link>
            </article>
          ))}
        </div>
      </section>

      {/* Who it is for */}
      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl bg-dira-teal p-6 text-white">
          <h2 className="text-xl font-semibold">DIRA for Schools</h2>
          <p className="mt-2 text-sm leading-relaxed text-white/90">
            Upload your staff, learners and timetable once. Teachers sign in with a PIN or with
            Microsoft. Every observation stays inside your school. The school keeps the long view
            even as teachers change.
          </p>
          <Link
            href="/sign-up"
            className="mt-4 inline-block rounded-md bg-dira-amber px-4 py-2 text-sm font-semibold text-dira-teal-deep hover:bg-dira-amber-deep"
          >
            Register a school
          </Link>
        </div>
        <div className="rounded-xl bg-dira-leaf/15 p-6 dark:bg-gray-900">
          <h2 className="text-xl font-semibold text-dira-teal-deep dark:text-gray-50">DIRA for Teachers</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            A tutor, a homeschool teacher, or a teacher working on your own. Your own workspace,
            your own learners. Connect your calendar so DIRA knows when your sessions happen, and
            everything else works the same.
          </p>
          <Link
            href="/sign-up"
            className="mt-4 inline-block rounded-md bg-dira-teal px-4 py-2 text-sm font-semibold text-white hover:bg-dira-teal-deep"
          >
            Start on your own
          </Link>
        </div>
      </section>

      {/* Promises */}
      <section>
        <h2 className="text-2xl font-bold text-dira-teal-deep dark:text-gray-50">How DIRA stays honest</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PROMISES.map(([title, body]) => (
            <div key={title} className="rounded-lg border-l-4 border-dira-amber bg-white p-4 dark:bg-gray-900">
              <h3 className="font-semibold text-dira-teal-deep dark:text-gray-50">{title}</h3>
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Try it */}
      <section className="rounded-xl border border-dira-teal/15 bg-white p-6 dark:border-gray-800 dark:bg-gray-900 sm:p-8">
        <h2 className="text-2xl font-bold text-dira-teal-deep dark:text-gray-50">Try it before you decide</h2>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="font-semibold">Use the app with synthetic data</h3>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              Open a demonstration school of made-up learners and walk through the week, the
              observations, a suggested activity and an evidence card. Anyone can look; what you
              log there is visible to other visitors, so keep it to practice.
            </p>
            <div className="mt-3">
              <DemoAccessButton />
            </div>
          </div>
          <div>
            <h3 className="font-semibold">Get the after-lesson call on your own phone</h3>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              Hear how DIRA asks a teacher about a lesson. One demo call per phone number every 24
              hours, so everyone who wants to try it can.
            </p>
            <div className="mt-3">
              {demoCalls ? (
                <DemoCallDialog />
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Demo calls are switched off on this server.
                </p>
              )}
            </div>
          </div>
        </div>
        <p className="mt-6 text-sm">
          Ready?{" "}
          <Link href="/sign-up" className="font-semibold text-dira-teal underline dark:text-dira-amber">
            Open an account
          </Link>{" "}
          or{" "}
          <Link href="/sign-in" className="font-semibold text-dira-teal underline dark:text-dira-amber">
            sign in
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
