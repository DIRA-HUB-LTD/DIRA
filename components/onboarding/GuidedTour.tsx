"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Me {
  teacher: { display_name: string; role: "admin" | "teacher"; workspace_kind: "school" | "personal" } | null;
  tour_pending: boolean;
  is_demo: boolean;
}

interface Step {
  title: string;
  body: string;
  href?: string;
  link?: string;
}

const TEACHER_STEPS: Step[] = [
  {
    title: "This week: who to notice",
    body: "Every fortnight DIRA picks a few of your learners who have had the least attention in the record, so nobody slips through quietly. Observing them ticks them off; the list stays stable until the next fortnight.",
    href: "/this-week",
    link: "Open This Week",
  },
  {
    title: "Log what you saw, in your own words",
    body: "After a lesson, write one or two sentences about what a learner did. DIRA keeps your words exactly as you wrote them. If calls are switched on, DIRA can also phone you after a lesson and turn your answer into a draft you review.",
    href: "/observation-log",
    link: "Log an observation",
  },
  {
    title: "Try this: check a pattern rather than guess",
    body: "When several observations point the same way but the evidence is thin, DIRA suggests one small classroom activity to test it, with the sources it drew on. You accept, reject or complete it. Nothing runs without you.",
  },
  {
    title: "Evidence: the long view",
    body: "Each learner has an evidence card that spans years and teachers, with every claim tied to a recorded observation. When there is enough corroborated evidence, DIRA drafts a short summary that only a named, signed-in teacher can edit and sign. DIRA never labels a child and never sends anything on its own.",
  },
];

const SCHOOL_ADMIN_FIRST: Step = {
  title: "You are the school administrator",
  body: "Upload your staff, learners and timetable once (there is a template for each). Teachers then sign in with the PIN you give them, or with Microsoft if your school uses it. You can re-upload at any time; existing records are updated, not duplicated.",
  href: "/welcome",
  link: "Upload school data",
};

const PERSONAL_FIRST: Step = {
  title: "Your own workspace",
  body: "You are the only member. Connect your calendar through Keeper so DIRA knows when your sessions happen; it reads timing only, never event details. Learners you add are yours alone.",
  href: "/welcome",
  link: "Connect your calendar",
};

/** Shown once, on a teacher's first sign-in. Skip closes it for good. */
export default function GuidedTour() {
  const [me, setMe] = useState<Me | null>(null);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: Me | null) => {
        if (active && value?.teacher && value.tour_pending) {
          setMe(value);
          setOpen(true);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!open || !me?.teacher) return null;

  const first =
    me.teacher.workspace_kind === "personal"
      ? PERSONAL_FIRST
      : me.teacher.role === "admin"
        ? SCHOOL_ADMIN_FIRST
        : null;
  const steps = first ? [first, ...TEACHER_STEPS] : TEACHER_STEPS;
  const step = steps[index];
  const last = index === steps.length - 1;

  async function finish() {
    setOpen(false);
    await fetch("/api/workspace/tour", { method: "POST" }).catch(() => undefined);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4">
          <p className="text-xs font-medium uppercase tracking-wide text-dira-teal dark:text-dira-amber">
            {me.is_demo ? "Demo workspace" : `Welcome, ${me.teacher.display_name.split(" ")[0]}`} · {index + 1} of{" "}
            {steps.length}
          </p>
          <button
            type="button"
            onClick={finish}
            className="text-sm font-medium text-gray-500 underline hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
          >
            Skip tour
          </button>
        </div>
        <h2 id="tour-title" className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
          {step.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">{step.body}</p>
        {step.href && step.link && (
          <Link
            href={step.href}
            onClick={finish}
            className="mt-3 inline-block text-sm font-medium text-dira-teal underline dark:text-dira-amber"
          >
            {step.link}
          </Link>
        )}
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
            disabled={index === 0}
            className="text-sm text-gray-600 disabled:opacity-40 dark:text-gray-300"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => (last ? finish() : setIndex((value) => value + 1))}
            className="rounded-md bg-dira-teal px-4 py-2 text-sm font-medium text-white hover:bg-dira-teal-deep"
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
