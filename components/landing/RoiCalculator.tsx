"use client";

import Link from "next/link";
import { useState } from "react";

// Planning figures, shown to the visitor in the result so nothing is hidden.
const MINUTES_WITH_DIRA = 6; // confirm a couple of drafts, read the card, write the comment
const PRICE_PER_LEARNER = 200;
const PRICE_CAP_PER_SCHOOL = 80_000;

const WHERE_NOTES_LIVE = [
  { value: "memory", label: "Mostly in teachers' heads", reply: "Memory is where most of it lives today. DIRA writes it down at the moment it happens, so nothing depends on remembering." },
  { value: "notebook", label: "In notebooks", reply: "Notebooks get lost and can't be searched. DIRA keeps every note with the learner, dated, and easy to find." },
  { value: "sheet", label: "In Excel or Google Sheets", reply: "A spreadsheet needs someone to type into it after a long day. DIRA calls the teacher after the lesson instead, on any phone." },
  { value: "system", label: "In our school system", reply: "School systems hold marks and fees. DIRA holds what the teacher saw, and suggests what to try next." },
  { value: "nowhere", label: "Nowhere consistent", reply: "Most schools are here. DIRA turns noticing into a routine, a few learners each fortnight." },
] as const;

const CARRY_OVER = [
  { value: "0", label: "Almost nothing" },
  { value: "0.25", label: "A little" },
  { value: "0.5", label: "About half" },
  { value: "0.75", label: "Most of it" },
] as const;

const CARRY_TEXT: Record<string, string> = {
  "0": "almost nothing",
  "0.25": "only a little",
  "0.5": "about half",
  "0.75": "most",
};

const KSH = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  min = 0,
  max = 500,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{hint}</span>}
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || 0)))}
        className="mt-2 w-32 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
      />
    </label>
  );
}

