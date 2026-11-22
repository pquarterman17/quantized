// Statistical-tests workshop — the catalog of wired tests and the pure request
// builder behind components/workshops/statstests. Turns the user's column
// picks (on the ANALYSIS view, so exclusions and filters are honored) into a
// schema-typed request for one of the `/api/stats/*` routes that had no
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
  | "classifier" // a 0/1 outcome + a score, row-aligned
  | "counts" // observed counts, optionally + expected counts, row-aligned
  | "survival" // follow-up time + 0/1 event (+ a group column, or Cox predictors)
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
  { id: "roc", family: "Classification", label: "ROC / AUC / Youden cutoff", input: "classifier", blurb: "How well does a score separate a 0/1 outcome, and which cutoff is best?" },
  { id: "glm-logistic", family: "Regression", label: "Logistic regression", input: "regression", blurb: "How do predictors change the odds of a 0/1 outcome?" },
  { id: "glm-poisson", family: "Regression", label: "Poisson regression", input: "regression", blurb: "How do predictors change the rate of a count response?" },
  { id: "chi-square-gof", family: "Categorical", label: "Chi-square goodness of fit", input: "counts", blurb: "Do observed category counts match a uniform or given distribution?" },
  { id: "adjust-p", family: "Multiple comparisons", label: "P-value adjustment", input: "one", blurb: "Correct a column of p-values for testing many hypotheses at once." },
  { id: "kaplan-meier", family: "Survival", label: "Kaplan-Meier survival", input: "survival", blurb: "How does the chance of surviving (no event yet) fall over time, and what is the median survival?" },
  { id: "logrank", family: "Survival", label: "Log-rank test (groups)", input: "survival", blurb: "Do two or more groups have the same survival curve?" },
  { id: "cox-ph", family: "Survival", label: "Cox proportional hazards", input: "survival", blurb: "How do predictors change the hazard (instantaneous event rate)?" },
  { id: "power", family: "Planning", label: "t-test power / sample size", input: "none", blurb: "How many samples do I need, or how much power do I have?" },
];

/** Whether the workshop shows (and the test reads) an alpha field. Shared by
 *  the inputs panel and the result book so they cannot disagree. */
export function testUsesAlpha(id: StatsTestId): boolean {
  // Survival results use fixed 95% intervals and the 5% level; they read no alpha.
  return id !== "anderson" && id !== "partial-correlation" && id !== "stepwise" && id !== "roc" &&
    id !== "kaplan-meier" && id !== "logrank" && id !== "cox-ph";
}

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
  /** p-value adjustment method. */
  adjustMethod: "holm" | "bonferroni" | "bh";
  /** Chi-square GoF: expect equal counts, or read an expected-counts column. */
  gofExpected: "uniform" | "column";
  /** Kaplan-Meier: draw one curve per level of the group column. */
  survivalGroups: boolean;
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
  adjustMethod: "holm",
  gofExpected: "uniform",
  survivalGroups: false,
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

const binaryProblem = (y: number[], label: string): string | null =>
  y.some((v) => v !== 0 && v !== 1)
    ? `${label} must be coded 0/1 (it has other values).`
    : new Set(y).size < 2 ? `${label} needs both outcomes (0 and 1) among the usable rows.` : null;

const countProblem = (y: number[], label: string): string | null =>
  y.some((v) => v < 0 || !Number.isInteger(v)) ? `${label} must hold counts (whole numbers, 0 or more).` : null;

const MAX_SURVIVAL_GROUPS = 12;

/** Why (time, event) cannot be analysed, or null. Nothing is coerced. */
function survivalProblem(time: number[], event: number[], timeName: string, eventName: string): string | null {
  if (time.length === 0) return "No rows have a finite time, event and group/predictor values.";
  if (time.some((v) => v < 0)) return `${timeName} has negative times; follow-up time must be 0 or more.`;
  if (event.some((v) => v !== 0 && v !== 1)) return `${eventName} must be coded 0/1 (0 = censored, 1 = event); it has other values.`;
  if (!event.includes(1)) return `${eventName} has no events (every usable row is censored), so there is nothing to estimate.`;
  return null;
}

