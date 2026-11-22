// The result book (lane RB, ANALYSIS_CAPABILITY_ROADMAP "Statistical engines
// ... feel like separate utilities"): one expandable view of a SAVED
// statistics result. This module is the pure model: which producers have a
// book, the method and settings line, the input columns to restate through the
// shared input resolver, and the sections in their one fixed order.
//
// SECTION ORDER (every producer): the saved tables in the order the tool saved
// them (each tool already leads with its summary table), then the figures in
// the order lib/statisticalResultFigures drafts them. Nothing is reordered per
// tool, so the same result always reads the same way.
//
// FAIL CLOSED: an unknown producer, or a supported one whose saved recipe does
// not parse, has no book (null, and no tab): the existing tabs still show it.
// The recipe is parsed WITHOUT the live worksheet, so a source that later lost
// a column still shows its saved book (out of date). The input
// line is restated from the live worksheet ONLY while the result is current
// (lib/analysisResultFreshness: same analysis-view fingerprint, so the same
// rows); otherwise the book says the saved values no longer match the source
// instead of describing rows that were not the ones analysed. Pure: no store,
// no React.

import type { AnalysisResult } from "./analysisResult";
import { ROW_POLICY, resolveAnalysisInputs, type AnalysisInputs } from "./analysisInputs";
import { inlineTableOutputs } from "./analysisResultFreezeOutputs";
import type { SnapshotResultState } from "./analysisResultFreshness";
import { distributionRecipe } from "./distributionAnalysisResult";
import { fitYByXRecipe } from "./fitYByXAnalysisResult";
import { multivariateRecipe } from "./multivariateAnalysisResult";
import { outlierScreeningRecipe } from "./outlierScreeningAnalysisResult";
import { statisticalResultFigureDrafts, type StatisticalResultFigureDraft } from "./statisticalResultFigures";
import { EXTRA_DESCRIBERS, settings, text, type Described, type ResultBookInputKeys, type ResultBookSetting } from "./resultBookDescribe";
import type { Dataset } from "./types";
import { variabilityRecipe } from "./variabilityAnalysisResult";

export type { ResultBookSetting };

export type ResultBookSection =
  | { key: string; kind: "table"; title: string; tableIndex: number; rows: number; cols: number;
      /** Why the table cannot become a worksheet (the Freeze rule), or null. */
      freezeBlocked: string | null }
  | { key: string; kind: "figure"; title: string; draft: StatisticalResultFigureDraft };

export interface ResultBookModel {
  method: string;
  settings: ResultBookSetting[];
  /** The columns the tool passed to the shared input resolver; null when the
   *  tool's input is not a column pick (see `inputNote`). */
  inputKeys: ResultBookInputKeys | null;
  /** What the input is when there is no column pick to restate. */
  inputNote: string | null;
  /** A tool can reopen on this result. */
  reopen: boolean;
  sections: ResultBookSection[];
}

function scalar(result: AnalysisResult, key: string): string | null {
  return text(result.scalarValues?.[key]);
}

const FIT_NAMES: Readonly<Record<string, string>> = {
  none: "none", normal: "normal", lognormal: "lognormal", weibull: "Weibull", gamma: "gamma", exponential: "exponential",
};
const OUTLIER_NAMES: Readonly<Record<string, string>> = {
  grubbs: "Grubbs", rosner: "Rosner generalized ESD", "dixon-q": "Dixon Q", mad: "MAD (robust z)",
};

/** Per-producer description, as data: a new statistics producer plugs in with
 *  one entry. Each mirrors the columns its tool resolves (see the tool's
 *  useAnalysisInputs call), so the book's input line matches the tool's. */
