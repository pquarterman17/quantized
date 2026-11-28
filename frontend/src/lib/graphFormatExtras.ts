// The parts of a graph format Copy / Paste Format never carried: axis limits and
// tick steps, the legend's free position and size, and the page background.
// They travel only when a paste or a theme ticks the part that owns them
// (`lib/formatParts.ts`), so a plain Paste Format is unchanged.
//
// Pure.

import { sanitizeHalfLim, type HalfLim } from "./axisLim";
import { legendXYOrNull } from "./plotviewDecor";
import { sanitizeLegendSize } from "./plotviewSanitize";
import type { PlotBg, PlotView } from "./plotview";

export interface FormatExtras {
  xLim: HalfLim | null;
  yLim: HalfLim | null;
  y2Lim: [number, number] | null;
  xStep: number | null;
  yStep: number | null;
  y2Step: number | null;
  legendXY: [number, number] | null;
  legendFrameXY: [number, number] | null;
  legendSize: [number, number] | null;
  bg: PlotBg;
}

/** The `PlotView` fields extras carry (everything but `bg`, which is the window's). */
export type FormatExtraViewKey = Exclude<keyof FormatExtras, "bg">;

type ExtrasView = Pick<PlotView, FormatExtraViewKey>;

const PLOT_BGS: readonly PlotBg[] = ["theme", "light", "dark"];

const pair = <T extends readonly (number | null)[] | null>(v: T): T => (v ? ([...v] as unknown as T) : v);

/** Capture `view`'s extras; `bg` is the focused window's background. */
export function captureExtras(view: ExtrasView, bg: PlotBg): FormatExtras {
  return {
    xLim: pair(view.xLim),
    yLim: pair(view.yLim),
    y2Lim: pair(view.y2Lim),
    xStep: view.xStep,
    yStep: view.yStep,
    y2Step: view.y2Step,
    legendXY: pair(view.legendXY),
    legendFrameXY: pair(view.legendFrameXY),
    legendSize: pair(view.legendSize),
    bg,
  };
}

const step = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** Validate untrusted (saved theme) extras; undefined when `v` is not an object. */
export function sanitizeExtras(v: unknown): FormatExtras | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const range = (x: unknown): [number, number] | null => {
    const h = sanitizeHalfLim(x);
    return h && h[0] !== null && h[1] !== null ? [h[0], h[1]] : null;
  };
  return {
    xLim: sanitizeHalfLim(o.xLim),
    yLim: sanitizeHalfLim(o.yLim),
    y2Lim: range(o.y2Lim),
    xStep: step(o.xStep),
    yStep: step(o.yStep),
    y2Step: step(o.y2Step),
    legendXY: legendXYOrNull(o.legendXY),
    legendFrameXY: legendXYOrNull(o.legendFrameXY),
    legendSize: sanitizeLegendSize(o.legendSize),
    bg: PLOT_BGS.includes(o.bg as PlotBg) ? (o.bg as PlotBg) : "theme",
  };
}
