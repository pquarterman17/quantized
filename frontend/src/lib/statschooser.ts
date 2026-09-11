// Test chooser (#26) — pure helpers behind the "which stats test?" workshop.
// Builds the group vectors the /api/stats/recommend chooser wants (either one
// group per selected column, or a value column partitioned by a categorical
// column), maps the recommended endpoint to a runnable request body, and
// flattens a test-result dict into displayable rows. Pure (no React / store /
// fetch) so every branch unit-tests standalone.

import { resolveCategoryLabels } from "./barlayout";
import { categoryLevels } from "./categorical";
import { nestedLevels } from "./nestedLevels";
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

/** Keep statistical labels aligned with plots, filters, and Tabulate: a
 *  categorical code is implementation detail, while the text the scientist
 *  assigned is what they expect to read on a group.
 *
 *  Resolved through `barlayout.resolveCategoryLabels` — the SAME three-source
 *  precedence Tabulate, Fit Y by X, Data Filter, facets and `plotdata` use
 *  (level table, then an Origin text column that consistently covers every
 *  level, then formatted numerics). `categorical.groupLevelLabel` reads the
 *  level table ONLY, which is not enough here: a channel is categorical
 *  whenever `channelModelingType` says so, including via a `channelTypes`
 *  override or `inferModelingType`, and an Origin `.opj` import is exactly
 *  that shape — numeric codes plus `origin_text_columns`, no `cat_levels`.
 *  Using the narrower accessor made Stat Stage print "batch = 0" for the same
 *  column Data Filter and Tabulate label "Reference".
 *
 *  Resolves the whole level set in ONE call rather than per group: the Origin
 *  text-column source scans the column to prove it covers every level, so
 *  per-level resolution would re-walk it once per group. */
const categoryGroupLabels = (
  data: DataStruct,
  byCol: number,
  levels: readonly number[],
): string[] => {
  const byLabel = byCol < 0 ? "x" : (data.labels[byCol] ?? `col ${byCol}`);
  return resolveCategoryLabels(data, byCol, levels).map((text) => `${byLabel} = ${text}`);
};

/** Columns mode: each picked column (-1 = x, 0.. = channels) is one group. */
export function groupsFromColumns(data: DataStruct, cols: readonly number[]): GroupSpec[] {
  const xName = String(data.metadata?.["x_column_name"] ?? "x");
  return cols.map((c) => ({
    label: c < 0 ? xName : (data.labels[c] ?? `col ${c}`),
    values: finite(colValues(data, c)),
  }));
}

/** Group-by mode: partition `valueCol` by the distinct levels of `byCol`
 *  (finite pairs only), one group per level in the level's DISPLAY order.
 *
 *  JMP_GAP J1: display order, not ascending-by-code. This used to sort the
 *  partition's own keys numerically, which made box/violin/strip the one
 *  order-sensitive surface that ignored a user's chosen level order while bar
 *  layout, the XY group split, Tabulate and facets all honoured it — reorder
 *  the levels and the bars moved while the boxes did not.
 *
 *  `categoryLevels` is the one accessor that answers "the levels, in order";
 *  going through it is what keeps the two from disagreeing again.
 *
 *  NARROWED after review: an earlier version of this note also claimed the
 *  backend's `_ordered_levels` honoured the order "so the exported PDF" did.
 *  That is true of the XY colour split it governs (`build_grouped_series`) and
 *  NOT of this plot family — a box/violin export posts explicit `data`/`labels`
 *  built right here (`lib/api/figures.ts` -> `routes/export_statplots.py`), so
 *  before this fix the exported PDF faithfully reproduced the wrongly-ordered
 *  screen. The divergence was between PLOT FAMILIES, not screen vs export.
 *
 *  Membership is still the PARTITION's, not the level table's: a level present
 *  in `byCol` whose `valueCol` rows are all non-finite has no bucket here and
 *  must not become an empty group, so the ordered levels are filtered by what
 *  was actually collected. `categoryLevels` returns exactly the set `levelsOf`
 *  would, so that filter can only ever remove — never reorder or drop a real
 *  group. */
export function groupsByCategory(
  data: DataStruct,
  valueCol: number,
  byCol: number,
): GroupSpec[] {
  const by = colValues(data, byCol);
  const val = colValues(data, valueCol);
  const parts = new Map<number, number[]>();
  const n = Math.min(by.length, val.length);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(by[i]) || !Number.isFinite(val[i])) continue;
    const bucket = parts.get(by[i]);
    if (bucket) bucket.push(val[i]);
    else parts.set(by[i], [val[i]]);
  }
  const levels = categoryLevels(data, byCol).filter((level) => parts.has(level));
  const labels = categoryGroupLabels(data, byCol, levels);
  return levels.map((level, i) => ({ label: labels[i], values: parts.get(level) ?? [] }));
}

