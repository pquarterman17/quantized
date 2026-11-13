// Frequency count / binning to a TABLE (worksheet audit #19) — Origin's
// Statistics ▸ Descriptive ▸ Frequency Count. Pure: values in, a new
// worksheet's DataStruct out (store/worksheetStatsRun.ts adds it).
//
// Binning rules, stated once:
//   - Bins are equal-width over [min, max] (the data's own range unless given).
//     Every bin is half-open [lo, hi) EXCEPT the last, which also counts a
//     value exactly at max — so the data's own maximum is never lost.
//   - A value is binned by comparing it against the PUBLISHED edges (the very
//     numbers in the Bin start / Bin end columns), never by floor((v - lo) /
//     width): the two disagree by one ulp at grid-aligned values, which put a
//     value in a bin whose stated range excluded it. Recounting by the table's
//     own edges therefore always reproduces its counts.
//   - The bin count is given, or derived from a given width (ceil((max-min) /
//     width)), or Sturges' rule (ceil(log2 n) + 1) by default.
//   - Blank (NaN) cells are MISSING; finite values outside [min, max] are
//     OUTSIDE. Neither is counted in any bin; both are reported in the notes,
//     and the percentages are of the counted values.

import type { DataStruct } from "./types";

export interface FrequencyOptions {
  bins?: number;
  width?: number;
  min?: number;
  max?: number;
}

export interface FrequencyTable {
  lo: number[];
  hi: number[];
  centers: number[];
  counts: number[];
  cumulative: number[];
  percent: number[];
  cumulativePercent: number[];
  counted: number;
  missing: number;
  outside: number;
}

export function frequencyTable(values: readonly number[], opts: FrequencyOptions = {}): FrequencyTable {
  const finite = values.filter((v) => Number.isFinite(v));
  const missing = values.length - finite.length;
  if (!finite.length && (opts.min === undefined || opts.max === undefined)) throw new Error("the column has no finite values to bin");
  let lo = opts.min ?? Infinity;
  let hi = opts.max ?? -Infinity;
  if (opts.min === undefined || opts.max === undefined) {
    for (const v of finite) {
      if (opts.min === undefined && v < lo) lo = v;
      if (opts.max === undefined && v > hi) hi = v;
    }
  }
  if (!(Number.isFinite(lo) && Number.isFinite(hi)) || hi < lo) throw new Error("the bin range must be finite with max ≥ min");
  if (hi === lo) hi = lo + 1; // one value repeated: a single unit-wide bin
  let n: number;
  if (opts.width !== undefined) {
    if (!(opts.width > 0)) throw new Error("the bin width must be positive");
    n = Math.max(1, Math.ceil((hi - lo) / opts.width - 1e-9));
    hi = lo + n * opts.width;
  } else {
    n = opts.bins ?? Math.ceil(Math.log2(Math.max(finite.length, 1))) + 1;
    if (!Number.isInteger(n) || n < 1) throw new Error("the number of bins must be a positive integer");
  }
  if (n > 100_000) throw new Error("more than 100,000 bins; use a wider bin");
  const width = (hi - lo) / n;
  const counts = new Array<number>(n).fill(0);
  // The published edges: bin i is [edgesLo[i], edgesHi[i]), the last closed.
  const edgesLo = counts.map((_, i) => lo + i * width);
  const edgesHi = counts.map((_, i) => (i === n - 1 ? hi : lo + (i + 1) * width));
  let outside = 0;
  for (const v of finite) {
    if (v < lo || v > hi) {
      outside++;
      continue;
    }
    // The arithmetic guess, corrected against the edges themselves.
    let i = Math.min(n - 1, Math.max(0, Math.floor((v - lo) / width)));
    while (i > 0 && v < edgesLo[i]) i--;
    while (i < n - 1 && v >= edgesHi[i]) i++;
    counts[i]++;
  }
  const counted = finite.length - outside;
  let running = 0;
  const cumulative = counts.map((c) => (running += c));
  const pct = (c: number) => (counted ? (100 * c) / counted : Number.NaN);
  return {
    lo: edgesLo,
    hi: edgesHi,
    centers: edgesLo.map((l, i) => (l + edgesHi[i]) / 2),
    counts,
    cumulative,
    percent: counts.map(pct),
    cumulativePercent: cumulative.map(pct),
    counted,
    missing,
    outside,
  };
}

/** The frequency table as a worksheet: x = bin center. */
export function frequencyWorksheet(table: FrequencyTable, label: string, unit: string, sourceName: string): DataStruct {
  const notes = [`Frequency count of ${label} from ${sourceName}: ${table.counted} value(s) in ${table.counts.length} bin(s); each bin is [start, end) except the last, which includes its end.`];
  if (table.missing) notes.push(`${table.missing} blank cell(s) were not counted.`);
  if (table.outside) notes.push(`${table.outside} value(s) outside [${table.lo[0]}, ${table.hi.at(-1)}] were not counted.`);
  return {
    time: table.centers,
    values: table.counts.map((c, i) => [table.lo[i], table.hi[i], c, table.cumulative[i], table.percent[i], table.cumulativePercent[i]]),
    labels: ["Bin start", "Bin end", "Count", "Cumulative count", "Percent", "Cumulative percent"],
    units: [unit, unit, "", "", "%", "%"],
    metadata: {
      x_column_name: "Bin center",
      x_column_unit: unit,
      xUnit: unit,
      frequency_count: { source: sourceName, column: label, missing: table.missing, outside: table.outside },
      notes,
    },
  };
}
