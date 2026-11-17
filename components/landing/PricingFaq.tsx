const FAQ: Array<{ q: string; a: string[] }> = [
  {
    q: "What does the price per learner pay for?",
    a: [
      "Phone call credits: the short after-lesson calls DIRA places to teachers, on any phone, with no data needed.",
      "AI credits: the activity suggestions, evidence cards and draft summaries DIRA prepares for each learner.",
      "Compute and storage: secure hosting for your school's records, backups, and keeping the service running every school day.",
      "App maintenance: updates, fixes, security and new features, at no extra cost.",
      "Customer support: setting up your school, training your teachers, and help when you need it.",
    ],
  },
  {
    q: "Is there anything else to pay?",
    a: [
      "A one-off onboarding fee of KSh 20,000 for private schools covers loading your staff, learners and timetable, and training your teachers. There are no per-teacher fees, and teachers never pay for calls.",
    ],
  },
  {
    q: "Why per learner, per term?",
    a: [
      "Schools plan their budgets by term, so DIRA is priced the same way. The cap of KSh 80,000 per school per term means larger schools are never charged more than that.",
    ],
  },
  {
    q: "Who pays for public schools?",
    a: [
      "County governments and education partners, through a programme agreement. DIRA is never paid for out of a school's capitation. Contact sales to start a conversation.",
    ],
  },
  {
    q: "Do teachers need a smartphone or data bundles?",
    a: [
      "No. The after-lesson call works on any phone. Teachers who prefer to type can write notes in the browser on a phone or a computer.",
    ],
  },
  {
    q: "Does DIRA replace our school management system?",
    a: [
      "No. Your school system keeps marks, fees and attendance. DIRA keeps what teachers notice about each learner and suggests what to try next. You can load your staff, learners and timetable into DIRA from spreadsheets.",
    ],
  },
  {
    q: "Who owns the records?",
    a: [
      "Your school. Records stay inside your school's workspace. DIRA never labels or diagnoses a child, and it never sends anything to anyone on its own.",
    ],
  },
];

/** Plain-language answers about the price; customer-facing, so it lists what is covered. */
export default function PricingFaq() {
  return (
    <section aria-labelledby="faq-heading">
      <h2 id="faq-heading" className="text-2xl font-bold text-dira-teal-deep dark:text-gray-50">
        Questions about pricing
      </h2>
      <div className="mt-6 divide-y divide-gray-200 rounded-xl border border-dira-teal/15 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
        {FAQ.map((item) => (
          <details key={item.q} className="group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-gray-900 dark:text-gray-100">
              {item.q}
              <span aria-hidden="true" className="text-dira-teal transition-transform group-open:rotate-45">+</span>
            </summary>
            {item.a.length === 1 ? (
              <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">{item.a[0]}</p>
            ) : (
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-gray-700 dark:text-gray-300">
                {item.a.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </details>
        ))}
      </div>
      <p className="mt-4 text-sm text-gray-700 dark:text-gray-300">
        Something not covered here?{" "}
        <a href="mailto:sales@dirahub.org" className="font-semibold text-dira-teal underline dark:text-dira-amber">
          Email sales@dirahub.org
        </a>
        .
      </p>
    </section>
  );
}
