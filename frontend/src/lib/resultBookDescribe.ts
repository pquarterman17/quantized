// Result book descriptions (lane RB2) for the saved results that are not one
// of the five statistics analyses: statistical tests, Williamson–Hall (single
// and comparison) and analysis-batch summaries. Each describer returns null
// when its saved recipe or settings cannot be read, so the result has NO book
// (fail closed; the other tabs still show it). Parsed without the live source.
//
// Shared shapes and helpers live here (not in lib/resultBook) so that module
// stays a small model and the per-producer data sits in one place. Pure.

import type { AnalysisResult } from "./analysisResult";
import { ANALYSIS_SELECTION_VERSION } from "./analysisSelectionVersion";
import { fitModelRecipe } from "./fitModelRecipe";
import { statisticalTestRecipe } from "./statisticalTestAnalysisResult";
import { testColumns, testDef, testUsesAlpha } from "./statsTests";
import { moreSettings } from "./statsTestsMore";
import { lifeSettings } from "./statsTestsLife";
import { screenSettings } from "./statsTestsScreen";
import { spcSettings } from "./statsTestsSpc";
import { TOOL_RESULT_DESCRIBERS } from "./toolResultDescribe";
import { williamsonHallRecipe } from "./williamsonHallRecipe";

export interface ResultBookSetting { label: string; value: string }

export interface ResultBookInputKeys {
  xKey?: number | null;
  yKeys: number[];
  /** The tool has no X axis (the summary line omits "X:"). */
  noX?: boolean;
}

export interface Described {
  method: string;
  settings: ResultBookSetting[];
  /** The columns the tool passed to the shared input resolver; null when the
   *  tool's input is not a column pick (peak rows, several worksheets, none). */
  inputKeys: ResultBookInputKeys | null;
  /** What the input is, when there is no column pick to restate. */
  inputNote?: string;
  /** False when no tool can reopen on this result (default true). */
  reopen?: boolean;
}

export const text = (value: unknown): string | null =>
  typeof value === "string" && value ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : null;

export const settings = (entries: readonly [string, string | null][]): ResultBookSetting[] =>
  entries.flatMap(([label, value]) => value === null ? [] : [{ label, value }]);

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** A short list: the first few names, then how many more. */
function names(labels: readonly string[], shown = 6): string {
  return labels.length <= shown ? labels.join(", ") : `${labels.slice(0, shown).join(", ")} and ${labels.length - shown} more`;
}

// ---- Statistical tests ----------------------------------------------------

const COLUMN_ROLE: Readonly<Record<string, string>> = {
  one: "Column", two: "Columns", paired: "Paired columns", blocks: "Conditions", columns: "Columns",
  factorial: "Response, factor A, factor B", regression: "Response, predictors",
  classifier: "Outcome (0/1), score", counts: "Observed counts (and expected)",
  survival: "Time, event (and group / predictors)",
  spc: "Data or count column (and subgroup / sample size)",
  life: "Time, censor (1 = censored) (and stress variable)",
  screen: "Responses (Y) and factors (X)",
  rowwise: "Group A and group B columns (one test per row)",
};

function savedLabels(result: AnalysisResult): string[] | null {
  const labels = result.parameters?.labels;
  return Array.isArray(labels) && labels.every((label) => typeof label === "string") ? labels as string[] : null;
}

function describeStatisticalTest(result: AnalysisResult): Described | null {
  const recipe = statisticalTestRecipe(result);
  if (!recipe) return null;
  const def = testDef(recipe.testId);
  const { params, selection } = recipe;
  const alpha = testUsesAlpha(def.id) ? String(params.alpha) : null;
  if (def.input === "none" && def.id !== "power") {
    return { method: def.label, inputKeys: null, inputNote: "summary counts entered in the workshop (no worksheet)", settings: settings([...moreSettings(def.id, params), ["Alpha", alpha]]) };
  }
  if (def.input === "none") {
    return {
      method: def.label, inputKeys: null, inputNote: "no worksheet (planning calculation)",
      settings: settings([
        ["Design", params.kind], ["Tails", params.tails === 1 ? "one-sided" : "two-sided"], ["Alpha", alpha],
        ["Effect size d", String(params.effectSize)], ["Target power", String(params.power)],
        ["Sample size n", params.n === null ? "solved for" : String(params.n)],
      ]),
    };
  }
  const labels = savedLabels(result);
  if (!labels) return null;
  const role = def.input === "groups"
    ? selection.groupMode === "category" ? "Groups (value by category)" : "Groups (first is the control)"
    : COLUMN_ROLE[def.input] ?? "Columns";
  return {
    method: def.label,
    inputKeys: { yKeys: testColumns(def.id, selection, params), noX: true },
    settings: settings([
      [role, labels.length ? names(labels) : null],
      ["Alpha", alpha],
      ["Alternative", def.id === "sign-test" || def.id === "dunnett" ? params.alternative : null],
      ["Correction", def.id === "dunnett" ? "Dunnett (each group against the control)" : null],
      ["Sums of squares", def.id === "anova2-unbalanced" ? `Type ${params.ssType === 3 ? "III" : "II"}` : null],
      ["Criterion", def.id === "stepwise" ? params.criterion.toUpperCase() : null],
      ["Direction", def.id === "stepwise" ? params.direction : null],
      ["Adjustment", def.id === "adjust-p" ? params.adjustMethod : null],
      ["Curves split by group", def.id === "kaplan-meier" ? (params.survivalGroups ? "yes" : "no") : null],
      ...moreSettings(def.id, params),
      ...(def.input === "spc" ? spcSettings(def.id, params) : []),
      ...(def.input === "life" ? lifeSettings(def.id, params) : []),
      ...(def.input === "screen" ? screenSettings(params) : []),
      ["Expected counts", def.id === "chi-square-gof" ? (params.gofExpected === "column" ? "from a column" : "uniform") : null],
    ]),
  };
}

