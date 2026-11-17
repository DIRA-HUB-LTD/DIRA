"use client";

import Link from "next/link";
import { useState } from "react";

// Planning figures, shown to the visitor in the result so nothing is hidden.
const MINUTES_WITH_DIRA = 6; // confirm a couple of drafts, read the card, write the comment
const WORK_MINUTES_PER_MONTH = 173 * 60;
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
  const [monthlyPay, setMonthlyPay] = useState(20_000);

  const learners = classSize * teachers;
  const unseen = Math.max(0, classSize - Math.min(describable, classSize)) * teachers;
  const hoursToday = (minutesToday * learners) / 60;
  const hoursSaved = (Math.max(0, minutesToday - MINUTES_WITH_DIRA) * learners) / 60;
  const valueSaved = hoursSaved * 60 * (monthlyPay / WORK_MINUTES_PER_MONTH);
  const restartEachYear = Math.round(learners * (1 - Number(carry || 0)));
  const price = Math.min(PRICE_PER_LEARNER * learners, PRICE_CAP_PER_SCHOOL);
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
        <div className="mt-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-dira-cream p-4 dark:bg-gray-800">
              <p className="text-3xl font-bold text-dira-teal-deep dark:text-gray-50">{KSH.format(unseen)}</p>
              <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">
                learners in your school nobody could describe today: the quiet middle of every class.
                With DIRA each teacher gets a list of ten every fortnight, starting with whoever has
                gone longest unseen, so every learner comes up at least once every{" "}
                {Math.max(2, Math.ceil(classSize / 10) * 2)} weeks.
              </p>
            </div>
            <div className="rounded-lg bg-dira-cream p-4 dark:bg-gray-800">
              <p className="text-3xl font-bold text-dira-teal-deep dark:text-gray-50">
                {KSH.format(Math.round(hoursSaved))} hours
              </p>
              <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">
                back each term across your teachers (about {KSH.format(Math.round(hoursSaved / teachers))} each),
                out of {KSH.format(Math.round(hoursToday))} hours spent on comments and records today.
                Comments are written from dated evidence instead of from memory.
              </p>
            </div>
            <div className="rounded-lg bg-dira-cream p-4 dark:bg-gray-800">
              <p className="text-3xl font-bold text-dira-teal-deep dark:text-gray-50">{KSH.format(restartEachYear)}</p>
              <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">
                learners a year who start again from zero with a new teacher. With DIRA their record
                moves up with them: what was wondered, what was tried, and what happened.
              </p>
            </div>
            <div className="rounded-lg bg-dira-cream p-4 dark:bg-gray-800">
              <p className="text-3xl font-bold text-dira-teal-deep dark:text-gray-50">KSh {KSH.format(Math.round(valueSaved))}</p>
              <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">
                of teacher time each term, at a monthly pay of{" "}
                <label className="inline">
                  <span className="sr-only">Monthly teacher pay in shillings</span>
                  KSh{" "}
                  <input
                    type="number"
                    min={0}
                    value={monthlyPay}
                    onChange={(event) => setMonthlyPay(Math.max(0, Number(event.target.value) || 0))}
                    className="w-24 rounded border border-gray-300 bg-white px-1 py-0.5 text-sm dark:border-gray-600 dark:bg-gray-900"
                  />
                </label>
                .
              </p>
            </div>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            For {KSH.format(learners)} learners, DIRA would cost your school{" "}
            <strong>KSh {KSH.format(price)} a term</strong>
            {price === PRICE_CAP_PER_SCHOOL ? " (the cap for a whole school)" : ""}.{" "}
            {valueSaved >= price
              ? "The teacher time alone covers it, before counting the learners who are now seen."
              : "The bigger return is the one the time doesn't count: a written record for every learner that stays when a teacher leaves."}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Rough estimates from your answers. We assume about {MINUTES_WITH_DIRA} minutes per learner
            per term with DIRA and a {Math.round(WORK_MINUTES_PER_MONTH / 60)}-hour working month.
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
