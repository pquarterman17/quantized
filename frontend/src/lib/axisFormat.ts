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
}

/** `fmt` with only its VALID Axis-dialog extras kept -- a file/template
 *  value is untrusted, and the renderer and export assume these shapes. */
export function sanitizeAxisExtras(fmt: AxisFormat): AxisFormat {
  const { mode, digits, divide, minor, ticks, size, base } = fmt;
  const pos = (v: unknown, max: number): v is number => typeof v === "number" && v > 0 && v <= max;
  return {
    mode,
    digits,
    ...(pos(divide, Infinity) ? { divide } : {}),
    ...(Number.isInteger(minor) && pos(minor, 20) ? { minor } : {}),
    ...(ticks === "in" || ticks === "out" || ticks === "both" ? { ticks } : {}),
    ...(pos(size, 72) ? { size } : {}),
    ...(base === "e" ? { base } : {}),
  };
}

/** True when `fmt` carries any Axis-dialog extra (figures-audit #6). */
export function hasAxisExtras(fmt: AxisFormat | null | undefined): boolean {
  return !!fmt && (fmt.divide !== undefined || !!fmt.minor || fmt.ticks !== undefined || fmt.size !== undefined || fmt.base !== undefined);
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
