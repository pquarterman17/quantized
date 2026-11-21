// The `clock` tick mode: seconds since midnight labelled as a time of day
// (HH:MM / HH:MM:SS / HH:MM:SS.fff), never a date. A time-only column the
// Import Wizard read as "Time of day" (`io/_time_of_day.py`,
// `metadata.time_is_clock`) is seconds since midnight; the calendar `time`
// mode would take it for an epoch and print 1970-01-01 once its ticks are a
// day apart. `clock` wraps every 24 h instead (an axis unwrapped across
// midnight reads 23:00, 00:00, 01:00) and names the day offset ("1d 00:00")
// only when the ticks are a day or more apart.
//
// Mirrors `calc/clock_ticks.py` exactly (labels and the step table), so an
// exported figure reads like the plot. Loaded with the axis-extras chunk
// (`lib/axisExtras.ts` re-exports `clockXAxis`), not the startup bundle --
// and imported by nothing else, so it adds no chunk of its own.

import type uPlot from "uplot";

import type { AxisFormat, AxisScale } from "./types";

const DAY = 86_400;

/** Tick increments a clock axis steps by, in seconds (then whole days by
 *  1-2-5 multiples) -- `clock_ticks.CLOCK_STEPS`. */
export const CLOCK_STEPS: readonly number[] = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5,
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800,
  3600, 7200, 10800, 21600, 43200, 86400,
];

/** The smallest clock increment of at least `minStep` seconds. */
export function clockStep(minStep: number): number {
  if (!Number.isFinite(minStep) || minStep <= 0) return 1;
  for (const step of CLOCK_STEPS) if (step >= minStep - 1e-12) return step;
  const days = minStep / DAY;
  const mag = 10 ** Math.floor(Math.log10(days));
  for (const m of [1, 2, 5, 10]) if (m * mag >= days - 1e-12) return m * mag * DAY;
  return 10 * mag * DAY;
}

/** How many fraction digits resolve `step` exactly (at most 9). */
function decimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0 || step >= 1) return 0;
  for (let d = 1; d < 10; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return d;
  }
  return 9;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The label of `x` seconds on an axis whose ticks are `step` apart: seconds
 *  when the step is not whole minutes, fraction digits under a second, the
 *  day offset at a day or more. `""` for a non-finite value. */
export function clockLabel(x: number, step: number): string {
  if (!Number.isFinite(x)) return "";
  const incr = Number.isFinite(step) && step > 0 ? step : 0;
  const d = decimals(incr);
  const total = Math.round(x * 10 ** d) / 10 ** d; // round first: 59.9999 is the next minute
  const day = Math.floor(total / DAY);
  const t = total - day * DAY;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t - h * 3600) / 60);
  const s = t - h * 3600 - m * 60;
  let text = `${pad2(h)}:${pad2(m)}`;
  if (incr === 0 || incr < 60 || incr % 60) text += `:${s.toFixed(d).padStart(d ? 3 + d : 2, "0")}`;
  return incr >= DAY ? `${day}d ${text}` : text;
}

/** uPlot X-axis parts for a clock axis (the `categoricalXAxis` shape), or
 *  null when `fmt` is not `clock` or the X scale is not linear (a log clock
 *  keeps its own locator and plain labels, as the export does). Ticks fall at
 *  whole clock increments at least `space` px apart -- or, with a typed X
 *  increment (`xStep`), where `uplotOpts.splitsFor` puts them (`splits`
 *  left out) -- and read `clockLabel`. */
export function clockXAxis(
  fmt: AxisFormat | undefined,
  scale: AxisScale,
  xStep: number | null | undefined,
  tickPx: number,
): { values: (u: uPlot, splits: number[]) => string[]; splits?: uPlot.Axis.Splits; space: number } | null {
  if (fmt?.mode !== "clock" || scale !== "linear") return null;
  const space = 8 * tickPx * 0.6 + 12; // "00:00:00"
  let step = 0;
  const splits: uPlot.Axis.Splits = (_u, _axisIdx, scaleMin, scaleMax, foundIncr, foundSpace) => {
    const perUnit = foundIncr > 0 && foundSpace > 0 ? foundSpace / foundIncr : 0;
    step = clockStep(perUnit > 0 ? space / perUnit : (scaleMax - scaleMin) / 7);
    const out: number[] = [];
    const first = Math.ceil(scaleMin / step - 1e-9);
    for (let i = first; i * step <= scaleMax + 1e-9 && out.length < 1000; i++) out.push(i * step);
    return out;
  };
  const typed = xStep != null && xStep !== 0;
  return {
    space,
    ...(typed ? {} : { splits }),
    // A typed step: the drawn spacing is the step the labels must resolve.
    values: (_u, s) => s.map((v) => clockLabel(v, typed ? Math.abs(xStep) : step)),
  };
}
