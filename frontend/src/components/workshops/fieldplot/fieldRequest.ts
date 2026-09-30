// Vector-field request builder — pure: X, Y, U, V columns of a DataStruct
// -> the regular grid `/api/export/field-figure` takes (`x_axis`/`y_axis`
// 1-D, `u_grid`/`v_grid` shaped (ny, nx)), or one sentence on why not.
//
// The route supports a regular grid only, so scattered rows are placed by
// their exact X and Y values: the distinct X values become the columns, the
// distinct Y values the rows, and every (x, y) cell must be filled exactly
// once — a gap cannot be sent (the pydantic model takes no null cell and
// streamlines need a complete field) and a duplicate has no single answer.
// Rows with a non-finite value are counted out first, the same way the
// ternary builder does.

import type { FieldFigureSpec } from "../../../lib/api/figures";
import type { DataStruct } from "../../../lib/types";
import { cellValue, columnAxisLabel } from "../ternary/auxColumns";

export interface FieldPicks {
  x: number;
  y: number;
  u: number;
  v: number;
}

export interface FieldOptions {
  kind: "quiver" | "streamline";
  title: string;
  filename: string;
  /** Axis labels; default to the picked columns' `label (unit)`. */
  xLabel?: string;
  yLabel?: string;
}

export interface FieldBuild {
  /** null when the rows cannot form a grid (`error` says why). */
  spec: FieldFigureSpec | null;
  dropped: number;
  total: number;
  error: string | null;
}

/** Guard against a "grid" that is really a scatter with all-distinct X and Y. */
const MAX_CELLS = 250_000;

function sortedDistinct(values: number[]): number[] {
  return [...new Set(values)].sort((p, q) => p - q);
}

export function buildFieldRequest(data: DataStruct, picks: FieldPicks, opts: FieldOptions): FieldBuild {
  const total = data.time.length;
  const rows: [number, number, number, number][] = [];
  for (let r = 0; r < total; r++) {
    const row: [number, number, number, number] = [
      cellValue(data, picks.x, r),
      cellValue(data, picks.y, r),
      cellValue(data, picks.u, r),
      cellValue(data, picks.v, r),
    ];
    if (row.every(Number.isFinite)) rows.push(row);
  }
  const dropped = total - rows.length;
  const fail = (error: string): FieldBuild => ({ spec: null, dropped, total, error });

  const xs = sortedDistinct(rows.map((r) => r[0]));
  const ys = sortedDistinct(rows.map((r) => r[1]));
  if (xs.length < 2 || ys.length < 2) {
    return fail("A vector field needs at least two distinct X and two distinct Y values.");
  }
  const cells = xs.length * ys.length;
  if (cells > MAX_CELLS) return fail(`X and Y span ${cells} grid points, more than a field can draw.`);

  const xIndex = new Map(xs.map((x, i) => [x, i]));
  const yIndex = new Map(ys.map((y, i) => [y, i]));
  const u: (number | null)[][] = ys.map(() => xs.map(() => null));
  const v: (number | null)[][] = ys.map(() => xs.map(() => null));
  let duplicates = 0;
  for (const [x, y, uu, vv] of rows) {
    const i = xIndex.get(x) as number;
    const j = yIndex.get(y) as number;
    if (u[j][i] !== null) duplicates++;
    u[j][i] = uu;
    v[j][i] = vv;
  }
  if (duplicates > 0) {
    const one = duplicates === 1;
    return fail(`${duplicates} X×Y grid point${one ? " is" : "s are"} filled by more than one row, so no field can be drawn.`);
  }
  const filled = rows.length;
  if (filled < cells) return fail(`Rows cover ${filled} of the ${cells} X×Y grid points, so no field can be drawn.`);

  return {
    spec: {
      x_axis: xs,
      y_axis: ys,
      u_grid: u as number[][],
      v_grid: v as number[][],
      kind: opts.kind,
      title: opts.title,
      x_label: opts.xLabel ?? columnAxisLabel(data, picks.x),
      y_label: opts.yLabel ?? columnAxisLabel(data, picks.y),
      filename: opts.filename,
    },
    dropped,
    total,
    error: null,
  };
}

/** One sentence naming the rows left out before gridding, or null when none. */
export function droppedFieldRowsNotice(dropped: number, total: number): string | null {
  if (dropped <= 0) return null;
  const one = dropped === 1;
  return `${dropped} of ${total} rows ${one ? "has" : "have"} a non-finite value and ${one ? "was" : "were"} left out.`;
}