function buildSurvival(
  id: "kaplan-meier" | "logrank" | "cox-ph", data: DataStruct, sel: TestSelection, p: TestParams,
): BuildOutcome {
  const name = (c: number) => columnDisplayName(data, c);
  const grouped = id === "logrank" || (id === "kaplan-meier" && p.survivalGroups);
  const preds = id === "cox-ph" ? sel.cols.filter((c) => c !== sel.x && c !== sel.y) : [];
  if (sel.x === sel.y) return fail("Pick two different columns: the follow-up time and the 0/1 event.");
  if (grouped && (sel.byCol === sel.x || sel.byCol === sel.y)) return fail("The group column must differ from the time and event columns.");
  if (id === "cox-ph" && preds.length === 0) return fail("Pick at least one predictor other than the time and event columns.");
  const [time, event, ...rest] = completeRows(data, [sel.x, sel.y, ...(grouped ? [sel.byCol] : []), ...preds]);
  const bad = survivalProblem(time, event, name(sel.x), name(sel.y));
  if (bad) return fail(bad);
  const labels = [name(sel.x), name(sel.y)];
  if (id === "cox-ph") return { ok: true, request: { id, body: { time, event, predictors: rest } }, labels: [...labels, ...preds.map(name)] };
  if (!grouped) return { ok: true, request: { id: "kaplan-meier", body: { groups: [{ label: "", time, event }] } }, labels };
  const codes = rest[0];
  const levels = [...new Set(codes)].sort((a, b) => a - b);
  if (levels.length > MAX_SURVIVAL_GROUPS) {
    return fail(`${name(sel.byCol)} has ${levels.length} distinct values; pick a group column with at most ${MAX_SURVIVAL_GROUPS} categories.`);
  }
  if (levels.length < 2 && id === "logrank") return fail(`The log-rank test needs at least 2 groups; ${name(sel.byCol)} has only one value among the usable rows.`);
  const label = levelNamer(data, sel.byCol);
  const groups = levels.map((code) => {
    const idx = codes.flatMap((c, i) => (c === code ? [i] : []));
    return { label: label(code), time: idx.map((i) => time[i]), event: idx.map((i) => event[i]) };
  });
  const thin = groups.find((g) => g.time.length < 2);
  if (thin) return fail(`Group "${thin.label}" has only ${thin.time.length} usable row; every group needs at least 2.`);
  const noEvents = id === "kaplan-meier" ? groups.find((g) => !g.event.includes(1)) : undefined;
  if (noEvents) return fail(`Group "${noEvents.label}" has no events (all censored), so its curve cannot be estimated; drop the group or split by a different column.`);
  return { ok: true, request: { id, body: { groups } }, labels: [...labels, name(sel.byCol)] };
}

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

    case "roc": {
      if (sel.x === sel.y) return fail("Pick two different columns: the 0/1 outcome and the score.");
      const [truth, score] = completeRows(data, [sel.x, sel.y]);
      const bad = binaryProblem(truth, name(sel.x));
      if (bad) return fail(bad);
      return { ok: true, request: { id, body: { y_true: truth, y_score: score } }, labels: [name(sel.x), name(sel.y)] };
    }

    case "glm-logistic":
    case "glm-poisson": {
      const preds = sel.cols.filter((c) => c !== sel.x);
      if (preds.length === 0) return fail("Pick at least one predictor other than the response.");
      const [y, ...predictors] = completeRows(data, [sel.x, ...preds]);
      const bad = id === "glm-logistic" ? binaryProblem(y, name(sel.x)) : countProblem(y, name(sel.x));
      if (bad) return fail(bad);
      return { ok: true, request: { id, body: { y, predictors, alpha: p.alpha } }, labels: [name(sel.x), ...preds.map(name)] };
    }

    case "chi-square-gof": {
      const useExpected = p.gofExpected === "column";
      if (useExpected && sel.x === sel.y) return fail("Pick two different columns: observed and expected counts.");
      const [observed, expected] = completeRows(data, useExpected ? [sel.x, sel.y] : [sel.x]);
      if (observed.length < 2) return fail("Need at least 2 categories (rows) of counts.");
      if (observed.some((v) => v < 0)) return fail(`${name(sel.x)} has negative counts; observed counts must be 0 or more.`);
      if (!useExpected) return { ok: true, request: { id, body: { observed } }, labels: [name(sel.x)] };
      if (expected.some((v) => v <= 0)) return fail(`${name(sel.y)} has expected counts of 0 or less; they must be positive.`);
      const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
      const [so, se] = [sum(observed), sum(expected)];
      if (Math.abs(so - se) > 1e-8 * Math.max(so, se)) {
        return fail(`Expected counts total ${Number(se.toPrecision(6))} but observed total ${Number(so.toPrecision(6))}; scale the expected column to the observed total (nothing is rescaled for you).`);
      }
      return { ok: true, request: { id, body: { observed, expected } }, labels: [name(sel.x), name(sel.y)] };
    }

    case "adjust-p": {
      const pv = finite(colValues(data, sel.x));
      if (pv.length === 0) return fail("The p-value column has no numbers.");
      const out = pv.find((v) => v < 0 || v > 1);
      if (out !== undefined) return fail(`${name(sel.x)} must hold p-values between 0 and 1 (found ${Number(out.toPrecision(6))}).`);
      return { ok: true, request: { id, body: { p_values: pv, method: p.adjustMethod } }, labels: [name(sel.x)] };
    }

    case "kaplan-meier":
    case "logrank":
    case "cox-ph":
      return buildSurvival(id, data, sel, p);

    case "partial-correlation": {
      if (sel.cols.length < 3 || !distinct(sel.cols)) return fail("Pick at least 3 columns.");
      return { ok: true, request: { id, body: { columns: completeRows(data, sel.cols) } }, labels: sel.cols.map(name) };
    }
  }
}

/** The worksheet columns a test reads for `sel` (-1 = the X/time column), in
 *  the order its builder uses them. The shared input contract resolves these
 *  (lib/analysisInputs); a test that reads no data ("power") reads none. */
export function testColumns(id: StatsTestId, sel: TestSelection, p: Pick<TestParams, "gofExpected"> & Partial<Pick<TestParams, "survivalGroups">> = DEFAULT_PARAMS): number[] {
  switch (testDef(id).input) {
    case "one": return [sel.x];
    case "two":
    case "paired":
    case "classifier": return [sel.x, sel.y];
    case "counts": return p.gofExpected === "column" ? [sel.x, sel.y] : [sel.x];
    case "groups": return sel.groupMode === "category" ? [sel.x, sel.byCol] : [...sel.cols];
    case "blocks":
    case "columns": return [...sel.cols];
    case "factorial": return [sel.x, sel.byCol, sel.byCol2];
    case "regression": return [sel.x, ...sel.cols.filter((c) => c !== sel.x)];
    case "survival": {
      const grouped = id === "logrank" || (id === "kaplan-meier" && p.survivalGroups);
      const preds = id === "cox-ph" ? sel.cols.filter((c) => c !== sel.x && c !== sel.y) : [];
      return [sel.x, sel.y, ...(grouped ? [sel.byCol] : []), ...preds];
    }
    case "none": return [];
  }
}
