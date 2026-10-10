import { analysisDataFingerprint } from "./analysisResultFreshness";
import { ANALYSIS_RESULT_VERSION, type AnalysisResult, type AnalysisResultTable } from "./analysisResult";
import type { Recommendation } from "./statschooser";
import type { CalcResult, Dataset } from "./types";

export type FitYByXMode = "oneway" | "bivariate" | "contingency";

export interface FitYByXRecipe {
  xCol: number;
  yCol: number;
  byCol: number | null;
  order: number;
  bandInterval: "confidence" | "prediction";
}

interface OnewayGroupSnapshot { label: string; values: number[] }
interface OnewaySnapshot {
  groups: OnewayGroupSnapshot[];
  anova: CalcResult;
  levene: CalcResult | null;
  tukey: CalcResult | null;
  recommend: Recommendation | null;
  failed?: Partial<Record<"levene" | "tukey" | "recommend", string>>;
}
interface RegressionBandSnapshot {
  x: number[];
  ciLo: number[];
  ciHi: number[];
  alpha: number;
  interval: "confidence" | "prediction";
}
interface BivariateSnapshot {
  x: number[];
  y: number[];
  order: number;
  regression: CalcResult;
  band: RegressionBandSnapshot | null;
}
interface ContingencySnapshot {
  rowLabels: string[];
  colLabels: string[];
  table: number[][];
  chiSquare: CalcResult;
  fisher: CalcResult | null;
  failed?: Partial<Record<"fisher", string>>;
}

export interface FitYByXLegSnapshot {
  oneway?: OnewaySnapshot | null;
  bivariate?: BivariateSnapshot | null;
  contingency?: ContingencySnapshot | null;
}

export interface FitYByXLevelSnapshot extends FitYByXLegSnapshot {
  label: string;
  n: number;
  error: string | null;
}

export interface FitYByXSnapshot extends FitYByXLegSnapshot {
  mode: FitYByXMode;
  xLabel: string;
  yLabel: string;
  byLabel: string | null;
  levels: FitYByXLevelSnapshot[];
  totalLevels: number;
}

const MAX_LEVELS = 30;
const MAX_DETAIL_ROWS = 5_000;
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function fitYByXRecipe(result: AnalysisResult, source?: Dataset): FitYByXRecipe | null {
  if (result.producer.id !== "fit-y-by-x") return null;
  const root = record(result.parameters);
  const recipe = record(root?.recipe);
  if (!recipe || !Number.isInteger(recipe.xCol) || !Number.isInteger(recipe.yCol) ||
      (recipe.xCol as number) < -1 || (recipe.yCol as number) < -1 || recipe.xCol === recipe.yCol ||
      !(recipe.byCol === null || (Number.isInteger(recipe.byCol) && (recipe.byCol as number) >= 0)) ||
      recipe.byCol === recipe.xCol || recipe.byCol === recipe.yCol ||
      !Number.isInteger(recipe.order) || (recipe.order as number) < 1 || (recipe.order as number) > 3 ||
      (recipe.bandInterval !== "confidence" && recipe.bandInterval !== "prediction")) return null;
  if (source) {
    const channels = source.data.labels.length;
    if ((recipe.xCol as number) >= channels || (recipe.yCol as number) >= channels ||
        (recipe.byCol !== null && (recipe.byCol as number) >= channels)) return null;
  }
  return {
    xCol: recipe.xCol as number, yCol: recipe.yCol as number,
    byCol: recipe.byCol as number | null, order: recipe.order as number,
    bandInterval: recipe.bandInterval,
  };
}

function mean(values: readonly number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function sd(values: readonly number[]): number | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return null;
  const avg = mean(finite)!;
  return Math.sqrt(finite.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (finite.length - 1));
}

