// Statistical-tests workshop — the catalog of wired tests and the pure request
// builder behind components/workshops/statstests. Turns the user's column
// picks (on the ANALYSIS view, so exclusions and filters are honored) into a
// schema-typed request for one of the twelve `/api/stats/*` routes that had no
// frontend caller. Pure (no React / store / fetch) so every branch unit-tests
// standalone; result tables and interpretation live in statsTestsResults.ts.
//
// Row alignment is per test, because it is part of the statistics: paired and
// blocked designs (sign test, Friedman, repeated measures, regression, partial
// correlation, two-way ANOVA) keep only rows where EVERY picked column is
// finite, so each surviving row is still one subject/block/observation.
// Independent samples (two-sample KS, Dunnett) keep each column's own finite
// values, so a gap in one column never discards data from another.

import { resolveCategoryLabels } from "./barlayout";
import { categoryLevels } from "./categorical";
import type { StatsTestId, StatsTestRequest } from "./api/statsTests";
import { columnDisplayName, groupsByCategory, groupsFromColumns } from "./statschooser";
import type { DataStruct } from "./types";

/** Which column roles a test needs (drives both the builder and the pickers). */
export type InputKind =
  | "one" // one column
  | "two" // two independent columns
  | "paired" // two row-aligned columns
  | "groups" // >= 2 independent groups (columns, or value by category)
  | "blocks" // >= 2 row-aligned columns (treatments x blocks)
  | "factorial" // a response + two factor columns
  | "regression" // a response + >= 1 predictor columns
  | "columns" // >= 3 row-aligned columns
  | "none"; // no data (planning)

export interface TestDef {
  id: StatsTestId;
  label: string;
  family: string;
  /** One short sentence: what question the test answers. */
  blurb: string;
  input: InputKind;
}

export const STATS_TESTS: readonly TestDef[] = [
  { id: "anderson", family: "Normality", label: "Anderson-Darling", input: "one", blurb: "Is this column normally distributed, weighting the tails?" },
  { id: "ks-normal", family: "Normality", label: "Kolmogorov-Smirnov vs normal", input: "one", blurb: "Does this column follow a normal distribution?" },
  { id: "ks-two-sample", family: "Compare two", label: "Two-sample Kolmogorov-Smirnov", input: "two", blurb: "Do two independent samples come from the same distribution?" },
  { id: "sign-test", family: "Compare two", label: "Sign test (paired)", input: "paired", blurb: "Does one paired measurement tend to exceed the other, with no normality assumption?" },
  { id: "dunnett", family: "Compare groups", label: "Dunnett vs control", input: "groups", blurb: "Which groups differ from the first (control) group?" },
  { id: "friedman", family: "Compare groups", label: "Friedman (blocked)", input: "blocks", blurb: "Do conditions measured on the same samples differ, rank-based?" },
  { id: "anova-rm", family: "Compare groups", label: "Repeated-measures ANOVA", input: "blocks", blurb: "Do condition means differ when every sample is measured under each condition?" },
  { id: "anova2-unbalanced", family: "Compare groups", label: "Two-way ANOVA", input: "factorial", blurb: "Do two factors and their interaction affect the response?" },
  { id: "regression-multi", family: "Regression", label: "Multiple regression", input: "regression", blurb: "How does the response depend on several predictors at once?" },
  { id: "stepwise", family: "Regression", label: "Stepwise regression", input: "regression", blurb: "Which predictors are worth keeping by AIC or BIC?" },
  { id: "partial-correlation", family: "Correlation", label: "Partial correlation", input: "columns", blurb: "How strongly are two columns related once the others are held fixed?" },
  { id: "power", family: "Planning", label: "t-test power / sample size", input: "none", blurb: "How many samples do I need, or how much power do I have?" },
];

export function testDef(id: StatsTestId): TestDef {
  return STATS_TESTS.find((t) => t.id === id) ?? STATS_TESTS[0];
}

/** Column picks; -1 = the x column, 0.. = channels. Which fields a test reads
 *  depends on its `input` kind. */
export interface TestSelection {
  /** one / two / paired: the first column; groups (category) / factorial /
   *  regression: the value or response column. */
  x: number;
  /** two / paired: the second column. */
  y: number;
  /** groups (columns) / blocks / columns: the picked columns; regression: the
   *  predictors. */
  cols: number[];
  /** groups (category): the grouping column; factorial: factor A. */
  byCol: number;
  /** factorial: factor B. */
  byCol2: number;
  groupMode: "columns" | "category";
}

export type Alternative = "two-sided" | "less" | "greater";

export interface TestParams {
  alpha: number;
  alternative: Alternative;
  ssType: 2 | 3;
  criterion: "aic" | "bic";
  direction: "forward" | "backward" | "both";
  effectSize: number;
  /** Power at this n; null = solve for the n that reaches `power`. */
  n: number | null;
  power: number;
  kind: "two-sample" | "paired" | "one-sample";
  tails: 1 | 2;
}

export const DEFAULT_SELECTION: TestSelection = { x: 0, y: 1, cols: [], byCol: 0, byCol2: 1, groupMode: "columns" };

export const DEFAULT_PARAMS: TestParams = {
  alpha: 0.05,
  alternative: "two-sided",
  ssType: 3,
  criterion: "aic",
  direction: "forward",
  effectSize: 0.5,
  n: null,
  power: 0.8,
  kind: "two-sample",
  tails: 2,
};

