"use client";

import { useState } from "react";

interface WeekPoint {
  week_start: string;
  observations: number;
  learners: number;
}

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 16, right: 8, bottom: 28, left: 32 };
const BAR_MAX = 24;
const RADIUS = 4;

function weekLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Rounded top, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Observations recorded per week: one series, so the title names it and no legend is drawn. */
export default function WeeklyObservationsChart({ weeks }: { weeks: WeekPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((week) => week.observations));
  const niceMax = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, weeks.length);
  const barW = Math.min(BAR_MAX, band * 0.6);
  const ticks = [0, niceMax / 2, niceMax];
  const current = active === null ? null : weeks[active];

  return (
    <div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Observations per week for the last ${weeks.length} weeks`}
          onMouseLeave={() => setActive(null)}
        >
          {ticks.map((tick) => {
            const y = PAD.top + plotH - (tick / niceMax) * plotH;
            return (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={WIDTH - PAD.right}
                  y1={y}
                  y2={y}
                  className="stroke-gray-200 dark:stroke-gray-700"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 6}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-gray-500 text-[11px] dark:fill-gray-400"
                >
                  {tick}
                </text>
              </g>
            );
          })}
          {weeks.map((week, index) => {
            const h = (week.observations / niceMax) * plotH;
            const x = PAD.left + index * band + (band - barW) / 2;
            const y = PAD.top + plotH - h;
            return (
              <g key={week.week_start}>
                {/* Hit target: the whole band, bigger than the bar. */}
                <rect
                  x={PAD.left + index * band}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  tabIndex={0}
                  aria-label={`Week of ${weekLabel(week.week_start)}: ${week.observations} observations about ${week.learners} learners`}
                />
                <path
                  d={barPath(x, y, barW, h)}
                  className={`pointer-events-none fill-[#0f8a78] dark:fill-[#26a690] ${
                    active !== null && active !== index ? "opacity-50" : ""
                  }`}
                />
                {(index % 2 === 0 || index === weeks.length - 1) && (
                  <text
                    x={PAD.left + index * band + band / 2}
                    y={HEIGHT - 8}
                    textAnchor="middle"
                    className="fill-gray-500 text-[11px] dark:fill-gray-400"
                  >
                    {weekLabel(week.week_start)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {current && active !== null && (
          <div
            className="pointer-events-none absolute top-0 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            style={{
              left: `${((PAD.left + active * band + band / 2) / WIDTH) * 100}%`,
              transform: "translateX(-50%)",
            }}
          >
            <p className="font-semibold">Week of {weekLabel(current.week_start)}</p>
            <p>{current.observations} observations</p>
            <p className="text-gray-500 dark:text-gray-400">about {current.learners} learners</p>
          </div>
        )}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-gray-600 dark:text-gray-300">Show as a table</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="text-gray-500 dark:text-gray-400">
              <th className="py-1 font-medium">Week of</th>
              <th className="py-1 font-medium">Observations</th>
              <th className="py-1 font-medium">Learners observed</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week.week_start} className="border-t border-gray-100 dark:border-gray-800">
                <td className="py-1">{weekLabel(week.week_start)}</td>
                <td className="py-1">{week.observations}</td>
                <td className="py-1">{week.learners}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