function scalarTable(mode: FitYByXMode, legs: { level: string | null; leg: FitYByXLegSnapshot }[]): AnalysisResultTable {
  if (mode === "oneway") return {
    title: "Oneway tests",
    columns: ["level", "F", "df1", "df2", "p", "reject H0", "Levene p", "recommendation"],
    rows: legs.flatMap(({ level, leg }) => leg.oneway ? [[
      level ?? "All", number(leg.oneway.anova.fStat), number(leg.oneway.anova.df1),
      number(leg.oneway.anova.df2), number(leg.oneway.anova.pValue),
      leg.oneway.anova.reject === true ? "yes" : "no", number(leg.oneway.levene?.p),
      leg.oneway.recommend?.recommendation ?? null,
    ]] : []),
  };
  if (mode === "bivariate") return {
    title: "Regression summary",
    columns: ["level", "N", "order", "R²", "adjusted R²", "RMSE", "F", "p", "band"],
    rows: legs.flatMap(({ level, leg }) => leg.bivariate ? [[
      level ?? "All", number(leg.bivariate.regression.N), leg.bivariate.order,
      number(leg.bivariate.regression.R2), number(leg.bivariate.regression.R2adj),
      number(leg.bivariate.regression.RMSE), number(leg.bivariate.regression.fStat),
      number(leg.bivariate.regression.fPvalue), leg.bivariate.band?.interval ?? null,
    ]] : []),
  };
  return {
    title: "Contingency tests",
    columns: ["level", "N", "chi²", "dof", "p", "Cramér's V", "Fisher odds ratio", "Fisher p"],
    rows: legs.flatMap(({ level, leg }) => leg.contingency ? [[
      level ?? "All", number(leg.contingency.chiSquare.n), number(leg.contingency.chiSquare.chi2),
      number(leg.contingency.chiSquare.dof), number(leg.contingency.chiSquare.p_value),
      number(leg.contingency.chiSquare.cramers_v), number(leg.contingency.fisher?.odds_ratio),
      number(leg.contingency.fisher?.p_value),
    ]] : []),
  };
}

function detailTable(mode: FitYByXMode, legs: { level: string | null; leg: FitYByXLegSnapshot }[]): AnalysisResultTable {
  if (mode === "oneway") return {
    title: "Group summaries",
    columns: ["level", "group", "N", "mean", "sd"],
    rows: legs.flatMap(({ level, leg }) => (leg.oneway?.groups ?? []).map((group) => [
      level ?? "All", group.label, group.values.filter(Number.isFinite).length, mean(group.values), sd(group.values),
    ])).slice(0, MAX_DETAIL_ROWS),
  };
  if (mode === "bivariate") return {
    title: "Regression coefficients",
    columns: ["level", "term", "estimate", "SE", "t", "p"],
    rows: legs.flatMap(({ level, leg }) => {
      const coeffs = Array.isArray(leg.bivariate?.regression.coeffs) ? leg.bivariate!.regression.coeffs as unknown[] : [];
      const se = Array.isArray(leg.bivariate?.regression.se) ? leg.bivariate!.regression.se as unknown[] : [];
      const t = Array.isArray(leg.bivariate?.regression.tStats) ? leg.bivariate!.regression.tStats as unknown[] : [];
      const p = Array.isArray(leg.bivariate?.regression.pValues) ? leg.bivariate!.regression.pValues as unknown[] : [];
      return coeffs.map((value, index) => [level ?? "All", index === 0 ? "intercept" : `x^${index}`,
        number(value), number(se[index]), number(t[index]), number(p[index])]);
    }).slice(0, MAX_DETAIL_ROWS),
  };
  return {
    title: "Contingency cells",
    columns: ["level", "row", "column", "observed", "expected"],
    rows: legs.flatMap(({ level, leg }) => {
      if (!leg.contingency) return [];
      const expected = Array.isArray(leg.contingency.chiSquare.expected)
        ? leg.contingency.chiSquare.expected as unknown[][] : [];
      return leg.contingency.table.flatMap((row, rowIndex) => row.map((observed, columnIndex) => [
        level ?? "All", leg.contingency!.rowLabels[rowIndex] ?? String(rowIndex),
        leg.contingency!.colLabels[columnIndex] ?? String(columnIndex), number(observed),
        number(expected[rowIndex]?.[columnIndex]),
      ]));
    }).slice(0, MAX_DETAIL_ROWS),
  };
}