// ---- Williamson–Hall ------------------------------------------------------

function describeWilliamsonHall(result: AnalysisResult): Described | null {
  const recipe = williamsonHallRecipe(result);
  if (!recipe) return null;
  return {
    method: "Williamson–Hall: crystallite size and microstrain",
    inputKeys: null,
    inputNote: `${plural(recipe.rows.length, "peak")} (2θ, FWHM) ${recipe.sourceKind === "peak-table" ? "from the fitted peak table" : "entered by hand"}`,
    settings: settings([
      ["Wavelength", `${recipe.wavelengthA} Å`], ["K factor", String(recipe.kFactor)],
      ["Instrumental broadening", `${recipe.instrumentalBroadeningDeg}°`],
    ]),
  };
}

function describeWilliamsonHallBatch(result: AnalysisResult): Described | null {
  const recipe = record(result.parameters?.recipe);
  const items = recipe?.items;
  if (!recipe || !Array.isArray(items) || !items.length || !finite(recipe.kFactor) || recipe.kFactor <= 0 ||
      !finite(recipe.instrumentalBroadeningDeg) || recipe.instrumentalBroadeningDeg < 0) return null;
  const wavelengths = new Set<number>();
  for (const raw of items) {
    const item = record(raw);
    if (!item || typeof item.datasetName !== "string" || !Array.isArray(item.rows) || item.rows.length < 2 ||
        !item.rows.every((row) => finite(record(row)?.twoTheta) && finite(record(row)?.fwhm)) ||
        !finite(item.wavelengthA) || item.wavelengthA <= 0) return null;
    wavelengths.add(item.wavelengthA);
  }
  return {
    method: `Williamson–Hall comparison across ${plural(items.length, "worksheet")}`,
    inputKeys: null, inputNote: "fitted peak tables (2θ, FWHM)", reopen: false,
    settings: settings([
      ["Wavelength", wavelengths.size === 1 ? `${[...wavelengths][0]} Å` : `${[...wavelengths].join(", ")} Å (per worksheet)`],
      ["K factor", String(recipe.kFactor)], ["Instrumental broadening", `${recipe.instrumentalBroadeningDeg}°`],
    ]),
  };
}

// ---- Analysis batches -----------------------------------------------------

const BATCH_VALUE_MAX = 80;

function describeAnalysisBatch(result: AnalysisResult): Described | null {
  const parameters = result.parameters;
  const selection = record(parameters?.selection);
  const table = result.tables?.find((candidate) => candidate.title === "Batch status");
  if (!parameters || typeof parameters.toolId !== "string" || !parameters.toolId ||
      selection?.version !== ANALYSIS_SELECTION_VERSION ||
      !table || table.columns[1] !== "Status") return null;
  // A worksheet batch has one row per worksheet; a saved By run
  // (lib/byLevelBatchResult) one row per level of its saved By column.
  const byColumn = typeof parameters.byColumn === "string" && parameters.byColumn ? parameters.byColumn : null;
  if (table.columns[0] !== (byColumn ? "Level" : "Worksheet")) return null;
  const completed = table.rows.filter((row) => row[1] === "Completed").length;
  // The tool's own saved settings (provenance only): plain values, as saved.
  const own = Object.entries(parameters).flatMap(([key, value]): [string, string][] => {
    if (key === "toolId" || key === "selection" || key === "byColumn") return [];
    const shown = typeof value === "boolean" ? (value ? "yes" : "no") : text(value);
    // A JSON-string blob (a tool's whole settings object) is not a readable setting.
    if (shown === null || /^[{[]/.test(shown)) return [];
    return [[key.charAt(0).toUpperCase() + key.slice(1), shown.length > BATCH_VALUE_MAX ? `${shown.slice(0, BATCH_VALUE_MAX - 1)}…` : shown]];
  });
  return {
    method: byColumn ? `${result.producer.label} by ${byColumn}` : `${result.producer.label} batch`,
    inputKeys: null, reopen: false,
    settings: settings([
      [byColumn ? "Levels" : "Worksheets", String(table.rows.length)], ["Completed", String(completed)], ...own,
    ]),
  };
}

// ---- Fit Model --------------------------------------------------------------

function describeFitModel(result: AnalysisResult): Described | null {
  const recipe = fitModelRecipe(result);
  if (!recipe) return null;
  const s = result.scalarValues ?? {};
  return {
    method: "Fit Model: standard least squares",
    inputKeys: { yKeys: [recipe.responseCol, ...new Set(recipe.terms.flat())], noX: true },
    settings: settings([
      ["Response", text(s["Response"])], ["Effects", text(s["Effects"])],
      ["Center polynomials", recipe.center ? "yes" : "no"], ["Alpha", text(s["Alpha"])],
    ]),
  };
}

export const EXTRA_DESCRIBERS: Readonly<Record<string, (result: AnalysisResult) => Described | null>> = {
  "statistical-test": describeStatisticalTest,
  "williamson-hall": describeWilliamsonHall,
  "williamson-hall-batch": describeWilliamsonHallBatch,
  "analysis-batch": describeAnalysisBatch,
  "fit-model": describeFitModel,
  ...TOOL_RESULT_DESCRIBERS,
};
