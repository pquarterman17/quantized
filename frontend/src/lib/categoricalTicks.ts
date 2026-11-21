// `categoricalTickFormatter`, moved verbatim out of lib/uplotOpts.ts (its
// line pin) to make room for the figures-audit #6 axis-extras hook there;
// uplotOpts.ts re-exports it, so no importer changed. The category-axis
// helpers added since (`categoricalXAxis`, `originCategoryX`) live here for the
// same reason.

import type uPlot from "uplot";
import type { DataStruct } from "./types";

type ValuesFn = Extract<NonNullable<uPlot.Axis["values"]>, (...args: never[]) => unknown>;

/** Build a uPlot axis `values` formatter for a categorical x-axis
 *  (`PlotPayload.xCategories`, gap #20): `data[0]` holds ORDINAL positions
 *  (`base`, `base + 1`, …; `base` 0 for a category chart, 1 for an Origin text
 *  X), so a tick maps to its label only when it lands exactly on an in-range
 *  integer index — a fractional split (uPlot may propose one between
 *  categories at some zoom levels) or an out-of-range one renders blank
 *  rather than a misleading label. */
export function categoricalTickFormatter(categories: readonly string[], base = 0): ValuesFn {
  return (_u, splits) =>
    splits.map((v) => {
      if (v == null) return null;
      const i = Math.round(v) - base;
      return i >= 0 && i < categories.length && Math.abs(v - Math.round(v)) < 1e-6 ? categories[i] : "";
    });
}

/** The whole category x-axis for uPlot: the label formatter, integer-only
 *  `splits` thinned to every k-th category so neighbouring labels never
 *  overlap, and the `space` (px between ticks) that drives that thinning.
 *  `tickPx` is the tick font size; a glyph averages 0.6 em. The export twin is
 *  `calc/figure_category_ticks.py` (same width estimate and gap). */
export function categoricalXAxis(
  categories: readonly string[],
  base: number,
  tickPx: number,
): { values: ValuesFn; splits: uPlot.Axis.Splits; space: number } {
  const longest = categories.reduce((m, s) => Math.max(m, s.length), 1);
  const space = longest * tickPx * 0.6 + 8;
  return {
    values: categoricalTickFormatter(categories, base),
    space,
    // The step is the export's `category_step` (slot / pitch, rounded up),
    // NOT uPlot's 1-2-5 increment rounded up, which jumped 2 -> 5 where the
    // export drew every 3rd. uPlot's found space / increment IS its px per unit.
    splits: (_u, _axisIdx, scaleMin, scaleMax, foundIncr, foundSpace) => {
      const perUnit = foundIncr > 0 && foundSpace > 0 ? foundSpace / foundIncr : 0;
      const step = Math.max(1, Math.ceil((perUnit > 0 ? space / perUnit : foundIncr) - 1e-9));
      const first = base + Math.ceil((scaleMin - base - 1e-9) / step) * step;
      const out: number[] = [];
      for (let v = first; v <= scaleMax + 1e-9 && out.length < 10_000; v += step) out.push(v);
      return out;
    },
  };
}

/** The labels name THIS X only while every X value is a category position
 *  1..n: a derived dataset (FFT, resample, binning, transpose) that copied the
 *  source metadata has a different X, and its values would be mislabelled.
 *  Fails closed to a plain number axis. Twin: `calc/axis_categories.py`. */
export function isCategoryAxis(time: readonly (number | null)[], n: number): boolean {
  return n > 0 && time.every((t) => t == null || !Number.isFinite(t) || (Number.isInteger(t) && t >= 1 && t <= n));
}

/** An Origin text X (`metadata.x_category_labels`, written by the .opj/.opju
 *  book builder) on the dataset's own axis (`xKey` null): `.time` is the
 *  1-based category position, so the payload gains the labels with base 1.
 *  A book whose X column name was not recovered titles its axis "" rather
 *  than the "Row" placeholder (twin: `calc/plotting.py _default_x_label`).
 *  Anything else is returned untouched. */
export function originCategoryX<P extends { xCategories?: string[]; xCategoryBase?: number; xLabel: string }>(
  payload: P,
  data: DataStruct,
  xKey: number | null,
): P {
  const md = data.metadata as Record<string, unknown> | undefined;
  const labels = md?.x_category_labels;
  if (xKey != null || !Array.isArray(labels) || !isCategoryAxis(data.time, labels.length)) return payload;
  return { ...payload, xCategories: labels.map(String), xCategoryBase: 1, ...(md?.x_column_name ? {} : { xLabel: "" }) };
}
