// Pie / doughnut request builder — pure: a label column and one value column
// per ring of a DataStruct -> the `/api/export/pie-figure` body
// (calc/figure_pie.py). One ring per value column, the first innermost; the
// wedges start at 12 o'clock and run clockwise (Origin's pie,
// io/origin_project/opju_pie.py).
//
// The renderer rejects a negative or non-finite value and a ring whose total
// is not positive with a 422 for the WHOLE request, so the rows it could not
// draw are left out HERE (a category any ring cannot draw is dropped from
// every ring, so the rings stay aligned), counted and named in one sentence.

import type { DataStruct } from "../../../lib/types";
import { cellValue, columnLabel } from "../ternary/auxColumns";

export interface PiePicks {
  /** The label column; -1 = the X column (its text categories when it has them). */
  labels: number;
  /** One value column per ring, the first innermost. */
  values: number[];
  /** Hole radius / outer radius: 0 = a pie. */
  hole: number;
}

export interface PieSpec {
  rings: number[][];
  labels: string[];
  hole: number;
  colors: string[] | null;
  title: string;
  filename: string;
}

export interface PieBuild {
  /** null when nothing is drawable. */
  spec: PieSpec | null;
  dropped: number;
  total: number;
}

/** The text of `data`'s X categories when the X column is a text column. */
function categories(data: DataStruct): string[] | null {
  const cats = data.metadata?.["x_category_labels"];
  return Array.isArray(cats) && cats.length === data.time.length ? cats.map(String) : null;
}

function labelAt(data: DataStruct, picks: PiePicks, cats: string[] | null, row: number): string {
  if (picks.labels < 0 && cats) return cats[row];
  const v = cellValue(data, picks.labels, row);
  return Number.isFinite(v) ? String(v) : `row ${row + 1}`;
}

export function buildPieRequest(
  data: DataStruct,
  picks: PiePicks,
  opts: { title: string; filename: string; colors: string[] | null },
): PieBuild {
  const total = data.time.length;
  const n = picks.values.length;
  const hole = n > 1 ? Math.max(picks.hole, 0.2) : picks.hole;
  const cats = categories(data);
  const rings: number[][] = picks.values.map(() => []);
  const labels: string[] = [];
  for (let r = 0; r < total; r++) {
    const row = picks.values.map((c) => cellValue(data, c, r));
    if (!row.every((v) => Number.isFinite(v) && v >= 0)) continue;
    row.forEach((v, k) => rings[k].push(v));
    labels.push(labelAt(data, picks, cats, r));
  }
  const drawable = n > 0 && labels.length > 0 && rings.every((ring) => ring.some((v) => v > 0));
  if (!drawable) return { spec: null, dropped: total, total };
  return {
    spec: { rings, labels, hole, colors: opts.colors, title: opts.title, filename: opts.filename },
    dropped: total - labels.length,
    total,
  };
}

/** One sentence naming the rows the chart leaves out, or null when none. */
export function droppedPieRows(dropped: number, total: number): string | null {
  if (dropped <= 0) return null;
  const one = dropped === 1;
  return `${dropped} of ${total} rows ${one ? "has" : "have"} a non-finite or negative value and ${one ? "was" : "were"} left out.`;
}

/** `Values: B, C` — the picked value columns, for the panel. */
export function valueNames(data: DataStruct, values: number[]): string {
  return values.map((c) => columnLabel(data, c)).join(", ");
}
