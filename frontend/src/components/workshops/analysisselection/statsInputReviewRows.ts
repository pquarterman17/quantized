// The "Review inputs" rows of the own-pick statistics tools: the tool's column
// picks (by role) and the settings its run reads, built from the SAME state the
// tool runs on (each panel passes its live picks), so the card cannot say
// something the run does not do. Pure: no store, no React. A pick that is not
// made reads "not picked"; a column that no longer exists reads "missing".

import { analysisColumnName, type AnalysisInputs } from "../../../lib/analysisInputs";
import type { StatsTestId } from "../../../lib/api/statsTests";
import { testDef, type TestParams, type TestSelection } from "../../../lib/statsTests";
import { moreSettings } from "../../../lib/statsTestsMore";
import { lifeSettings } from "../../../lib/statsTestsLife";
import { rowTGroups, rowTSettings } from "../../../lib/statsTestsRows";
import { screenSettings } from "../../../lib/statsTestsScreen";
import { spcColumns, spcSettings } from "../../../lib/statsTestsSpc";
import type { Dataset } from "../../../lib/types";

export interface ReviewRow {
  label: string;
  value: string;
}

const datasetOf = (inputs: AnalysisInputs | null): Dataset | null => inputs?.dataset ?? null;

function name(dataset: Dataset | null, key: number | null | undefined): string {
  if (key === null || key === undefined) return "not picked";
  // No resolved worksheet (loading / failed): the pick exists but cannot be named.
  if (!dataset) return key < 0 ? "X column" : `column ${key + 1}`;
  if (key < -1 || key >= dataset.data.labels.length) return "missing";
  return analysisColumnName(dataset, key);
}

function names(dataset: Dataset | null, keys: readonly number[]): string {
  return keys.length === 0 ? "not picked" : keys.map((key) => name(dataset, key)).join(", ");
}

const ALPHA_TESTS: ReadonlySet<StatsTestId> = new Set<StatsTestId>(["welch-anova", "posthoc", "variance-test", "tost-one", "tost-two", "dunnett", "anova-rm", "anova2-unbalanced", "regression-multi", "glm-logistic", "glm-poisson", "chi-square-gof", "adjust-p"]);
const on = (value: boolean): string => (value ? "on" : "off");
const optional = (dataset: Dataset | null, key: number | null): string => (key === null ? "none" : name(dataset, key));

export function distributionRows(inputs: AnalysisInputs, s: { col: number; byCol: number | null; fit: string }): ReviewRow[] {
  const ds = datasetOf(inputs);
  return [
    { label: "Column", value: name(ds, s.col) },
    { label: "By", value: optional(ds, s.byCol) },
    { label: "Fitted distribution", value: s.fit },
  ];
}

export function outlierRows(
  inputs: AnalysisInputs,
  s: { col: number; method: string; alpha: number; k: number; threshold: number },
): ReviewRow[] {
  const ds = datasetOf(inputs);
  const rows: ReviewRow[] = [{ label: "Column", value: name(ds, s.col) }, { label: "Method", value: s.method }];
  if (s.method === "mad") rows.push({ label: "Threshold", value: String(s.threshold) });
  else rows.push({ label: "Alpha", value: String(s.alpha) });
  if (s.method === "rosner") rows.push({ label: "Max outliers (k)", value: String(s.k) });
  return rows;
}

export function fitYByXRows(
  inputs: AnalysisInputs,
  s: { xCol: number; yCol: number; kind: string; order: number; band: string; byCol: number | null },
): ReviewRow[] {
  const ds = datasetOf(inputs);
  return [
    { label: "X (factor)", value: name(ds, s.xCol) },
    { label: "Y (response)", value: name(ds, s.yCol) },
    // Order and band are read by the bivariate leg only.
    ...(s.kind === "bivariate" ? [{ label: "Polynomial order", value: String(s.order) }, { label: "Band", value: s.band }] : []),
    { label: "By", value: optional(ds, s.byCol) },
  ];
}

export function variabilityRows(inputs: AnalysisInputs, s: { response: number; a: number; b: number }): ReviewRow[] {
  const ds = datasetOf(inputs);
  return [
    { label: "Response (Y)", value: name(ds, s.response) },
    { label: "Factor A (outer)", value: name(ds, s.a) },
    { label: "Factor B (nested in A)", value: name(ds, s.b) },
  ];
}

