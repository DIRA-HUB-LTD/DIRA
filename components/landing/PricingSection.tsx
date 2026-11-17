import Link from "next/link";

const SALES = "mailto:sales@dirahub.org";

const INCLUDED = [
  "After-lesson calls to any phone",
  "Activity suggestions and evidence cards",
  "Hosting, storage and backups",
  "Training and support",
];

/** Pricing: private schools, public schools through partners, and custom arrangements. */
export default function PricingSection() {
  return (
    <section aria-labelledby="pricing-heading">
      <h2 id="pricing-heading" className="text-2xl font-bold text-dira-teal-deep dark:text-gray-50">
        Pricing
      </h2>
      <p className="mt-2 max-w-2xl text-gray-700 dark:text-gray-300">
        One simple price per learner, per term, because that is how schools budget. No per-teacher
        fees, and no call charges for teachers.
      </p>
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <article className="flex flex-col rounded-xl border-2 border-dira-teal bg-white p-6 dark:bg-gray-900">
          <h3 className="text-lg font-semibold text-dira-teal-deep dark:text-gray-50">Private schools</h3>
          <p className="mt-3">
            <span className="text-4xl font-bold text-gray-900 dark:text-gray-50">KSh 200</span>
            <span className="ml-1 text-sm text-gray-600 dark:text-gray-400">per learner, per term</span>
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Capped at KSh 80,000 per school per term. One-off onboarding of KSh 20,000.
          </p>
          <ul className="mt-4 flex-1 space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
            {INCLUDED.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true" className="text-dira-teal">✓</span>
                {item}
              </li>
            ))}
          </ul>
          <Link
            href="/sign-up"
            className="mt-6 rounded-md bg-dira-teal px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-dira-teal-deep"
          >
            Open an account
          </Link>
        </article>

        <article className="flex flex-col rounded-xl border border-dira-teal/15 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <h3 className="text-lg font-semibold text-dira-teal-deep dark:text-gray-50">Public schools</h3>
          <p className="mt-3">
            <span className="text-4xl font-bold text-gray-900 dark:text-gray-50">KSh 60</span>
            <span className="ml-1 text-sm text-gray-600 dark:text-gray-400">per learner, per term</span>
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Through county governments and education partners, never from a school&apos;s capitation.
          </p>
          <ul className="mt-4 flex-1 space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
            {INCLUDED.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true" className="text-dira-teal">✓</span>
                {item}
              </li>
            ))}
          </ul>
          <a
            href={`${SALES}?subject=DIRA%20for%20public%20schools`}
            className="mt-6 rounded-md border-2 border-dira-teal px-4 py-2.5 text-center text-sm font-semibold text-dira-teal hover:bg-dira-teal/5 dark:text-dira-amber"
          >
            Contact sales
          </a>
        </article>

        <article className="flex flex-col rounded-xl bg-dira-teal p-6 text-white">
          <h3 className="text-lg font-semibold">Custom</h3>
          <p className="mt-3 text-4xl font-bold">Let&apos;s talk</p>
          <p className="mt-1 text-sm text-white/85">
            School networks, counties, NGOs, and tutors or teachers working on their own.
          </p>
          <p className="mt-4 flex-1 text-sm text-white/90">
            Tell us how many learners and schools, and how you would like to roll DIRA out. We will
            put together a plan and a price that fits.
          </p>
          <a
            href={`${SALES}?subject=DIRA%20custom%20pricing`}
            className="mt-6 rounded-md bg-dira-amber px-4 py-2.5 text-center text-sm font-semibold text-dira-teal-deep hover:bg-dira-amber-deep"
          >
            Contact sales
          </a>
        </article>
      </div>
    </section>
  );
}
