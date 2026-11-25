// Polar map / pole figure from a MATRIX worksheet: rows run along one angle,
// columns along the other, one intensity per cell. Pure: the matrix is
// unrolled into the SAME long-form DataStruct the column input takes (phi as
// the X column, then chi and intensity), so the request, the server render and
// the export are the existing ones and a matrix gives the identical figure to
// the equivalent long-format dataset.
//
// Axis values: the column angles come from the matrix headers (the channel
// labels, read as numbers) or from a user-entered start/step; the row angles
// come from the dataset's X column or from start/step. Fail closed (provisional,
// owner to confirm): non-numeric or duplicate headers, an axis that is not
// strictly monotonic or not evenly spaced (relative tolerance 1e-6), a zero or
// non-finite step, and an unchosen row/column role are refused with the reason
// rather than guessed.

import type { DataStruct } from "../../../lib/types";

export type MatrixRowsAre = "" | "chi" | "phi";
export interface MatrixAxisSource {
  /** Row axis: "x" = the X column; column axis: "headers" = the channel labels. */
  from: "data" | "range";
  start: string;
  step: string;
}
export interface PolarMatrixConfig {
  rowsAre: MatrixRowsAre;
  rows: MatrixAxisSource;
  cols: MatrixAxisSource;
}

export const emptyMatrixConfig = (): PolarMatrixConfig => ({
  rowsAre: "",
  rows: { from: "data", start: "0", step: "5" },
  cols: { from: "data", start: "0", step: "5" },
});

export const MATRIX_SPACING_TOL = 1e-6;

type Axis = { values: number[]; error?: undefined } | { error: string; values?: undefined };

/** Refuse an axis that is not strictly monotonic and evenly spaced. */
export function checkEvenAxis(values: number[], name: string): string | null {
  if (values.length < 2) return `${name} needs at least 2 values.`;
  if (!values.every(Number.isFinite)) return `${name} contains a value that is not a number.`;
  const d = values.slice(1).map((v, i) => v - values[i]!);
  const dir = Math.sign(d[0]!);
  if (dir === 0 || d.some((x) => Math.sign(x) !== dir)) return `${name} is not strictly increasing or decreasing (repeated or out-of-order values).`;
  const mean = (values[values.length - 1]! - values[0]!) / d.length;
  if (d.some((x) => Math.abs(x - mean) > MATRIX_SPACING_TOL * Math.abs(mean))) return `${name} is unevenly spaced; a matrix needs a constant step.`;
  return null;
}

function rangeAxis(src: MatrixAxisSource, n: number, name: string): Axis {
  const start = Number(src.start), step = Number(src.step);
  if (src.start.trim() === "" || !Number.isFinite(start)) return { error: `${name}: enter a numeric start.` };
  if (src.step.trim() === "" || !Number.isFinite(step) || step === 0) return { error: `${name}: enter a non-zero numeric step.` };
  return { values: Array.from({ length: n }, (_, i) => start + i * step) };
}

function axisFor(src: MatrixAxisSource, n: number, name: string, fromData: () => number[]): Axis {
  const a = src.from === "range" ? rangeAxis(src, n, name) : { values: fromData() };
  if (a.error !== undefined) return a;
  const bad = checkEvenAxis(a.values, name);
  return bad ? { error: bad } : a;
}

export type PolarMatrixResult = { data: DataStruct; problem?: undefined } | { problem: string; data?: undefined };

/** Unroll a matrix worksheet into the long-form polar-map input. */
export function matrixToPolarData(src: DataStruct, cfg: PolarMatrixConfig): PolarMatrixResult {
  if (cfg.rowsAre === "") return { problem: "Say which angle the matrix rows are (tilt chi or azimuth phi); it is not guessed." };
  const nr = src.time.length, nc = src.labels.length;
  if (nr < 2 || nc < 2) return { problem: "A matrix needs at least 2 rows and 2 columns." };
  const rows = axisFor(cfg.rows, nr, "Row axis", () => src.time.map(Number));
  if (rows.error !== undefined) return { problem: rows.error };
  const cols = axisFor(cfg.cols, nc, "Column axis", () => {
    const heads = src.labels.map((l) => (l.trim() === "" ? NaN : Number(l.trim())));
    return heads;
  });
  if (cols.error !== undefined) {
    return { problem: cfg.cols.from === "data" ? `Column headers are not usable as angles: ${cols.error} Enter a start and step instead.` : cols.error };
  }
  const time: number[] = [];
  const values: number[][] = [];
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const v = src.values[r]?.[c];
      const rowAngle = rows.values[r]!, colAngle = cols.values[c]!;
      const [chi, phi] = cfg.rowsAre === "chi" ? [rowAngle, colAngle] : [colAngle, rowAngle];
      time.push(phi);
      values.push([chi, typeof v === "number" ? v : NaN]);
    }
  }
  return {
    data: { time, values, labels: ["Chi", "Intensity"], units: ["deg", src.units[0] ?? ""], metadata: { x_column_name: "Phi" } },
  };
}