function extraTables(
  mode: FitYByXMode,
  legs: { level: string | null; leg: FitYByXLegSnapshot }[],
): { tables: AnalysisResultTable[]; warnings: string[] } {
  const warnings: string[] = [];
  if (mode === "oneway") {
    const comparisons = legs.flatMap(({ level, leg }) => {
      const pairs = Array.isArray(leg.oneway?.tukey?.pairs) ? leg.oneway!.tukey!.pairs as unknown[] : [];
      return pairs.flatMap((value) => {
        const pair = record(value);
        const i = number(pair?.i);
        const j = number(pair?.j);
        if (!pair || i === null || j === null || !Number.isInteger(i) || !Number.isInteger(j)) return [];
        return [[level ?? "All", leg.oneway!.groups[i]?.label ?? String(i), leg.oneway!.groups[j]?.label ?? String(j),
          number(pair.diff), number(pair.p), number(pair.ciLow), number(pair.ciHigh), pair.significant === true ? "yes" : "no"]];
      });
    });
    const recommendations = legs.flatMap(({ level, leg }) => leg.oneway?.recommend ? [[
      level ?? "All", leg.oneway.recommend.recommendation, leg.oneway.recommend.parametric ? "yes" : "no",
      leg.oneway.recommend.endpoint, leg.oneway.recommend.reasons.join("; "),
    ]] : []);
    return { warnings, tables: [
      ...(comparisons.length ? [{ title: "Tukey HSD", columns: ["level", "A", "B", "difference", "p", "CI low", "CI high", "significant"], rows: comparisons.slice(0, MAX_DETAIL_ROWS) }] : []),
      ...(recommendations.length ? [{ title: "Test chooser", columns: ["level", "recommendation", "parametric", "endpoint", "reasons"], rows: recommendations }] : []),
    ] };
  }
  if (mode !== "bivariate") return { tables: [], warnings };
  const points: AnalysisResultTable["rows"] = [];
  const bands: AnalysisResultTable["rows"] = [];
  for (const { level, leg } of legs) {
    const fit = leg.bivariate;
    if (!fit) continue;
    const yFit = Array.isArray(fit.regression.yFit) ? fit.regression.yFit as unknown[] : [];
    if (fit.x.length !== fit.y.length) {
      warnings.push(`${level ? `${level}: ` : ""}fit points were not saved because X and Y lengths differ.`);
    } else {
      const fittedValid = yFit.length === fit.x.length;
      if (!fittedValid) warnings.push(`${level ? `${level}: ` : ""}fitted values were incomplete and were saved as unavailable.`);
      fit.x.forEach((x, index) => points.push([
        level ?? "All", number(x), number(fit.y[index]), fittedValid ? number(yFit[index]) : null,
      ]));
    }
    if (fit.band) {
      const valid = fit.band.x.length > 0 && fit.band.x.length === fit.band.ciLo.length &&
        fit.band.x.length === fit.band.ciHi.length &&
        [...fit.band.x, ...fit.band.ciLo, ...fit.band.ciHi].every(Number.isFinite);
      if (!valid) warnings.push(`${level ? `${level}: ` : ""}${fit.band.interval} band was not saved because its geometry was incomplete or invalid.`);
      else fit.band.x.forEach((x, index) => bands.push([
        level ?? "All", number(x), number(fit.band!.ciLo[index]), number(fit.band!.ciHi[index]), fit.band!.alpha,
      ]));
    }
  }
  if (points.length > MAX_DETAIL_ROWS) warnings.push(`Fit points were limited to ${MAX_DETAIL_ROWS} rows.`);
  if (bands.length > MAX_DETAIL_ROWS) warnings.push(`Band points were limited to ${MAX_DETAIL_ROWS} rows.`);
  return { warnings, tables: [
    ...(points.length ? [{ title: "Fit points", columns: ["level", "X", "Y", "fitted Y"], rows: points.slice(0, MAX_DETAIL_ROWS) }] : []),
    ...(bands.length ? [{ title: "Regression band", columns: ["level", "X", "lower", "upper", "alpha"], rows: bands.slice(0, MAX_DETAIL_ROWS) }] : []),
  ] };
}

function interpretation(snapshot: FitYByXSnapshot, legs: { level: string | null; leg: FitYByXLegSnapshot }[]): string {
  if (snapshot.levels.length) {
    return `${snapshot.yLabel} by ${snapshot.xLabel} was analyzed across ${legs.length} level${legs.length === 1 ? "" : "s"}${snapshot.byLabel ? ` of ${snapshot.byLabel}` : ""}.`;
  }
  const leg = legs[0]?.leg;
  if (snapshot.mode === "oneway" && leg?.oneway) {
    return `One-way ANOVA p=${number(leg.oneway.anova.pValue) ?? "unavailable"}.`;
  }
  if (snapshot.mode === "bivariate" && leg?.bivariate) {
    return `Order-${leg.bivariate.order} regression R²=${number(leg.bivariate.regression.R2) ?? "unavailable"}, p=${number(leg.bivariate.regression.fPvalue) ?? "unavailable"}.`;
  }
  if (snapshot.mode === "contingency" && leg?.contingency) {
    return `Chi-square independence p=${number(leg.contingency.chiSquare.p_value) ?? "unavailable"}.`;
  }
  return `${snapshot.yLabel} by ${snapshot.xLabel} analysis.`;
}

