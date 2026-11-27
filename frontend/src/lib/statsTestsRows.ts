// Statistical-tests workshop — row-wise t-tests and the Mann-Kendall trend test
// (Origin feature-gap item 8): catalog entries, settings and the pure request
// builders. Delegated to by statsTests.ts so that file stays small.
//
// Row-wise t-tests: group A is `sel.cols`, group B is `rowt.groupB`; each row of
// the ANALYSIS view (so excluded / filtered rows are left out) is tested on its
// own. Two variance models, always an explicit choice: Student (pooled; what
// Origin's row-wise test does) and Welch (unequal variances; what quantized's
// single two-sample t-test does). The default is Welch, matching that existing
// t-test; the pooled form is one select away and is labelled as Origin's.
//
// Mann-Kendall: the first column is time (or order), the second the values; rows
// where either is missing are dropped as pairs.

import type { StatsTestId } from "./api/statsTests";
import { isCategoricalChannel } from "./categorical";
import { columnDisplayName } from "./statschooser";
import type { BuildOutcome, TestDef, TestParams, TestSelection } from "./statsTests";
import type { DataStruct } from "./types";

export type RowTDesign = "two-sample" | "one-sample" | "paired";
export type RowTVariance = "pooled" | "welch";

export type RowTParams = {
  /** Group B columns (unused by the one-sample design). */
  groupB: number[];
  design: RowTDesign;
  variance: RowTVariance;
  /** Null value of the estimate: a hypothesised mean, or mean difference. */
  mu: number;
};

export const DEFAULT_ROWT: RowTParams = { groupB: [], design: "two-sample", variance: "welch", mu: 0 };

export const ROWT_VARIANCES: readonly { id: RowTVariance; label: string }[] = [
  { id: "pooled", label: "Student (pooled variance; Origin's row-wise default)" },
  { id: "welch", label: "Welch (unequal variances)" },
];

export const ROWT_DESIGNS: readonly { id: RowTDesign; label: string }[] = [
  { id: "two-sample", label: "Two-sample: A against B" },
  { id: "one-sample", label: "One-sample: A against a value" },
  { id: "paired", label: "Paired: column k of A with column k of B" },
];

export const ROWS_TESTS: readonly TestDef[] = [
  { id: "row-t-tests", family: "Compare two", label: "Row-wise t-tests", input: "rowwise", blurb: "Test every row on its own: one group of columns against another, against a value, or paired columns, giving one result row per input row." },
  { id: "mann-kendall", family: "Correlation", label: "Mann-Kendall trend (Sen's slope)", input: "paired", blurb: "Is there a monotonic trend over time or order, with no normality assumption, and how steep is it (first column = time or order, second = the values)?" },
];

export const ROWS_IDS: ReadonlySet<StatsTestId> = new Set(ROWS_TESTS.map((t) => t.id));

const col = (data: DataStruct, i: number): number[] => (i < 0 ? data.time : data.values.map((r) => r[i]));
const fail = (error: string): BuildOutcome => ({ ok: false, error });
const sortedCols = (cs: readonly number[]): number[] => [...cs].sort((a, b) => a - b);

/** Group A and B as the builder and `rowsColumns` both read them (paired columns pair in worksheet order). */
export function rowTGroups(sel: TestSelection, rt: RowTParams): { a: number[]; b: number[] } {
  const paired = rt.design === "paired";
  return {
    a: paired ? sortedCols(sel.cols) : [...sel.cols],
    b: rt.design === "one-sample" ? [] : paired ? sortedCols(rt.groupB) : [...rt.groupB],
  };
}

/** Worksheet columns the row tests read, in builder order. */
export function rowsColumns(id: StatsTestId, sel: TestSelection, rt: RowTParams): number[] {
  if (id === "mann-kendall") return [sel.x, sel.y];
  const { a, b } = rowTGroups(sel, rt);
  return [...a, ...b];
}

