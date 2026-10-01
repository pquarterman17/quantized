// Ternary request builder — pure: three composition columns (+ an optional
// colour column) of a DataStruct -> the `/api/export/ternary-figure` body.
//
// The renderer (calc/figure_ternary.py) normalizes each row to sum to 1 and
// rejects a negative or all-zero row with a 422 for the WHOLE request, and
// its pydantic model takes no null cell — so the rows it could not draw are
// left out HERE, counted, and named in one sentence (the log-axis notice
// style): a non-finite component, a negative one, an all-zero row, or (when
// colouring) a non-finite colour value.

import type { TernaryFigureSpec } from "../../../lib/api/figures";
import type { DataStruct } from "../../../lib/types";
import { cellValue, columnLabel } from "./auxColumns";

export interface TernaryPicks {
  a: number;
  b: number;
  c: number;
  /** Channel to colour points by, or null for a single colour. */
  colorBy: number | null;
}

export interface TernaryOptions {
  title: string;
  filename: string;
}

export interface TernaryBuild {
  /** null when no row is drawable. */
  spec: TernaryFigureSpec | null;
  dropped: number;
  total: number;
}

function drawable(row: number[]): boolean {
  return row.every((v) => Number.isFinite(v) && v >= 0) && row.some((v) => v > 0);
}

export function buildTernaryRequest(data: DataStruct, picks: TernaryPicks, opts: TernaryOptions): TernaryBuild {
  const total = data.time.length;
  const rows: number[][] = [];
  const values: number[] = [];
  for (let r = 0; r < total; r++) {
    const row = [cellValue(data, picks.a, r), cellValue(data, picks.b, r), cellValue(data, picks.c, r)];
    if (!drawable(row)) continue;
    if (picks.colorBy !== null) {
      const v = cellValue(data, picks.colorBy, r);
      if (!Number.isFinite(v)) continue;
      values.push(v);
    }
    rows.push(row);
  }
  if (rows.length === 0) return { spec: null, dropped: total, total };
  return {
    spec: {
      data: rows,
      labels: [columnLabel(data, picks.a), columnLabel(data, picks.b), columnLabel(data, picks.c)],
      values: picks.colorBy !== null ? values : null,
      title: opts.title,
      filename: opts.filename,
    },
    dropped: total - rows.length,
    total,
  };
}

/** One sentence naming the rows the figure leaves out, or null when none. */
export function droppedRowsNotice(dropped: number, total: number): string | null {
  if (dropped <= 0) return null;
  const one = dropped === 1;
  return `${dropped} of ${total} rows ${one ? "has" : "have"} a non-finite, negative or all-zero value and ${one ? "was" : "were"} left out.`;
}