const DESCRIBE: Readonly<Record<string, (result: AnalysisResult) => Described | null>> = {
  ...EXTRA_DESCRIBERS,
  "distribution-analysis": (result) => {
    const recipe = distributionRecipe(result);
    return recipe && {
      method: recipe.fitDist === "none" ? "Distribution: descriptive summary and Shapiro–Wilk"
        : `Distribution: descriptive summary, Shapiro–Wilk and a ${FIT_NAMES[recipe.fitDist]} fit`,
      inputKeys: { yKeys: [recipe.col] },
      settings: settings([
        ["Column", scalar(result, "Column")], ["By", scalar(result, "By column")],
        ["Fitted distribution", FIT_NAMES[recipe.fitDist]],
        ["Compare distributions", recipe.compareOpen ? "yes" : "no"],
        ["Percentile", `${recipe.percentileInput}%`],
      ]),
    };
  },
  "fit-y-by-x": (result) => {
    const recipe = fitYByXRecipe(result);
    const mode = scalar(result, "Mode");
    return recipe && {
      method: `Fit Y by X${mode ? `: ${mode}` : ""}`,
      inputKeys: { xKey: recipe.xCol, yKeys: [recipe.yCol] },
      settings: settings([
        ["X", scalar(result, "X column")], ["Y", scalar(result, "Y column")], ["By", scalar(result, "By column")],
        ["Polynomial order", String(recipe.order)], ["Band", `${recipe.bandInterval} interval`],
      ]),
    };
  },
  "multivariate-analysis": (result) => {
    const recipe = multivariateRecipe(result);
    return recipe && {
      method: `Multivariate: ${recipe.method === "pearson" ? "Pearson" : "Spearman"} correlation and PCA`,
      inputKeys: { yKeys: [...recipe.columns] },
      settings: settings([
        ["Variables", scalar(result, "Variables")],
        ["PCA standardized", recipe.standardize ? "yes" : "no"],
        ["Score axes", `PC${recipe.pcX + 1} / PC${recipe.pcY + 1}`],
      ]),
    };
  },
  "variability-analysis": (result) => {
    const recipe = variabilityRecipe(result);
    return recipe && {
      method: "Variability: nested ANOVA and variance components",
      inputKeys: { yKeys: [recipe.responseCol, recipe.factorACol, recipe.factorBCol] },
      settings: settings([
        ["Response", scalar(result, "Response")], ["Factor A", scalar(result, "Factor A")],
        ["Factor B (nested)", scalar(result, "Factor B (nested)")], ["Alpha", scalar(result, "Alpha")],
      ]),
    };
  },
  "outlier-screening": (result) => {
    const recipe = outlierScreeningRecipe(result);
    return recipe && {
      method: `Outlier screening: ${OUTLIER_NAMES[recipe.method] ?? recipe.method}`,
      inputKeys: { yKeys: [recipe.col] },
      settings: settings([
        ["Column", scalar(result, "Channel")],
        ...(recipe.method === "mad" ? [["Threshold", String(recipe.threshold)] as [string, string]]
          : [["Alpha", String(recipe.alpha)] as [string, string]]),
        ...(recipe.method === "rosner" ? [["Maximum outliers", String(recipe.k)] as [string, string]] : []),
      ]),
    };
  },
};

export const RESULT_BOOK_PRODUCERS: readonly string[] = Object.keys(DESCRIBE);

function describe(result: AnalysisResult): Described | null {
  return Object.hasOwn(DESCRIBE, result.producer.id) && result.outputs.length === 0
    ? DESCRIBE[result.producer.id](result) : null;
}

export function hasResultBook(result: AnalysisResult): boolean {
  return describe(result) !== null;
}

export function resultBookModel(result: AnalysisResult): ResultBookModel | null {
  const described = describe(result);
  if (!described) return null;
  const freeze = inlineTableOutputs(result, []);
  const tables: ResultBookSection[] = (result.tables ?? []).map((table, index) => ({
    key: `table:${index}`, kind: "table", title: table.title || `Table ${index + 1}`, tableIndex: index,
    rows: table.rows.length, cols: table.columns.length,
    freezeBlocked: freeze[index]?.freezable ? null : freeze[index]?.reason ?? "this table cannot become a worksheet",
  }));
  const figures: ResultBookSection[] = statisticalResultFigureDrafts(result).map((draft) => ({
    key: `figure:${draft.key}`, kind: "figure", title: draft.name, draft,
  }));
  return {
    ...described, inputNote: described.inputNote ?? null, reopen: described.reopen ?? true,
    sections: [...tables, ...figures],
  };
}

/** The live input line for a CURRENT result (null otherwise): the same
 *  resolver and row policy the tool used, so it reads exactly like the tool. */
export function resultBookInputs(
  model: ResultBookModel, source: Dataset | undefined, state: SnapshotResultState,
): AnalysisInputs | null {
  if (state !== "current" || !source || !model.inputKeys) return null;
  const { xKey, yKeys, noX } = model.inputKeys;
  return resolveAnalysisInputs({
    datasets: [source], activeId: source.id, policy: ROW_POLICY.analysisView, yKeys,
    ...(xKey !== undefined ? { xKey } : {}), ...(noX ? { noX: true } : {}),
  });
}

/** The saved input as recorded, for a result whose live line is not shown
 *  (not current, or a tool whose input is not a column pick). */
export function resultBookSavedInput(result: AnalysisResult, model: ResultBookModel, source: Dataset | undefined): string {
  const count = result.sources.length;
  const worksheet = count > 1 ? `${count} worksheets` : count === 1 ? source?.name ?? "missing source" : null;
  const detail = model.inputKeys
    ? result.selection?.channels.map((channel) => channel.label).join(", ") ?? ""
    : model.inputNote ?? "";
  return `Input: ${[worksheet, detail].filter(Boolean).join(" · ")}`;
}
