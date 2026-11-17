interface CalendarItem {
  date: string;
  time: string;
  label: string;
  status: string;
  is_manual_demo: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Scheduled",
  initiating: "Calling",
  provider_accepted: "Called",
  provider_rejected: "Not placed",
  outcome_unknown: "Check",
  cancelled: "Cancelled",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A month view of after-lesson calls, like a phone calendar: a short line per call, then "+N more". */
export default function CallsMonthCalendar({
  monthStart,
  today,
  items,
}: {
  monthStart: string;
  today: string;
  items: CalendarItem[];
}) {
  const first = new Date(`${monthStart}T00:00:00Z`);
  const month = first.getUTCMonth();
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const gridStart = addDays(monthStart, -offset);
  const byDate = new Map<string, CalendarItem[]>();
  for (const item of items) {
    byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  }
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const lastNeeded = days.findLastIndex((day) => new Date(`${day}T00:00:00Z`).getUTCMonth() === month);
  const visible = days.slice(0, Math.ceil((lastNeeded + 1) / 7) * 7);

  return (
    <div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 text-xs dark:border-gray-700 dark:bg-gray-700">
        {WEEKDAYS.map((day) => (
          <div key={day} className="bg-gray-50 px-1 py-1 text-center font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {day}
          </div>
        ))}
        {visible.map((day) => {
          const inMonth = new Date(`${day}T00:00:00Z`).getUTCMonth() === month;
          const calls = byDate.get(day) ?? [];
          const isToday = day === today;
          return (
            <div
              key={day}
              className={`min-h-16 bg-white p-1 dark:bg-gray-900 sm:min-h-20 ${inMonth ? "" : "opacity-40"}`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                    isToday ? "bg-dira-teal font-semibold text-white" : "text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {Number(day.slice(8))}
                </span>
                {calls.length > 0 && (
                  <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 sm:hidden">
                    {calls.length}
                  </span>
                )}
              </div>
              <ul className="mt-1 hidden space-y-0.5 sm:block">
                {calls.slice(0, 2).map((call, index) => (
                  <li
                    key={`${day}-${index}`}
                    className="truncate rounded bg-dira-teal/10 px-1 text-[10px] leading-4 text-gray-800 dark:bg-dira-teal/30 dark:text-gray-100"
                    title={`${call.time} ${call.is_manual_demo ? "Demo call" : call.label} · ${STATUS_LABEL[call.status] ?? call.status}`}
                  >
                    {call.time} {call.is_manual_demo ? "Demo" : call.label} · {STATUS_LABEL[call.status] ?? call.status}
                  </li>
                ))}
                {calls.length > 2 && (
                  <li className="px-1 text-[10px] text-gray-500 dark:text-gray-400">+{calls.length - 2} more</li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        Each line is one after-lesson call: the time the lesson ends, the class, and where the call
        is now. On a phone, the number shows how many calls that day.
      </p>
    </div>
  );
}