export function statsTestsRows(inputs: AnalysisInputs | null, s: { testId: StatsTestId; sel: TestSelection; params: TestParams }): ReviewRow[] {
  const ds = datasetOf(inputs);
  const { sel, params } = s;
  const rows: ReviewRow[] = [{ label: "Test", value: testDef(s.testId).label }];
  switch (testDef(s.testId).input) {
    case "one": rows.push({ label: s.testId === "adjust-p" ? "P-values" : "Column", value: name(ds, sel.x) }); break;
    case "classifier": rows.push({ label: "Outcome (0/1)", value: name(ds, sel.x) }, { label: "Score", value: name(ds, sel.y) }); break;
    case "survival": {
      rows.push({ label: "Time", value: name(ds, sel.x) }, { label: "Event (0/1)", value: name(ds, sel.y) });
      if (s.testId === "logrank" || (s.testId === "kaplan-meier" && params.survivalGroups)) rows.push({ label: "Groups by", value: name(ds, sel.byCol) });
      if (s.testId === "cox-ph") rows.push({ label: "Predictors", value: names(ds, sel.cols.filter((c) => c !== sel.x && c !== sel.y)) });
      break;
    }
    case "counts":
      rows.push({ label: "Observed counts", value: name(ds, sel.x) });
      rows.push(params.gofExpected === "column" ? { label: "Expected counts", value: name(ds, sel.y) } : { label: "Expected", value: "uniform" });
      break;
    case "two":
    case "paired":
      rows.push({ label: "First column", value: name(ds, sel.x) }, { label: "Second column", value: name(ds, sel.y) });
      break;
    case "groups":
      if (sel.groupMode === "category") rows.push({ label: "Value", value: name(ds, sel.x) }, { label: "Groups by", value: name(ds, sel.byCol) });
      else rows.push({ label: "Group columns (first is control)", value: names(ds, sel.cols) });
      break;
    case "blocks":
    case "columns": rows.push({ label: "Columns", value: names(ds, sel.cols) }); break;
    case "factorial":
      rows.push({ label: "Response", value: name(ds, sel.x) }, { label: "Factor A", value: name(ds, sel.byCol) }, { label: "Factor B", value: name(ds, sel.byCol2) });
      break;
    case "regression":
      rows.push({ label: "Response", value: name(ds, sel.x) }, { label: "Predictors", value: names(ds, sel.cols.filter((c) => c !== sel.x)) });
      break;
    case "spc": {
      const cols = spcColumns(s.testId, sel, params.spc);
      rows.push({ label: "Data / counts", value: name(ds, cols[0]) });
      if (cols.length > 1) rows.push({ label: "Subgroup / sample size", value: cols.slice(1).map((c) => name(ds, c)).join(", ") });
      rows.push(...spcSettings(s.testId, params).map(([label, value]) => ({ label, value })));
      if (s.testId === "capability") rows.push({ label: "Alpha", value: String(params.alpha) });
      return rows;
    }
    case "life": {
      const iv = s.testId === "life-interval";
      rows.push({ label: iv ? "Lower bound" : "Time", value: name(ds, sel.x) }, { label: iv ? "Upper bound" : "Censor (1 = censored)", value: name(ds, sel.y) });
      if (s.testId === "life-by-x") rows.push({ label: "Stress variable", value: name(ds, sel.byCol) });
      rows.push(...lifeSettings(s.testId, params).filter(([l]) => l !== "Censor column").map(([label, value]) => ({ label, value })));
      rows.push({ label: "Alpha", value: String(params.alpha) });
      return rows;
    }
    case "screen":
      rows.push({ label: "Responses (Y)", value: names(ds, sel.cols) }, { label: "Factors (X)", value: names(ds, params.screen.xCols) });
      rows.push(...screenSettings(params).map(([label, value]) => ({ label, value })), { label: "Alpha", value: String(params.alpha) });
      return rows;
    case "rowwise": {
      const { a, b } = rowTGroups(sel, params.rowt);
      rows.push({ label: "Group A columns", value: names(ds, a) });
      if (b.length) rows.push({ label: "Group B columns", value: names(ds, b) });
      rows.push(...rowTSettings(params).map(([label, value]) => ({ label, value })), { label: "Alpha", value: String(params.alpha) });
      return rows;
    }
    case "none":
      if (s.testId !== "power") { rows.push(...moreSettings(s.testId, params).map(([label, value]) => ({ label, value }))); return rows; }
      rows.push(
        { label: "Mode", value: params.kind }, { label: "Effect size d", value: String(params.effectSize) },
        { label: "n", value: params.n === null ? "solve" : String(params.n) }, { label: "Target power", value: String(params.power) },
        { label: "Alpha", value: String(params.alpha) }, { label: "Tails", value: String(params.tails) },
      );
      return rows;
  }
  // Only what buildTestRequest sends: the panel also shows alpha for tests that ignore it.
  if (ALPHA_TESTS.has(s.testId)) rows.push({ label: "Alpha", value: String(params.alpha) });
  rows.push(...moreSettings(s.testId, params).map(([label, value]) => ({ label, value })));
  if (s.testId === "sign-test" || s.testId === "dunnett") rows.push({ label: "Alternative", value: params.alternative });
  if (s.testId === "anova2-unbalanced") rows.push({ label: "Sum of squares type", value: String(params.ssType) });
  if (s.testId === "adjust-p") rows.push({ label: "Method", value: params.adjustMethod });
  if (s.testId === "stepwise") rows.push({ label: "Criterion", value: params.criterion.toUpperCase() }, { label: "Direction", value: params.direction });
  return rows;
}

/** `paired` must already be the effective flag (`paired && pairable`). */
export function chooserRows(
  inputs: AnalysisInputs,
  s: { mode: "columns" | "groupby"; cols: readonly number[]; valueCol: number; byCol: number; paired: boolean },
): ReviewRow[] {
  const ds = datasetOf(inputs);
  return [
    ...(s.mode === "columns"
      ? [{ label: "Group columns", value: names(ds, s.cols) }]
      : [{ label: "Value", value: name(ds, s.valueCol) }, { label: "Groups by", value: name(ds, s.byCol) }]),
    { label: "Paired", value: on(s.paired) },
  ];
}
