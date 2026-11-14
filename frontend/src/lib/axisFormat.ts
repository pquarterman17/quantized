// Axis tick-label format contract, moved verbatim out of lib/types.ts (its
// line pin) when the figures-audit #6 Axis dialog added its optional extras.
// lib/types.ts re-exports every name here. Pure, dependency-free.

/** Axis tick number format. `auto` = increment-aware locale-grouped labels
 *  (MAIN #20: overrides uPlot's own default formatter, which caps at 3
 *  fraction digits regardless of the actual tick spacing — see
 *  `uplotOpts.ts`'s `autoTickValues` doc for the owner bug this fixes);
 *  `fixed` = `toFixed(digits)`; `sci` = `toExponential(digits)`; `eng` =
 *  engineering notation (mantissa in [1,1000), exponent a multiple of 3,
 *  e.g. `12.3e-6`). `digits` is the decimal/mantissa count for
 *  fixed/sci/eng — ignored (uPlot-style adaptive) for `auto`. Every
 *  non-auto mode still FLOORS its decimal/mantissa count at whatever the
 *  actual tick increment needs, so `digits` sets a minimum, not an exact
 *  count (`tickFormatter`'s `Math.max(digits, decimalsForIncrement(...))`). */
export type TickMode = "auto" | "fixed" | "sci" | "eng" | "date" | "time" | "datetime";

export interface AxisFormat {
  mode: TickMode;
  digits: number;
  /** Figures-audit #6 (the Axis dialog), all optional, all screen AND export
   *  (`lib/axisExtras.ts`, `calc/axis_extras.py`): tick labels show
   *  value ÷ `divide`, with "×divide" at the axis end; */
  divide?: number;
  /** minor ticks between majors (0/absent = none); */
  minor?: number;
  /** tick-mark direction (absent = "out", today's look); */
  ticks?: "in" | "out" | "both";
  /** tick-label font size, pt; */
  size?: number;
  /** "e" on a log axis = Origin's "Ln" scale: majors at powers of e. */
  base?: "e";
  /** Axis breaks on a LINEAR Y / Y2 axis: each `[lo, hi]` stretch is elided
   *  and a break mark drawn in its place (`lib/axisBreaks.ts`,
   *  `calc/axis_breaks.py`). Sorted, non-overlapping, at most `MAX_AXIS_BREAKS`.
   *  The X axis breaks as side-by-side panels instead (`lib/facet.ts`). */
  breaks?: [number, number][];
}

export const MAX_AXIS_BREAKS = 4;

/** `raw` as a valid break list -- finite `[lo, hi]` pairs with `lo < hi`,
 *  sorted and non-overlapping, at most `MAX_AXIS_BREAKS` -- or `undefined`
 *  when nothing valid is left. An invalid entry is dropped, never repaired. */
export function normalizeBreaks(raw: unknown): [number, number][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const pairs = raw
    .filter((b): b is [number, number] => Array.isArray(b) && b.length === 2 && Number.isFinite(b[0]) && Number.isFinite(b[1]) && b[0] < b[1])
    .map(([lo, hi]) => [lo, hi] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const b of pairs) if (out.length < MAX_AXIS_BREAKS && (out.length === 0 || b[0] >= out[out.length - 1][1])) out.push(b);
  return out.length ? out : undefined;
}

/** `fmt` with only its VALID Axis-dialog extras kept -- a file/template
 *  value is untrusted, and the renderer and export assume these shapes. */
export function sanitizeAxisExtras(fmt: AxisFormat): AxisFormat {
  const { mode, digits, divide, minor, ticks, size, base } = fmt;
  const breaks = normalizeBreaks(fmt.breaks);
  const pos = (v: unknown, max: number): v is number => typeof v === "number" && v > 0 && v <= max;
  return {
    mode,
    digits,
    ...(pos(divide, Infinity) ? { divide } : {}),
    ...(Number.isInteger(minor) && pos(minor, 20) ? { minor } : {}),
    ...(ticks === "in" || ticks === "out" || ticks === "both" ? { ticks } : {}),
    ...(pos(size, 72) ? { size } : {}),
    ...(base === "e" ? { base } : {}),
    ...(breaks ? { breaks } : {}),
  };
}

/** The format a Y2 axis with none of its own inherits from the primary Y
 *  axis: everything but the breaks, whose `[lo, hi]` are in Y's units. */
export function inheritedAxisFormat(fmt: AxisFormat): AxisFormat {
  if (!fmt.breaks) return fmt;
  const { breaks: _breaks, ...rest } = fmt;
  void _breaks;
  return rest;
}

/** True when `fmt` carries any Axis-dialog extra (figures-audit #6). */
export function hasAxisExtras(fmt: AxisFormat | null | undefined): boolean {
  return !!fmt && (fmt.divide !== undefined || !!fmt.minor || fmt.ticks !== undefined || fmt.size !== undefined || fmt.base !== undefined || !!fmt.breaks?.length);
}

/** MAIN #24: an export request's `x_fmt`/`y_fmt` wire field — `undefined`
 *  for `auto` (the default; omitting it keeps requests lean and matches
 *  every caller that predates this field) or the format itself for an
 *  explicit fixed/sci/eng override, mirroring `tickFormatter`'s own
 *  `auto` short-circuit. */
export function axisFmtParam(fmt: AxisFormat): AxisFormat | undefined {
  // An "auto" format still travels when it carries an Axis-dialog extra
  // (#6), or the export would silently drop what the screen draws.
  return fmt.mode === "auto" && !hasAxisExtras(fmt) ? undefined : fmt;
}

/** The X format a plot actually draws with: `auto` on an X column the parser
 *  recognised as timestamps (`metadata.time_is_datetime`) reads as calendar
 *  date + time, as Origin shows a date column, instead of raw epoch seconds
 *  (worksheet audit #7). Any explicit mode is kept. The export applies the
 *  same rule server-side (`calc/figure_ticks.date_aware_x_fmt`), so the
 *  screen and the PDF agree without either sending the other anything. */
export function dateAwareXFmt(fmt: AxisFormat | undefined, xIsDate: boolean | undefined): AxisFormat | undefined {
  if (!xIsDate || (fmt && fmt.mode !== "auto")) return fmt;
  return { ...(fmt ?? { digits: 2 }), mode: "datetime" };
}
