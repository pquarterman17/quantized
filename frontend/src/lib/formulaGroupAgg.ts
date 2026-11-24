// Grouped column aggregates for the worksheet formula language (gap audit 9,
// G4, lane FXBY): the JMP `Col Mean(x, <By var, ...>)` family, written
// `col_mean(A, B, C)` = the mean of column A within each group of rows that
// share the same values in the by-columns B and C. Part of the LAZY formula
// chunk (lib/formulaRefs.ts calls `tryParseGroupAggCall` from its
// `tryParseCall`); the names are in lib/formulaMath.ts SPECIAL_NAMES so the
// derived-unit parser knows them.
//
// Functions (JMP name in brackets). JMP docs, "Statistical Functions" chapter
// of the Scripting Guide, https://www.jmp.com/support/help/en/18.2/jmp/statistical-functions-2.shtml :
//   col_mean   [Col Mean]      col_sd      [Col Std Dev]   (sample, N-1)
//   col_min    [Col Minimum]   col_max     [Col Maximum]
//   col_median [Col Quantile(x, 0.5)]      col_sum     [Col Sum]
//   col_count  [Col Number]    "number of nonmissing values"
//   col_rank   [Col Rank]      lowest value = rank 1; ties in ROW ORDER
//   col_rank_avg / col_rank_min / col_rank_dense   [Col Rank << tie(...)]
//   col_score  [Col Standardize / JMP 19 "Col Score"]  z = (x - mean) / sd
// `by` is optional: `col_mean(A)` is the whole-column mean (JMP: no By).
//
// SEMANTICS
// - Missing values (NaN / non-finite) are excluded from the statistic, like
//   lib/formulaAggregates.ts ("omitnan"). Every row of a group — including a
//   row whose own x is missing — receives the group's value, as JMP's
//   pre-evaluated Col functions do; only col_rank/col_rank_*/col_score of a
//   missing x are missing (there is nothing to rank or standardise).
// - A group with no finite x: NaN, except col_count (0). col_sd needs >= 2
//   values; col_score needs a group sd that is > 0 (else NaN, never inf).
// - MISSING BY-KEY (provisional, owner to confirm): a row whose by-column
//   value is missing (NaN) gets NaN from every function here (fail closed:
//   no silent "missing" group). The JMP docs do not say how a missing By
//   value is treated; JMP's By-group dialogs list missing as a group, so this
//   may change to "its own group" on the owner's word.
// - TIES (provisional, owner to confirm the default): JMP's `Col Rank` ties
//   are "broken arbitrarily by default" with options average / arbitrary /
//   row / minimum (JMP 17-18 docs, ibid.). `col_rank` uses the deterministic
//   "row" mode (the earlier row gets the lower rank); `col_rank_avg`,
//   `col_rank_min` and `col_rank_dense` (1,2,2,3; dense is a JMP 19 wish-list
//   / newer addition, unverified here) are the explicit modes.
// - col_score is the Z-SCORE with the sample sd. JMP 19's "Col Score" is
//   listed in "New in JMP 19" without a definition we could read:
//   provisional, owner to confirm (unverified).
// - ROW SCOPE: like mean(A) and the other aggregates (lib/formula.ts header),
//   groups are formed over the SAME rows the plain per-row context sees: the
//   dataset's full row set, including excluded and filter-hidden rows.
// - Non-local: reads the whole column, so it is reported as an "aggregate"
//   (a one-cell edit does a full recompute).

import { computeAggregate, type AggregateName } from "./formulaAggregates";
import type { FormulaFn, Tok } from "./formulaTypes";
import type { ParserOps } from "./formulaRowFns";

type TieMode = "row" | "average" | "min" | "dense";
type GroupFn = AggregateName | "rank" | "score";
interface Spec {
  kind: GroupFn;
  tie?: TieMode;
}

export const GROUP_AGG_SPECS: Readonly<Record<string, Spec>> = {
  col_mean: { kind: "mean" },
  col_sd: { kind: "sd" },
  col_min: { kind: "min" },
  col_max: { kind: "max" },
  col_median: { kind: "median" },
  col_sum: { kind: "sum" },
  col_count: { kind: "count" },
  col_rank: { kind: "rank", tie: "row" },
  col_rank_avg: { kind: "rank", tie: "average" },
  col_rank_min: { kind: "rank", tie: "min" },
  col_rank_dense: { kind: "rank", tie: "dense" },
  col_score: { kind: "score" },
};

const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.t === "op" && t.v === v;

