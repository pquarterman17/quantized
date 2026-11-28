// Axis dialog helpers for the controls the right panel used to own (plan item
// 50, OG23): Y2 following Y's tick format, and the X date / clock tick modes.
// Pure, so the Axis dialog stays a thin view over them.

import type { AxisDraft } from "./axisDialogModel";
import { isDateTickMode, TICK_CLOCK_OPTION, TICK_DATE_OPTIONS, xAxisIsClock, xAxisIsDate } from "./tickFormat";
import type { TickMode } from "./types";

/** Draft fields that are NOT part of an axis' tick format: editing one of
 *  these never makes Y2 stop following Y's format. */
const NOT_FORMAT: readonly (keyof AxisDraft)[] = ["from", "to", "increment", "titleSize", "title", "sameAsY", "inheritFmt", "scale"];

/** Does editing `key` give Y2 a tick format of its own? A scale pick does
 *  too, because log2 / ln / probability live on the format. */
export const editsY2Format = (key: keyof AxisDraft, value: unknown): boolean =>
  key === "scale" ? value !== "same" : !NOT_FORMAT.includes(key);

/** Tick "Same format as Y" ticked: every format field goes back to what Y2
 *  would draw following Y (`baseline`: the draft of Y2 with no scale / format
 *  of its own). The scale is replaced only when either side is one that lives
 *  on the format (ln, log2, probability), since those follow Y's. */
export function followYFormat(d: AxisDraft, baseline: AxisDraft): AxisDraft {
  const next: AxisDraft = { ...d };
  for (const k of Object.keys(baseline) as (keyof AxisDraft)[]) {
    if (!NOT_FORMAT.includes(k)) (next as unknown as Record<string, unknown>)[k] = baseline[k];
  }
  const onFormat = (c: string) => c === "ln" || c === "log2" || c === "probit" || c === "probitPct";
  if (onFormat(d.scale) || onFormat(baseline.scale)) next.scale = baseline.scale;
  next.inheritFmt = true;
  return next;
}

export interface ModeOption {
  value: TickMode;
  label: string;
}

/** The Number format list. X gains the calendar modes only when its column
 *  is timestamps, and Clock only for a time of day (or when a saved figure
 *  already uses one, so it can be switched back). */
export function tickModeOptions(base: ModeOption[], axis: "x" | "y" | "y2", metadata: Record<string, unknown> | undefined, mode: TickMode): ModeOption[] {
  if (axis !== "x") return base;
  const isDate = xAxisIsDate(metadata, mode);
  const out = base.map((o) => (isDate && o.value === "auto" ? { ...o, label: "Auto (date + time)" } : o));
  if (xAxisIsClock(metadata, mode)) out.push(TICK_CLOCK_OPTION);
  if (isDate) out.push(...TICK_DATE_OPTIONS.filter((o) => isDateTickMode(o.value as TickMode)).map((o) => ({ value: o.value as TickMode, label: o.label })));
  return out;
}
