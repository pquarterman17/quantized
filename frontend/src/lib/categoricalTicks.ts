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
  return {
    values: categoricalTickFormatter(categories, base),
    space: longest * tickPx * 0.6 + 8,
    splits: (_u, _axisIdx, scaleMin, scaleMax, foundIncr) => {
      const step = Math.max(1, Math.ceil(foundIncr - 1e-9));
      const first = base + Math.ceil((scaleMin - base - 1e-9) / step) * step;
      const out: number[] = [];
      for (let v = first; v <= scaleMax + 1e-9 && out.length < 10_000; v += step) out.push(v);
      return out;
    },
  };
}

/** An Origin text X (`metadata.x_category_labels`, written by the .opj/.opju
 *  book builder) on the dataset's own axis (`xKey` null): `.time` is the
 *  1-based category position, so the payload gains the labels with base 1.
 *  Anything else is returned untouched. */
export function originCategoryX<P extends { xCategories?: string[]; xCategoryBase?: number }>(
  payload: P,
  data: DataStruct,
  xKey: number | null,
): P {
  const labels = (data.metadata as Record<string, unknown> | undefined)?.x_category_labels;
  if (xKey != null || !Array.isArray(labels) || labels.length === 0) return payload;
  return { ...payload, xCategories: labels.map(String), xCategoryBase: 1 };
}