/** Group id per row (`-1` = missing by-key). No by-columns: one group. */
function groupIds(by: readonly (readonly number[])[], n: number): { ids: Int32Array; count: number } {
  const ids = new Int32Array(n);
  if (by.length === 0) return { ids, count: 1 };
  // levels-allowlist: groups rows by the by-columns' raw values (first-seen order); it never orders or labels levels
  const seen = new Map<string, number>();
  for (let r = 0; r < n; r++) {
    let key = "";
    let missing = false;
    for (const col of by) {
      const v = col[r];
      if (!Number.isFinite(v)) {
        missing = true;
        break;
      }
      key += `${v}\u0001`; // String(-0) is "0": -0 and 0 are one level
    }
    if (missing) ids[r] = -1;
    else {
      let g = seen.get(key);
      if (g === undefined) seen.set(key, (g = seen.size));
      ids[r] = g;
    }
  }
  return { ids, count: seen.size };
}

/** 1-based ranks of `idx` (row indices of one group's finite x) by `x`. */
function rankGroup(x: readonly number[], idx: number[], tie: TieMode, out: Float64Array): void {
  const order = [...idx].sort((a, b) => x[a] - x[b] || a - b); // ties: row order
  let dense = 0;
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && x[order[j + 1]] === x[order[i]]) j++;
    dense++;
    for (let k = i; k <= j; k++) {
      out[order[k]] = tie === "row" ? k + 1 : tie === "min" ? i + 1 : tie === "average" ? (i + j) / 2 + 1 : dense;
    }
    i = j + 1;
  }
}

/** The whole result column for one spec over `x` grouped by `by`. */
export function groupAggregate(spec: Spec, x: readonly number[], by: readonly (readonly number[])[]): number[] {
  const n = x.length;
  const { ids, count } = groupIds(by, n);
  const members: number[][] = Array.from({ length: count }, () => []);
  for (let r = 0; r < n; r++) if (ids[r] >= 0) members[ids[r]].push(r);
  const out = new Float64Array(n).fill(NaN);
  if (spec.kind === "rank") {
    for (const m of members) rankGroup(x, m.filter((r) => Number.isFinite(x[r])), spec.tie ?? "row", out);
    return Array.from(out);
  }
  const stat = (name: AggregateName, m: number[]) =>
    computeAggregate(
      name,
      m.map((r) => x[r]),
    );
  for (const m of members) {
    if (spec.kind === "score") {
      const mean = stat("mean", m);
      const sd = stat("sd", m);
      for (const r of m) if (Number.isFinite(x[r]) && sd > 0) out[r] = (x[r] - mean) / sd;
    } else {
      const v = stat(spec.kind, m);
      for (const r of m) out[r] = v;
    }
  }
  return Array.from(out);
}

function bareName(fname: string, ops: ParserOps, consts: Record<string, number>, what: string): string {
  const t = ops.peek();
  const next = ops.peekAt(1);
  if (t?.t !== "name" || t.v in consts || !(isOp(next, ",") || isOp(next, ")")))
    throw new Error(`${fname}() expects ${what} as a bare column name, e.g. ${fname}(A, B)`);
  ops.eat();
  ops.ref(t.v);
  return t.v;
}

/** `fname(` (name and paren eaten) as one of the grouped aggregates, or undefined. */
export function tryParseGroupAggCall(fname: string, ops: ParserOps, consts: Record<string, number>): FormulaFn | undefined {
  if (!Object.hasOwn(GROUP_AGG_SPECS, fname)) return undefined;
  const spec = GROUP_AGG_SPECS[fname];
  ops.nonLocal("aggregate");
  const xName = bareName(fname, ops, consts, "the column");
  const byNames: string[] = [];
  while (isOp(ops.peek(), ",")) {
    ops.eat();
    byNames.push(bareName(fname, ops, consts, "a by-column"));
  }
  ops.expectOp(")");
  // One pass per (x array, by arrays): every row of a recompute passes the same arrays.
  const memo = new WeakMap<readonly number[], { by: readonly (readonly number[])[]; out: number[] }>();
  return (_c, ex) => {
    if (!ex) throw new Error(`${fname}() has no row context to evaluate against`);
    const x = ex.columns[xName];
    if (!x) throw new Error(`unknown variable "${xName}"`);
    const by = byNames.map((b) => {
      const col = ex.columns[b];
      if (!col) throw new Error(`unknown variable "${b}"`);
      return col;
    });
    let hit = memo.get(x);
    if (!hit || hit.by.length !== by.length || hit.by.some((b, i) => b !== by[i])) {
      hit = { by, out: groupAggregate(spec, x, by) };
      memo.set(x, hit);
    }
    return hit.out[ex.row];
  };
}