/** NESTED (two-factor) group-by: one group per (factor-A, factor-B) cell that
 *  actually has finite values, in nested display order — factor A's levels in
 *  their display order, and within each, the B levels co-occurring with it in
 *  theirs (PRIMARY_SOFTWARE_AUDIT_PLAN.md:1143, "lot/wafer/type can form nested
 *  grouping for a box plot").
 *
 *  The level structure and its ORDER come from `lib/nestedLevels.ts`, shared
 *  with the variability chart, so the two cannot come to disagree about what a
 *  user's level order means — the specific failure Group O-1 and O-2 each cost
 *  a review round.
 *
 *  FLAT, not hierarchical: a box axis has one slot per box, so this returns the
 *  same `GroupSpec[]` the single-factor path does and every downstream consumer
 *  (box stats, the Canvas renderer, the pre-aggregated export) keeps working
 *  unchanged. The nesting survives in the ORDER and in the composite label.
 *
 *  Empty cells are dropped, exactly as the single-factor path drops a level
 *  whose value rows are all non-finite: a box with no values is not a box. */
export function groupsByNestedCategory(
  data: DataStruct,
  valueCol: number,
  factorACol: number,
  factorBCol: number,
): GroupSpec[] {
  const a = colValues(data, factorACol);
  const b = colValues(data, factorBCol);
  const val = colValues(data, valueCol);
  const n = Math.min(a.length, b.length, val.length);
  const out: GroupSpec[] = [];
  for (const lvl of nestedLevels(data, factorACol, factorBCol)) {
    for (let bi = 0; bi < lvl.bCodes.length; bi++) {
      const values: number[] = [];
      for (let r = 0; r < n; r++) {
        if (a[r] === lvl.aCode && b[r] === lvl.bCodes[bi] && Number.isFinite(val[r])) {
          values.push(val[r]);
        }
      }
      if (values.length > 0) {
        out.push({ label: nestedLabel(data, factorACol, factorBCol, lvl.aLabel, lvl.bLabels[bi]), values });
      }
    }
  }
  return out;
}

/** `lot = 1 / wafer = 3` — the single-factor convention
 *  (`categoryGroupLabels`' `"{column} = {level}"`) applied to both factors and
 *  joined, so a nested tick reads the same way a flat one does and names both
 *  columns. Deliberately NOT just `"1 / 3"`: a nested box axis is the one place
 *  a bare code is most ambiguous, since the same B code under two A levels is a
 *  different thing entirely. */
function nestedLabel(
  data: DataStruct,
  factorACol: number,
  factorBCol: number,
  aLabel: string,
  bLabel: string,
): string {
  const aName = factorACol < 0 ? "x" : (data.labels[factorACol] ?? `col ${factorACol}`);
  const bName = factorBCol < 0 ? "x" : (data.labels[factorBCol] ?? `col ${factorBCol}`);
  return `${aName} = ${aLabel} / ${bName} = ${bLabel}`;
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

/** Index-preserving counterpart to `groupsByNestedCategory`, and it MUST stay
 *  in lockstep with it for the same reason the single-factor pair must: this
 *  one feeds the jittered raw-point overlay, so if the two ordered or filtered
 *  differently a box would sit over another cell's points. Both walk the same
 *  `nestedLevels` structure, drop empty cells on the same test, and build the
 *  same label — pinned by a test that compares their labels directly. */
export function groupsByNestedCategoryIndexed(
  data: DataStruct,
  valueCol: number,
  factorACol: number,
  factorBCol: number,
): IndexedGroupSpec[] {
  const a = colValues(data, factorACol);
  const b = colValues(data, factorBCol);
  const val = colValues(data, valueCol);
  const n = Math.min(a.length, b.length, val.length);
  const out: IndexedGroupSpec[] = [];
  for (const lvl of nestedLevels(data, factorACol, factorBCol)) {
    for (let bi = 0; bi < lvl.bCodes.length; bi++) {
      const points: IndexedPoint[] = [];
      for (let r = 0; r < n; r++) {
        if (a[r] === lvl.aCode && b[r] === lvl.bCodes[bi] && Number.isFinite(val[r])) {
          points.push({ value: val[r], rowIndex: r });
        }
      }
      if (points.length > 0) {
        out.push({ label: nestedLabel(data, factorACol, factorBCol, lvl.aLabel, lvl.bLabels[bi]), points });
      }
    }
  }
  return out;
}

/** Group-by mode, index-preserving counterpart to `groupsByCategory` — same
 *  display-order rule, and it MUST stay the same: this one feeds the raw-point
 *  overlay, so if the two ordered differently a box would sit over another
 *  category's jittered points. */
export function groupsByCategoryIndexed(
  data: DataStruct,
  valueCol: number,
  byCol: number,
): IndexedGroupSpec[] {
  const by = colValues(data, byCol);
  const val = colValues(data, valueCol);
  const parts = new Map<number, IndexedPoint[]>();
  const n = Math.min(by.length, val.length);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(by[i]) || !Number.isFinite(val[i])) continue;
    const point: IndexedPoint = { value: val[i], rowIndex: i };
    const bucket = parts.get(by[i]);
    if (bucket) bucket.push(point);
    else parts.set(by[i], [point]);
  }
  const levels = categoryLevels(data, byCol).filter((level) => parts.has(level));
  const labels = categoryGroupLabels(data, byCol, levels);
  return levels.map((level, i) => ({ label: labels[i], points: parts.get(level) ?? [] }));
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
