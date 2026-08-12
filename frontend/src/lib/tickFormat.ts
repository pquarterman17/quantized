// Shared tick-format vocabulary: the mode option lists and the date-mode
// predicate that every axis tick-format control renders from.
//
// One source of truth on purpose. Two surfaces now edit `AxisFormat` -- the
// Stage's `Inspector/TickFormat.tsx` and the canonical Publication Preview's
// `figurebuilder/TickFormatPanel.tsx` (F2.3e) -- and they must offer the same
// four modes, in the same order, under the same labels, or a figure's ticks
// change meaning depending on which panel the user reached for. The semantics
// of each mode live on `TickMode` in lib/types.ts; this module is only the
// presentation vocabulary.

import type { TickMode } from "./types";

/** The numeric modes, in the order both controls render them. Excludes the
 *  date/time modes, which are X-only and gated on the data (see below). */
export const TICK_MODE_OPTIONS: { value: TickMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "fixed", label: "Fixed" },
  { value: "sci", label: "Sci" },
  { value: "eng", label: "Eng" },
];

/** The X-only calendar modes. A date format on a physics axis produces
 *  out-of-range epochs (it used to crash the export), so these are offered
 *  only when the data says the X column IS timestamps -- see `xAxisIsDate`. */
export const TICK_DATE_MODES: ReadonlySet<TickMode> = new Set<TickMode>(["date", "time", "datetime"]);

export function isDateTickMode(mode: TickMode): boolean {
  return TICK_DATE_MODES.has(mode);
}

/** Whether to offer the X axis's date/time modes at all: the parser
 *  recognized the X column as timestamps on import, OR a saved spec already
 *  selected a date mode (so it stays switchable BACK, never stranded). */
export function xAxisIsDate(
  metadata: Record<string, unknown> | undefined,
  currentMode: TickMode,
): boolean {
  return metadata?.time_is_datetime === true || isDateTickMode(currentMode);
}

/** The date-select's value/label pairs, including the "not a date" option
 *  that maps back to `auto`. */
export const TICK_DATE_OPTIONS: { value: string; label: string }[] = [
  { value: "numeric", label: "Numeric" },
  { value: "date", label: "Date (UTC)" },
  { value: "time", label: "Time (UTC)" },
  { value: "datetime", label: "Date + time (UTC)" },
];

/** Clamp a typed digit count to the range both controls accept. Returns null
 *  for input that should not commit at all (empty / non-numeric), so a
 *  half-typed field never writes a garbage format. */
export function normalizeTickDigits(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(20, Math.round(value)));
}