function buildRowT(data: DataStruct, sel: TestSelection, p: TestParams): BuildOutcome {
  const rt = p.rowt;
  const { a, b } = rowTGroups(sel, rt);
  const name = (c: number) => columnDisplayName(data, c);
  if (a.length === 0) return fail("Pick the columns of group A (the replicates across each row).");
  if (rt.design !== "one-sample" && b.length === 0) return fail("Pick the columns of group B.");
  const both = a.find((c) => b.includes(c));
  if (both !== undefined) return fail(`${name(both)} is in both group A and group B.`);
  if (rt.design === "paired" && a.length !== b.length) {
    return fail(`Paired columns need the same number in A and B (A has ${a.length}, B has ${b.length}); column k of A is paired with column k of B in worksheet order.`);
  }
  const cat = [...a, ...b].find((c) => c >= 0 && isCategoricalChannel(data, c));
  if (cat !== undefined) return fail(`${name(cat)} is categorical; the row tests need numeric columns.`);
  if (!Number.isFinite(rt.mu)) return fail("The null value must be a number.");
  if (data.time.length === 0) return fail("The worksheet has no rows.");
  const block = (cs: number[]) => {
    const src = cs.map((c) => col(data, c));
    return data.time.map((_, i) => src.map((s) => (Number.isFinite(s[i]) ? s[i] : null)));
  };
  const body = {
    a: block(a), ...(b.length ? { b: block(b) } : {}),
    design: rt.design, variance: rt.variance, mu: rt.mu, alpha: p.alpha, alternative: p.alternative,
  };
  const label = (cs: number[]) => cs.map(name).join(", ");
  const labels = b.length ? [label(a), label(b)] : [label(a)];
  return { ok: true, request: { id: "row-t-tests", body }, labels, rowX: [...data.time] };
}

function buildMannKendall(data: DataStruct, sel: TestSelection, p: TestParams): BuildOutcome {
  if (sel.x === sel.y) return fail("Pick two different columns: time (or order) and the values.");
  const xs = col(data, sel.x);
  const ys = col(data, sel.y);
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) { x.push(xs[i]); y.push(ys[i]); }
  }
  if (y.length < 3) return fail("The Mann-Kendall test needs at least 3 rows where both columns are numbers.");
  return { ok: true, request: { id: "mann-kendall", body: { y, x, alpha: p.alpha } }, labels: [columnDisplayName(data, sel.x), columnDisplayName(data, sel.y)] };
}

export function buildRowsRequest(id: StatsTestId, data: DataStruct | null, sel: TestSelection, p: TestParams): BuildOutcome {
  if (!data) return fail("Select a dataset to analyze.");
  return id === "mann-kendall" ? buildMannKendall(data, sel, p) : buildRowT(data, sel, p);
}

/** The settings a result / input review shows (label, value). */
export function rowTSettings(p: TestParams): [string, string][] {
  const rt = p.rowt;
  const rows: [string, string][] = [["Design", ROWT_DESIGNS.find((d) => d.id === rt.design)?.label ?? rt.design]];
  if (rt.design === "two-sample") rows.push(["Variance", ROWT_VARIANCES.find((v) => v.id === rt.variance)?.label ?? rt.variance]);
  rows.push(["Null value", String(rt.mu)], ["Alternative", p.alternative]);
  return rows;
}

/** Restore `rowt` from a saved record: absent -> defaults; present but invalid -> null. */
export function restoreRowT(raw: unknown): RowTParams | null {
  if (raw === undefined) return DEFAULT_ROWT;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const ok = Array.isArray(r.groupB) && r.groupB.every((n) => Number.isInteger(n)) &&
    ROWT_DESIGNS.some((d) => d.id === r.design) && ROWT_VARIANCES.some((v) => v.id === r.variance) &&
    typeof r.mu === "number" && Number.isFinite(r.mu);
  return ok ? (r as unknown as RowTParams) : null;
}