export type BuildOutcome =
  | { ok: true; request: StatsTestRequest; labels: string[] }
  | { ok: false; error: string };

const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

const finite = (xs: number[]): number[] => xs.filter((v) => Number.isFinite(v));

const fail = (error: string): BuildOutcome => ({ ok: false, error });

/** Column-major values of `cols`, keeping only rows where every one is finite. */
export function completeRows(data: DataStruct, cols: readonly number[]): number[][] {
  const src = cols.map((c) => colValues(data, c));
  const n = Math.min(...src.map((s) => s.length));
  const out: number[][] = cols.map(() => []);
  for (let i = 0; i < n; i++) {
    if (!src.every((s) => Number.isFinite(s[i]))) continue;
    src.forEach((s, k) => out[k].push(s[i]));
  }
  return out;
}

/** Each code of `col`'s rows mapped to its display level name. */
function levelNamer(data: DataStruct, col: number): (code: number) => string {
  const levels = categoryLevels(data, col);
  const names = resolveCategoryLabels(data, col, levels);
  const byCode = new Map(levels.map((lv, i) => [lv, names[i]]));
  return (code) => byCode.get(code) ?? String(code);
}

const distinct = (cols: readonly number[]): boolean => new Set(cols).size === cols.length;

/** Build the request for `id` from the picks, or say plainly what is missing. */
export function buildTestRequest(
  id: StatsTestId,
  data: DataStruct | null,
  sel: TestSelection,
  p: TestParams,
): BuildOutcome {
  if (id === "power") {
    const body = { effect_size: p.effectSize, power: p.power, kind: p.kind, alpha: p.alpha, tails: p.tails };
    return { ok: true, request: { id, body: p.n == null ? body : { ...body, n: p.n } }, labels: [] };
  }
  if (!data) return fail("Select a dataset to analyze.");
  const name = (c: number) => columnDisplayName(data, c);

  switch (id) {
    case "anderson":
    case "ks-normal":
      return { ok: true, request: { id, body: { x: finite(colValues(data, sel.x)) } }, labels: [name(sel.x)] };

    case "ks-two-sample": {
      if (sel.x === sel.y) return fail("Pick two different columns.");
      // Always two-sided: KS's one-sided forms compare CDFs, which reads backwards.
      const body = { x: finite(colValues(data, sel.x)), y: finite(colValues(data, sel.y)), alternative: "two-sided" };
      return { ok: true, request: { id, body }, labels: [name(sel.x), name(sel.y)] };
    }

    case "sign-test": {
      if (sel.x === sel.y) return fail("Pick two different columns.");
      const [x, y] = completeRows(data, [sel.x, sel.y]);
      return { ok: true, request: { id, body: { x, y, alternative: p.alternative } }, labels: [name(sel.x), name(sel.y)] };
    }

    case "dunnett": {
      const groups =
        sel.groupMode === "category"
          ? sel.x === sel.byCol
            ? []
            : groupsByCategory(data, sel.x, sel.byCol)
          : groupsFromColumns(data, sel.cols);
      if (groups.length < 2) return fail("Pick at least 2 groups; the first is the control.");
      const body = { groups: groups.map((g) => g.values), control: 0, alpha: p.alpha, alternative: p.alternative };
      return { ok: true, request: { id, body }, labels: groups.map((g) => g.label) };
    }

    case "friedman":
    case "anova-rm": {
      if (sel.cols.length < 2 || !distinct(sel.cols)) return fail("Pick at least 2 condition columns.");
      const cols = completeRows(data, sel.cols);
      const labels = sel.cols.map(name);
      if (id === "friedman") return { ok: true, request: { id, body: { groups: cols } }, labels };
      const rows = cols[0].map((_, i) => cols.map((c) => c[i]));
      return { ok: true, request: { id, body: { data: rows, alpha: p.alpha } }, labels };
    }

    case "anova2-unbalanced": {
      if (!distinct([sel.x, sel.byCol, sel.byCol2])) return fail("Pick a response and two different factor columns.");
      const [values, a, b] = completeRows(data, [sel.x, sel.byCol, sel.byCol2]);
      const nameA = levelNamer(data, sel.byCol);
      const nameB = levelNamer(data, sel.byCol2);
      const body = { values, factor_a: a.map(nameA), factor_b: b.map(nameB), ss_type: p.ssType, alpha: p.alpha };
      return { ok: true, request: { id, body }, labels: [name(sel.x), name(sel.byCol), name(sel.byCol2)] };
    }

    case "regression-multi":
    case "stepwise": {
      const preds = sel.cols.filter((c) => c !== sel.x);
      if (preds.length === 0) return fail("Pick at least one predictor other than the response.");
      const [y, ...predictors] = completeRows(data, [sel.x, ...preds]);
      const labels = [name(sel.x), ...preds.map(name)];
      if (id === "regression-multi") return { ok: true, request: { id, body: { y, predictors, alpha: p.alpha } }, labels };
      const body = { y, predictors, criterion: p.criterion, direction: p.direction };
      return { ok: true, request: { id, body }, labels };
    }

    case "partial-correlation": {
      if (sel.cols.length < 3 || !distinct(sel.cols)) return fail("Pick at least 3 columns.");
      return { ok: true, request: { id, body: { columns: completeRows(data, sel.cols) } }, labels: sel.cols.map(name) };
    }
  }
}
