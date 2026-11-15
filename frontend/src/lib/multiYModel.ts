// The EAGER half of Origin-style multiple Y axes (gap audit 4 G11): the
// saved model, its file-boundary validation and the scale naming -- what a
// plain plot and a .dwk load need. The derivation the canvas and export
// share lives in lib/multiY.ts (module doc there), loaded once a view has
// a Y3+ axis (components/Stage/useMultiY.ts).

import { sanitizeAxisExtras, type AxisFormat } from "./axisFormat";
import type { AxisScale } from "./types";
import { isRange } from "./plotviewDecor";
import { isAxisScale } from "./plotviewAxis";

export interface ExtraYAxis {
  /** Fixed range, or null = autoscale to this axis' own series. */
  lim: [number, number] | null;
  /** null = inherit Y1's scale (the Y2 rule). */
  scale: AxisScale | null;
  step: number | null;
  /** null = inherit Y1's number format (the Y2 rule). */
  fmt: AxisFormat | null;
  /** "" = derive from the axis' series (one series: its legend name). */
  label: string;
  /** "#rrggbb" for the axis line, ticks, tick labels and title; null = ink. */
  color: string | null;
}

/** The uPlot scale key of payload axis `axis` (0 = Y1 "y", 1 = "y2", 2 = "y3"). */
export const yScaleKey = (axis: number | undefined): string => (axis ? `y${axis + 1}` : "y");

/** Validate untrusted `yAxes` (a .dwk, a template). Bad entries keep their
 *  slot (so later axis numbers do not shift) with bad fields at defaults.
 *  `isFmt` is the caller's AxisFormat check (lib/plotview.ts's). */
export function sanitizeYAxes(v: unknown, isFmt: (f: unknown) => f is AxisFormat): ExtraYAxis[] {
  return (Array.isArray(v) ? v.slice(0, 6) : []).map((raw) => {
    const { lim, scale, step, fmt, label, color } = (raw ?? {}) as Record<string, unknown>;
    return {
      lim: isRange(lim) && lim[0] < lim[1] ? [lim[0], lim[1]] : null,
      scale: isAxisScale(scale) ? scale : null,
      step: typeof step === "number" && step > 0 && step < Infinity ? step : null,
      fmt: isFmt(fmt) ? sanitizeAxisExtras(fmt) : null, // what a right axis cannot draw is dropped when resolved
      label: typeof label === "string" ? label.slice(0, 500) : "",
      color: typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : null,
    };
  });
}

/** Validate an untrusted `yAxisOf`: integer channel -> integer axis 3..8.
 *  An axis number past the saved `yAxes` is KEPT (an orphan, reported). */
export function sanitizeYAxisOf(v: unknown): Record<number, number> {
  const out: Record<number, number> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, n] of Object.entries(v)) if (/^\d+$/.test(k) && [3, 4, 5, 6, 7, 8].includes(n as number)) out[+k] = n as number;
  return out;
}

