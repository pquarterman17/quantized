// Plot-style defaults (PREFS_AUDIT lane 2, P1-5/P1-6): the values a NEW plot
// starts from, kept in one `qz.plotStylePrefs` slot (lib/prefSlots.ts).
//
// Every default below equals today's hardcoded behaviour (fail closed), so a
// user who never opens Preferences sees byte-identical figures. All defaults
// are PROVISIONAL, owner to confirm.
//
//   markerSize     5 px     lib/markers.ts DEFAULT_MARKER_PX (canvas AND export:
//                           the export sends the same number as `marker_size`)
//   fontSize       12 px    the Screen template's tick-label size (other
//                           templates keep their own); export gets it as a
//                           `font_size` override only when it differs from 12
//   tickDirection  "auto"   outward on screen, the style preset's direction in
//                           an export; any other value rides `xFmt/yFmt.ticks`,
//                           which the canvas (axisExtras) and the export
//                           (`x_fmt.ticks`) both read
//   legendPos      "auto"   `PlotView.legendPos`; exported via legend.loc
//
// This module is eager (plotview.ts / markers.ts read it): keep it tiny and
// free of store imports. `qz.prefs` is read only for `defaultGrid`.

import { definePrefSlot, readPrefSlot } from "./prefSlots";
import type { AxisFormat } from "./axisFormat";
import type { LegendPos } from "./plotview";

export type TickDirection = "auto" | "in" | "out" | "both";
export const TICK_DIRECTIONS: readonly TickDirection[] = ["auto", "out", "in", "both"];
export const LEGEND_POSITIONS: readonly LegendPos[] = ["auto", "ne", "nw", "se", "sw"];

/** Provisional, owner to confirm: every default is today's hardcoded value. */
export const DEFAULT_MARKER_SIZE_PX = 5;
export const DEFAULT_FONT_SIZE_PX = 12;
/** uPlot cannot draw a marker under 2 px (lib/markers.ts MIN_MARKER_PX). */
export const MARKER_SIZE_RANGE = [2, 16] as const;
export const FONT_SIZE_RANGE = [8, 24] as const;

export interface PlotStylePrefs {
  markerSize: number;
  fontSize: number;
  tickDirection: TickDirection;
  legendPos: LegendPos;
}

export const PLOT_STYLE_DEFAULTS: PlotStylePrefs = {
  markerSize: DEFAULT_MARKER_SIZE_PX,
  fontSize: DEFAULT_FONT_SIZE_PX,
  tickDirection: "auto",
  legendPos: "auto",
};

const clamp = (v: unknown, d: number, [lo, hi]: readonly [number, number]): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

function parse(raw: Record<string, unknown>): PlotStylePrefs {
  const d = PLOT_STYLE_DEFAULTS;
  return {
    markerSize: clamp(raw.markerSize, d.markerSize, MARKER_SIZE_RANGE),
    fontSize: clamp(raw.fontSize, d.fontSize, FONT_SIZE_RANGE),
    tickDirection: TICK_DIRECTIONS.includes(raw.tickDirection as TickDirection) ? (raw.tickDirection as TickDirection) : d.tickDirection,
    legendPos: LEGEND_POSITIONS.includes(raw.legendPos as LegendPos) ? (raw.legendPos as LegendPos) : d.legendPos,
  };
}

export const plotStylePrefsSlot = definePrefSlot("qz.plotStylePrefs", PLOT_STYLE_DEFAULTS, parse);

/** The canvas' marker size when a series names none (and what an export sends). */
export const defaultMarkerPx = (): number => plotStylePrefs().markerSize;
export const plotStylePrefs = (): PlotStylePrefs => plotStylePrefsSlot.load();

/** The Grid lines default (`qz.prefs` `defaultGrid`), read live so a new plot
 *  honours the pref without importing the store (P1-5). Parsed once per
 *  storage change, like a slot. */
let gridRaw: string | null | undefined;
let gridValue = true;
export function gridDefault(): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem("qz.prefs");
  } catch {
    /* blocked: today's default */
  }
  if (raw !== gridRaw) {
    gridRaw = raw;
    const v = readPrefSlot("qz.prefs")?.defaultGrid;
    gridValue = typeof v === "boolean" ? v : true;
  }
  return gridValue;
}

const seededFmt = (dir: TickDirection): AxisFormat => ({ mode: "auto", digits: 2, ...(dir === "auto" ? {} : { ticks: dir }) });

/** The PlotView fields a new plot seeds from Preferences (`defaultPlotView`). */
export function plotStyleSeed(): { showGrid: boolean; legendPos: LegendPos; xFmt: AxisFormat; yFmt: AxisFormat } {
  const p = plotStylePrefs();
  return { showGrid: gridDefault(), legendPos: p.legendPos, xFmt: seededFmt(p.tickDirection), yFmt: seededFmt(p.tickDirection) };
}

/** The export `font_size` (pt) a non-default screen font size rides as, else
 *  undefined (the style preset's own size, today's behaviour). The canvas'
 *  12 px corresponds to the default style's 10 pt (calc/figure_styles.py), so
 *  the pref scales by 10/12; other templates carry no font on the wire. */
export function screenFontPt(template: string | undefined): number | undefined {
  const px = plotStylePrefs().fontSize;
  return (template ?? "screen") === "screen" && px !== DEFAULT_FONT_SIZE_PX ? (px * 10) / DEFAULT_FONT_SIZE_PX : undefined;
}
