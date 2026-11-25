// Statistical-tests workshop — response screening (GAP_AUDIT_9 G26, after JMP 19
// Response Screening): catalog entry, settings and the pure request builder.
// Delegated to by statsTests.ts. The Y columns are `sel.cols`; the factors are
// `screen.xCols`. A factor is nominal when its worksheet column is categorical
// or the user marks it nominal (`nominalCols`, e.g. a numeric lot number);
// otherwise continuous. Missing values are dropped pairwise by the backend and
// a pair that cannot be tested is reported with a reason, never dropped.
//
// Provisional, owner to confirm: Benjamini-Hochberg default, alpha 0.05, one
// adjustment family across all pairs, pooled-variance t for two levels.

import type { StatsTestRequest } from "./api/statsTests";
import { resolveCategoryLabels } from "./barlayout";
import { categoryLevels, isCategoricalChannel } from "./categorical";
import { columnDisplayName } from "./statschooser";
import type { BuildOutcome, TestDef, TestParams, TestSelection } from "./statsTests";
import type { DataStruct } from "./types";

export type ScreenMethod = "bh" | "by" | "holm" | "bonferroni";

export type ScreenParams = {
  /** Factor columns (-1 = the x column). */
  xCols: number[];
  /** Numeric factor columns to treat as nominal. */
  nominalCols: number[];
  method: ScreenMethod;
};

export const DEFAULT_SCREEN: ScreenParams = { xCols: [], nominalCols: [], method: "bh" };

export const SCREEN_METHODS: readonly { id: ScreenMethod; label: string }[] = [
  { id: "bh", label: "Benjamini-Hochberg (FDR)" },
  { id: "by", label: "Benjamini-Yekutieli (FDR, any dependence)" },
  { id: "holm", label: "Holm (family-wise)" },
  { id: "bonferroni", label: "Bonferroni (family-wise)" },
];

export const SCREEN_TESTS: readonly TestDef[] = [
  { id: "response-screening", family: "Screening", label: "Response screening (many Y × X with FDR)", input: "screen", blurb: "Which of many responses depend on which factors, with false-discovery-rate control?" },
];

export const SCREEN_IDS: ReadonlySet<string> = new Set(SCREEN_TESTS.map((t) => t.id));

const col = (data: DataStruct, i: number): number[] => (i < 0 ? data.time : data.values.map((r) => r[i]));

/** Worksheet columns the screen reads: the responses, then the factors. */
export function screenColumns(sel: TestSelection, sc: ScreenParams): number[] {
  return [...sel.cols, ...sc.xCols.filter((c) => !sel.cols.includes(c))];
}

export function isNominalFactor(data: DataStruct, c: number, sc: ScreenParams): boolean {
  return (c >= 0 && isCategoricalChannel(data, c)) || sc.nominalCols.includes(c);
}

const fail = (error: string): BuildOutcome => ({ ok: false, error });

export function buildScreenRequest(data: DataStruct | null, sel: TestSelection, tp: TestParams): BuildOutcome {
  if (!data) return fail("Select a dataset to analyze.");
  const sc = tp.screen;
  const ys = sel.cols;
  const xs = sc.xCols;
  if (ys.length === 0) return fail("Pick at least one response (Y) column.");
  if (xs.length === 0) return fail("Pick at least one factor (X) column.");
  const overlap = ys.find((c) => xs.includes(c));
  if (overlap !== undefined) return fail(`${columnDisplayName(data, overlap)} is picked as both a response and a factor.`);
  const catY = ys.find((c) => c >= 0 && isCategoricalChannel(data, c));
  if (catY !== undefined) return fail(`${columnDisplayName(data, catY)} is categorical; responses must be numeric.`);
  const name = (c: number) => columnDisplayName(data, c);
  const y = ys.map((c) => ({ name: name(c), values: col(data, c).map((v) => (Number.isFinite(v) ? v : null)) }));
  const x = xs.map((c) => {
    const raw = col(data, c);
    if (!isNominalFactor(data, c, sc)) {
      return { name: name(c), kind: "continuous" as const, values: raw.map((v) => (Number.isFinite(v) ? v : null)) };
    }
    const levels = categoryLevels(data, c);
    const names = new Map(levels.map((lv, i) => [lv, resolveCategoryLabels(data, c, levels)[i]]));
    return { name: name(c), kind: "nominal" as const, values: raw.map((v) => (Number.isFinite(v) ? (names.get(v) ?? String(v)) : null)) };
  });
  const body = { y, x, method: sc.method, alpha: tp.alpha };
  return { ok: true, request: { id: "response-screening", body } as StatsTestRequest, labels: [...ys.map(name), ...xs.map(name)] };
}

/** The settings a result / input review shows (label, value). */
export function screenSettings(tp: TestParams): [string, string][] {
  const sc = tp.screen;
  return [
    ["Adjustment", SCREEN_METHODS.find((m) => m.id === sc.method)?.label ?? sc.method],
    ["Factors marked nominal", sc.nominalCols.length ? String(sc.nominalCols.length) : "none"],
  ];
}

/** Restore `screen` from a saved record: absent -> defaults; present but invalid -> null. */
export function restoreScreen(raw: unknown): ScreenParams | null {
  if (raw === undefined) return DEFAULT_SCREEN;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const ints = (v: unknown): boolean => Array.isArray(v) && v.every((n) => Number.isInteger(n));
  return ints(r.xCols) && ints(r.nominalCols) && SCREEN_METHODS.some((m) => m.id === r.method) ? (r as unknown as ScreenParams) : null;
}