function Choice<T extends string>({
  name,
  label,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | "";
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${
              value === option.value
                ? "border-dira-teal bg-dira-teal text-white"
                : "border-gray-300 bg-white text-gray-800 hover:border-dira-teal dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Six short questions in three steps, then a rough picture of what changes for the school. */
export default function RoiCalculator() {
  const [step, setStep] = useState(0);
  const [classSize, setClassSize] = useState(40);
  const [describable, setDescribable] = useState(10);
  const [whereNotes, setWhereNotes] = useState<(typeof WHERE_NOTES_LIVE)[number]["value"] | "">("");
  const [minutesToday, setMinutesToday] = useState(20);
  const [teachers, setTeachers] = useState(10);
  const [carry, setCarry] = useState<(typeof CARRY_OVER)[number]["value"] | "">("");
  const [termFee, setTermFee] = useState(15_000);
  const [hourlyRate, setHourlyRate] = useState(500);

  const learners = classSize * teachers;
  const unseen = Math.max(0, classSize - Math.min(describable, classSize)) * teachers;
  const hoursToday = (minutesToday * learners) / 60;
  const hoursSaved = (Math.max(0, minutesToday - MINUTES_WITH_DIRA) * learners) / 60;
  const price = Math.min(PRICE_PER_LEARNER * learners, PRICE_CAP_PER_SCHOOL);
  const breakEven = Math.max(1, Math.ceil(price / termFee));
  const reply = WHERE_NOTES_LIVE.find((option) => option.value === whereNotes)?.reply;

  const canContinue =
    step === 0 ? classSize > 0 : step === 1 ? whereNotes !== "" : teachers > 0 && carry !== "";

  return (
    <div className="rounded-xl border border-dira-teal/15 bg-white p-6 dark:border-gray-800 dark:bg-gray-900 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-dira-teal-deep dark:text-gray-50">
          What would DIRA change at your school?
        </h2>
        {step < 3 && (
          <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">Step {step + 1} of 3</span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        Six quick questions. Rough numbers are fine.
      </p>

      {step === 0 && (
        <div className="mt-6 space-y-5">
          <NumberField
            id="roi-class"
            label="How many learners are in a typical class?"
            value={classSize}
            onChange={setClassSize}
            min={1}
            max={120}
          />
          <NumberField
            id="roi-describe"
            label="How many of them could the class teacher describe right now, in one specific sentence, from memory?"
            hint="Not their marks. Something they did or how they learn."
            value={describable}
            onChange={setDescribable}
            max={120}
          />
        </div>
      )}

      {step === 1 && (
        <div className="mt-6 space-y-5">
          <Choice
            name="roi-where"
            label="Where do teachers' observations about learners live today?"
            options={WHERE_NOTES_LIVE}
            value={whereNotes}
            onChange={setWhereNotes}
          />
          {reply && <p className="rounded-md bg-dira-cream p-3 text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-200">{reply}</p>}
          <NumberField
            id="roi-minutes"
            label="Minutes a teacher spends per learner each term on report comments and assessment notes"
            hint="Including the time spent trying to remember what happened."
            value={minutesToday}
            onChange={setMinutesToday}
            max={180}
          />
        </div>
      )}

      {step === 2 && (
        <div className="mt-6 space-y-5">
          <NumberField
            id="roi-teachers"
            label="How many class teachers are there in your school?"
            value={teachers}
            onChange={setTeachers}
            min={1}
            max={200}
          />
          <Choice
            name="roi-carry"
            label="When learners move to a new class, how much of what the last teacher knew reaches the new one?"
            options={CARRY_OVER}
            value={carry}
            onChange={setCarry}
          />
        </div>
      )}

      {step === 3 && (
        <div className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-dira-cream p-5 dark:bg-gray-800">
              <p className="text-xs font-semibold uppercase tracking-wide text-dira-amber-deep">The quiet middle</p>
              <p className="mt-1 text-4xl font-bold text-dira-teal-deep dark:text-gray-50">
                {KSH.format(unseen)} <span className="text-lg font-semibold">learners</span>
              </p>
              <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                that no teacher could describe today, out of {KSH.format(learners)}.
              </p>
              <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                Not the top of the class, not the ones who struggle: the middle. With DIRA each teacher
                gets ten learners every fortnight, starting with whoever has gone longest unseen, so every
                learner comes up at least once every {Math.max(2, Math.ceil(classSize / 10) * 2)} weeks.
              </p>
            </div>
            <div className="rounded-lg bg-dira-cream p-5 dark:bg-gray-800">
              <p className="text-xs font-semibold uppercase tracking-wide text-dira-amber-deep">Starting from zero</p>
              <p className="mt-1 text-4xl font-bold text-dira-teal-deep dark:text-gray-50">Every learner</p>
              <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                meets a new teacher each year who knows {CARRY_TEXT[carry || "0"]} of what the last one knew.
              </p>
              <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                That is all {KSH.format(learners)} of your learners, the strongest included. With DIRA the
                record moves up with them: what was wondered, what was tried, and what happened.
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-dira-teal p-5 text-white">
            <p className="text-xs font-semibold uppercase tracking-wide text-dira-amber">Time back</p>
            <p className="mt-1 text-4xl font-bold">
              {KSH.format(Math.round(hoursSaved))} hours <span className="text-lg font-semibold">every term</span>
            </p>
            <p className="mt-2 text-sm text-white/90">
              About {KSH.format(Math.round(hoursSaved / teachers))} hours per teacher, out of{" "}
              {KSH.format(Math.round(hoursToday))} hours your school spends on comments and records today.
              That is time for lesson planning, curriculum development, teacher training, and one-to-one
              time with the learners who need it most. And the comments are written from dated evidence,
              not from memory.
            </p>
          </div>

          <div className="rounded-lg border border-dira-teal/20 p-5 dark:border-gray-700">
            <p className="text-sm font-semibold text-dira-teal-deep dark:text-gray-50">What it&apos;s worth</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <p className="font-medium text-gray-900 dark:text-gray-100">For your school</p>
                <p className="mt-1">
                  Parents stay where their child is truly known. For {KSH.format(learners)} learners DIRA
                  costs KSh {KSH.format(price)} a term
                  {price === PRICE_CAP_PER_SCHOOL ? " (the whole-school cap)" : ""}, so it pays for itself
                  if it helps you keep or win{" "}
                  <strong>{breakEven} {breakEven === 1 ? "learner" : "learners"}</strong>.
                </p>
                <label className="mt-2 block text-xs text-gray-600 dark:text-gray-400">
                  Your fee per learner per term: KSh{" "}
                  <input
                    type="number"
                    min={1}
                    value={termFee}
                    onChange={(event) => setTermFee(Math.max(1, Number(event.target.value) || 1))}
                    aria-label="Your fee per learner per term in shillings"
                    className="w-24 rounded border border-gray-300 bg-white px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-900"
                  />
                </label>
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <p className="font-medium text-gray-900 dark:text-gray-100">For private tutors and coaches</p>
                <p className="mt-1">
                  Your time is your income. {KSH.format(Math.round(hoursSaved))} hours a term is about{" "}
                  <strong>KSh {KSH.format(Math.round(hoursSaved * hourlyRate))}</strong> of sessions you
                  could teach instead of writing up notes.
                </p>
                <label className="mt-2 block text-xs text-gray-600 dark:text-gray-400">
                  Your rate per hour: KSh{" "}
                  <input
                    type="number"
                    min={0}
                    value={hourlyRate}
                    onChange={(event) => setHourlyRate(Math.max(0, Number(event.target.value) || 0))}
                    aria-label="Your hourly rate in shillings"
                    className="w-20 rounded border border-gray-300 bg-white px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-900"
                  />{" "}
                  (working alone? answer 1 for the number of teachers)
                </label>
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Rough estimates from your answers. We assume about {MINUTES_WITH_DIRA} minutes per learner
            per term with DIRA.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/sign-up" className="rounded-md bg-dira-teal px-5 py-3 text-sm font-semibold text-white hover:bg-dira-teal-deep">
              Open an account
            </Link>
            <a
              href="mailto:sales@dirahub.org?subject=DIRA%20for%20our%20school"
              className="rounded-md border-2 border-dira-amber px-5 py-3 text-sm font-semibold text-dira-teal-deep hover:bg-dira-amber/10 dark:text-dira-amber"
            >
              Talk to us
            </a>
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((current) => current - 1)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {step === 3 ? "Change my answers" : "Back"}
          </button>
        )}
        {step < 3 && (
          <button
            type="button"
            disabled={!canContinue}
            onClick={() => setStep((current) => current + 1)}
            className="rounded-md bg-dira-teal px-5 py-2 text-sm font-semibold text-white hover:bg-dira-teal-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {step === 2 ? "See what changes" : "Next"}
          </button>
        )}
      </div>
    </div>
  );
}
