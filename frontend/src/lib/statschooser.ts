// Test chooser (#26) — pure helpers behind the "which stats test?" workshop.
// Builds the group vectors the /api/stats/recommend chooser wants (either one
// group per selected column, or a value column partitioned by a categorical
// column), maps the recommended endpoint to a runnable request body, and
// flattens a test-result dict into displayable rows. Pure (no React / store /
// fetch) so every branch unit-tests standalone.

import type { DataStruct } from "./types";

/** One candidate group: a label for the UI + its finite values. */
export interface GroupSpec {
  label: string;
  values: number[];
}

/** What /api/stats/recommend returns (mirrors calc.stats_tests.recommend_test). */
export interface Recommendation {
  recommendation: string;
  endpoint: string;
  parametric: boolean;
  n_groups: number;
  paired: boolean;
  checks: { alpha: number; shapiro_p: number[]; levene_p?: number };
  reasons: string[];
}

const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

const finite = (xs: number[]): number[] => xs.filter((v) => Number.isFinite(v));

/** Columns mode: each picked column (-1 = x, 0.. = channels) is one group. */
export function groupsFromColumns(data: DataStruct, cols: readonly number[]): GroupSpec[] {
  const xName = String(data.metadata?.["x_column_name"] ?? "x");
  return cols.map((c) => ({
    label: c < 0 ? xName : (data.labels[c] ?? `col ${c}`),
    values: finite(colValues(data, c)),
  }));
}

/** Group-by mode: partition `valueCol` by the distinct levels of `byCol`
 *  (finite pairs only), one group per level in ascending level order. */
export function groupsByCategory(
  data: DataStruct,
  valueCol: number,
  byCol: number,
): GroupSpec[] {
  const by = colValues(data, byCol);
  const val = colValues(data, valueCol);
  const byLabel = byCol < 0 ? "x" : (data.labels[byCol] ?? `col ${byCol}`);
  const parts = new Map<number, number[]>();
  const n = Math.min(by.length, val.length);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(by[i]) || !Number.isFinite(val[i])) continue;
    const bucket = parts.get(by[i]);
    if (bucket) bucket.push(val[i]);
    else parts.set(by[i], [val[i]]);
  }
  return [...parts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, values]) => ({ label: `${byLabel} = ${level}`, values }));
}

// ── Indexed groups (box/strip "show points" jitter, JMP_GAP J5 #1) ─────────
// Same partitions as `groupsFromColumns`/`groupsByCategory` above, but each
// value keeps its ORIGINAL dataset row index alongside it -- the jittered
// point overlay hashes `(rowIndex, category)` (lib/jitter.ts), not a point's
// position within the filtered group, so excluding a row (#50) never
// reshuffles its still-visible neighbours.

export interface IndexedPoint {
  value: number;
  rowIndex: number;
}

export interface IndexedGroupSpec {
  label: string;
  points: IndexedPoint[];
}

/** Columns mode, index-preserving counterpart to `groupsFromColumns`. */
export function groupsFromColumnsIndexed(
  data: DataStruct,
  cols: readonly number[],
): IndexedGroupSpec[] {
  const xName = String(data.metadata?.["x_column_name"] ?? "x");
  return cols.map((c) => {
    const vs = colValues(data, c);
    const points: IndexedPoint[] = [];
    for (let i = 0; i < vs.length; i++) {
      if (Number.isFinite(vs[i])) points.push({ value: vs[i], rowIndex: i });
    }
    return { label: c < 0 ? xName : (data.labels[c] ?? `col ${c}`), points };
  });
}

/** Group-by mode, index-preserving counterpart to `groupsByCategory`. */
export function groupsByCategoryIndexed(
  data: DataStruct,
  valueCol: number,
  byCol: number,
): IndexedGroupSpec[] {
  const by = colValues(data, byCol);
  const val = colValues(data, valueCol);
  const byLabel = byCol < 0 ? "x" : (data.labels[byCol] ?? `col ${byCol}`);
  const parts = new Map<number, IndexedPoint[]>();
  const n = Math.min(by.length, val.length);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(by[i]) || !Number.isFinite(val[i])) continue;
    const point: IndexedPoint = { value: val[i], rowIndex: i };
    const bucket = parts.get(by[i]);
    if (bucket) bucket.push(point);
    else parts.set(by[i], [point]);
  }
  return [...parts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, points]) => ({ label: `${byLabel} = ${level}`, points }));
}

/** Build the request for the RECOMMENDED endpoint from the same groups the
 *  chooser saw. Returns null for an endpoint this UI doesn't know how to run
 *  (the chooser's set is closed, so null means a backend/frontend drift). */
export function buildRunRequest(
  endpoint: string,
  groups: readonly (readonly number[])[],
  paired: boolean,
): { path: string; body: Record<string, unknown> } | null {
  const [g0, g1] = groups;
  switch (endpoint) {
    case "/api/stats/ttest":
      if (groups.length === 1) return { path: endpoint, body: { x: g0, mu: 0 } };
      return { path: endpoint, body: { x: g0, y: g1, paired } };
    case "/api/stats/wilcoxon":
      if (groups.length === 1) return { path: endpoint, body: { x: g0, mu: 0 } };
      return { path: endpoint, body: { x: g0, y: g1 } };
    case "/api/stats/mann-whitney":
      return { path: endpoint, body: { x: g0, y: g1 } };
    case "/api/stats/anova":
      return { path: endpoint, body: { groups } };
    case "/api/stats/kruskal":
      return { path: endpoint, body: { groups } };
    default:
      return null;
  }
}

/** Flatten a test result to displayable [name, value] rows: scalar fields
 *  only (numbers / booleans / short strings), arrays and objects dropped. */
export function resultRows(result: Record<string, unknown>): [string, string | number][] {
  const rows: [string, string | number][] = [];
  for (const [k, v] of Object.entries(result)) {
    if (typeof v === "number") rows.push([k, v]);
    else if (typeof v === "boolean") rows.push([k, String(v)]);
    else if (typeof v === "string" && v.length <= 80) rows.push([k, v]);
  }
  return rows;
}

/** The single record for a #36 stats_table report: test name + scalar fields. */
export function reportRecord(
  testName: string,
  result: Record<string, unknown>,
): Record<string, unknown> {
  return { test: testName, ...Object.fromEntries(resultRows(result)) };
}