function warnings(snapshot: FitYByXSnapshot, legs: { level: string | null; leg: FitYByXLegSnapshot }[]): string[] {
  const out: string[] = [];
  if (snapshot.totalLevels > snapshot.levels.length) {
    out.push(`Only ${snapshot.levels.length} of ${snapshot.totalLevels} By levels were saved.`);
  }
  for (const level of snapshot.levels) if (level.error) out.push(`${level.label}: ${level.error}`);
  for (const { level, leg } of legs) {
    const prefix = level ? `${level}: ` : "";
    for (const [test, reason] of Object.entries(leg.oneway?.failed ?? {})) out.push(`${prefix}${test} failed: ${reason}`);
    for (const [test, reason] of Object.entries(leg.contingency?.failed ?? {})) out.push(`${prefix}${test} failed: ${reason}`);
  }
  const detailRows = legs.reduce((count, { leg }) => count + (snapshot.mode === "oneway"
    ? (leg.oneway?.groups.length ?? 0)
    : snapshot.mode === "bivariate"
      ? (Array.isArray(leg.bivariate?.regression.coeffs) ? leg.bivariate!.regression.coeffs.length : 0)
      : (leg.contingency?.table.reduce((sum, row) => sum + row.length, 0) ?? 0)), 0);
  if (detailRows > MAX_DETAIL_ROWS) out.push(`Detail table was limited to ${MAX_DETAIL_ROWS} rows.`);
  return out;
}

export function fitYByXAnalysisResult(
  id: string,
  source: Dataset,
  recipe: FitYByXRecipe,
  snapshot: FitYByXSnapshot,
  createdAt = new Date().toISOString(),
): AnalysisResult {
  const savedLevels = snapshot.levels.slice(0, MAX_LEVELS);
  const savedSnapshot = { ...snapshot, levels: savedLevels };
  const legs = savedLevels.length
    ? savedLevels.filter((level) => !level.error).map((level) => ({ level: level.label, leg: level as FitYByXLegSnapshot }))
    : [{ level: null, leg: savedSnapshot as FitYByXLegSnapshot }];
  const channel = (index: number, fallback: string) => index >= 0 ? {
    index, label: source.data.labels[index] ?? fallback, unit: source.data.units[index] ?? "",
  } : null;
  const selected = [channel(recipe.xCol, snapshot.xLabel), channel(recipe.yCol, snapshot.yLabel),
    recipe.byCol === null ? null : channel(recipe.byCol, snapshot.byLabel ?? "By")].filter((item) => item !== null);
  const extras = extraTables(snapshot.mode, legs);
  const tables = [scalarTable(snapshot.mode, legs), detailTable(snapshot.mode, legs), ...extras.tables];
  return {
    version: ANALYSIS_RESULT_VERSION,
    id,
    name: `${snapshot.yLabel} by ${snapshot.xLabel} · ${source.name}`,
    producer: { id: "fit-y-by-x", label: "Fit Y by X", version: 1 },
    sources: [{ datasetId: source.id, role: "input" }], outputs: [],
    selection: { datasetId: source.id, channels: selected },
    sourceFingerprint: analysisDataFingerprint(source),
    scalarValues: {
      Test: "Fit Y by X", Mode: snapshot.mode, Interpretation: interpretation(savedSnapshot, legs),
      "X column": snapshot.xLabel, "Y column": snapshot.yLabel,
      ...(snapshot.byLabel ? { "By column": snapshot.byLabel } : {}),
    },
    parameters: { recipe: {
      xCol: recipe.xCol, yCol: recipe.yCol, byCol: recipe.byCol, order: recipe.order,
      bandInterval: recipe.bandInterval,
    }, mode: snapshot.mode },
    tables,
    warnings: [...warnings(savedSnapshot, legs), ...extras.warnings],
    createdAt,
  };
}
