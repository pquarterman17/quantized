// P1.4 residuals 4 and 5 — the derivations a GRADIENT Color-by and TEXT-COLUMN
// factors add to the encodings (see lib/plotEncoding.ts's module doc, whose
// consumers reach these through its re-export). Split out for that module's
// 500-line ceiling. Lazy-only, like plotEncoding.ts: never imported by the
// eager graph (the eager gate is lib/plotEncodingBinding.ts).

import { COLORMAPS } from "./colormap";
import type { ColorScatterSpec } from "./colorscatter";
import { textColumnCells } from "./columnmeta";
import type { Encoding } from "./plotEncodingBinding";
import { analysisData } from "./rowstate";
import type { DataStruct, Dataset, SeriesStyle } from "./types";
import { withUnit } from "./uplotOpts";

/** A gradient Color-by (residual 4): the colour column, its scale over the
 *  rows the figure keeps (`encodedGradient`) and each row's value. */
export interface EncodedGradient {
  channel: number;
  lo: number;
  hi: number;
  label: string;
  z: (number | null)[];
}

/** The sequential colormap a gradient Color-by draws with (lib/colormap.ts). */
export const GRADIENT_COLORMAP = "viridis";

/** The gradient colormap's stops as hex — `calc.figure_colorscatter.
 *  GRADIENT_STOPS` is a pinned copy (the gradient wire fixture's `stops`). */
export function gradientStops(): string[] {
  return COLORMAPS[GRADIENT_COLORMAP].map((rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`);
}

/** `data` with `enc`'s text columns appended as categorical channels — the
 *  data the preview and the Stage split (the backend's port is
 *  `calc.encoding_text.append_text_factors`, from the wire's `text_columns`).
 *  A column's levels are its distinct trimmed cells in order of first
 *  appearance; a blank or missing cell is NaN, so its row joins no level.
 *  `data` itself when no text column is picked. */
export function encodingData(data: DataStruct, enc: Encoding): DataStruct {
  if (!enc.text || enc.text.length === 0) return data;
  const n = data.labels.length;
  const cat_levels = { ...data.cat_levels };
  const codes = enc.text.map((name, i) => {
    const cells = textColumnCells(data, name) ?? [];
    const levels: string[] = [];
    const col = data.values.map((_, r) => {
      const s = cells[r] === null || cells[r] === undefined ? "" : String(cells[r]).trim();
      if (s === "") return NaN;
      if (!levels.includes(s)) levels.push(s);
      return levels.indexOf(s);
    });
    if (levels.length > 0) cat_levels[n + i] = levels;
    return col;
  });
  return {
    ...data,
    values: data.values.map((row, r) => [...row, ...codes.map((c) => c[r])]),
    labels: [...data.labels, ...enc.text],
    units: [...data.units, ...enc.text.map(() => "")],
    cat_levels,
  };
}

/** The gradient over `data`'s rows (already `encodingData`): each row's value,
 *  and the colour scale — the column's finite range over `scaleRows` (the rows
 *  the figure keeps: the analysis rows, which is exactly what the export's
 *  wire dataset holds, so `calc.plotting_encoded.gradient_spec` finds the same
 *  range) and its label "name (unit)". Null without a gradient, or when the
 *  column has no finite value there (nothing to colour). */
export function encodedGradient(data: DataStruct, enc: Encoding, scaleRows: DataStruct = data): EncodedGradient | null {
  const g = enc.gradient;
  if (g === undefined) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of scaleRows.values) {
    const v = row[g];
    if (Number.isFinite(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  if (lo > hi) return null;
  const unit = data.units[g] ?? "";
  const name = data.labels[g] ?? `col ${g}`;
  const z = data.values.map((row) => (Number.isFinite(row[g]) ? row[g] : null));
  return { channel: g, lo, hi, label: withUnit(name, unit), z };
}

/** The Stage's gradient: `data` is the window's FULL rows (+ text factors),
 *  which its fetched columns align with, while the colour scale is taken over
 *  the rows the figure keeps (`analysisData`) — the export's wire dataset. */
export function stageGradient(ds: Dataset, data: DataStruct, enc: Encoding): EncodedGradient | null {
  return encodedGradient(data, enc, analysisData(ds) ?? data);
}

/** The colour-mapped point specs for a gradient's series (1-based display
 *  columns, `colorscatter.buildColorByColumns`' keying), each with its series'
 *  glyph — what the Stage's `colorScatterPlugin` and the preview canvas draw. */
export function gradientColumns(g: EncodedGradient, styles: readonly (SeriesStyle | undefined)[]): Map<number, ColorScatterSpec> {
  const out = new Map<number, ColorScatterSpec>();
  styles.forEach((st, i) =>
    out.set(i + 1, {
      channel: g.channel, z: g.z, colormap: GRADIENT_COLORMAP, lo: g.lo, hi: g.hi, label: g.label,
      shape: st?.marker ? (st.markerShape ?? "circle") : "circle",
    }),
  );
  return out;
}
