import type { DistFamily } from "./distpdf";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { ANALYSIS_RESULT_VERSION, type AnalysisResult, type AnalysisResultTable } from "./analysisResult";
import type { CalcResult, Dataset } from "./types";

export type DistributionFitPick = DistFamily | "none";

export interface DistributionRecipe {
  col: number;
  byCol: number | null;
  fitDist: DistributionFitPick;
  compareOpen: boolean;
  percentileInput: number;
}

export interface DistributionHistogram {
  counts: number[];
  centers: number[];
  edges: number[];
}

export interface DistributionNormality { W: number; p: number; N: number }

export interface DistributionLevelSnapshot {
  label: string;
  n: number;
  hist: DistributionHistogram | null;
  desc: CalcResult | null;
  norm: DistributionNormality | null;
  normNote: string | null;
  error: string | null;
}

export interface DistributionRankedFit {
  dist: string;
  params: Record<string, number>;
  loglike: number;
  aic: number;
  n_params: number;
  ks_d: number;
  ks_p: number;
  N: number;
  aicc: number | null;
}

export interface DistributionSnapshot {
  label: string;
  byLabel: string | null;
  hist: DistributionHistogram | null;
  desc: CalcResult | null;
  norm: DistributionNormality | null;
  normNote: string | null;
  levels: DistributionLevelSnapshot[];
  totalLevels: number;
  rankedFits: DistributionRankedFit[];
  rankingMetric: "aicc" | "ks_p";
  quantiles: { q1: number | null; median: number | null; q3: number | null } | null;
  percentileValue: number | null;
  skipped: { dist: string; reason: string }[];
}

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function summaryTable(snapshot: DistributionSnapshot): AnalysisResultTable {
  if (snapshot.levels.length) {
    return {
      title: snapshot.byLabel ? `Summary by ${snapshot.byLabel}` : "Summary by level",
      columns: ["level", "N", "mean", "median", "std", "min", "q1", "q3", "max", "Shapiro W", "Shapiro p"],
      rows: snapshot.levels.map((level) => [
        level.label, level.n, number(level.desc?.mean), number(level.desc?.median), number(level.desc?.std),
        number(level.desc?.min), number(level.desc?.q1), number(level.desc?.q3), number(level.desc?.max),
        number(level.norm?.W), number(level.norm?.p),
      ]),
    };
  }
  return {
    title: "Summary",
    columns: ["statistic", "value"],
    rows: [
      ["N", number(snapshot.desc?.N)], ["mean", number(snapshot.desc?.mean)],
      ["median", number(snapshot.desc?.median)], ["std", number(snapshot.desc?.std)],
      ["min", number(snapshot.desc?.min)], ["q1", number(snapshot.desc?.q1)],
      ["q3", number(snapshot.desc?.q3)], ["max", number(snapshot.desc?.max)],
      ["Shapiro W", number(snapshot.norm?.W)], ["Shapiro p", number(snapshot.norm?.p)],
    ],
  };
}

function histogramTable(hist: DistributionHistogram, title = "Histogram"): { table: AnalysisResultTable | null; warning: string | null } {
  const n = hist.counts.length;
  const finite = [...hist.counts, ...hist.centers, ...hist.edges].every(Number.isFinite);
  const geometryValid = n > 0 && hist.centers.length === n && hist.edges.length === n + 1 && n <= 10_000 &&
    hist.counts.every((count) => count >= 0) &&
    hist.edges.every((edge, index) => index === 0 || edge > hist.edges[index - 1]) &&
    hist.centers.every((center, index) => center >= hist.edges[index] && center <= hist.edges[index + 1]);
  if (!finite || !geometryValid) {
    return { table: null, warning: `${title} was not saved because its bin geometry was incomplete or invalid.` };
  }
  return { warning: null, table: {
    title,
    columns: ["bin left", "center", "bin right", "count"],
    rows: Array.from({ length: n }, (_, index) => [
      number(hist.edges[index]), number(hist.centers[index]), number(hist.edges[index + 1]), number(hist.counts[index]),
    ]),
  } };
}

function tables(snapshot: DistributionSnapshot): { tables: AnalysisResultTable[]; warnings: string[] } {
  const out = [summaryTable(snapshot)];
  const warnings: string[] = [];
  const addHistogram = (hist: DistributionHistogram, title?: string) => {
    const checked = histogramTable(hist, title);
    if (checked.table) out.push(checked.table);
    if (checked.warning) warnings.push(checked.warning);
  };
  if (snapshot.levels.length) {
    for (const level of snapshot.levels) if (level.hist) addHistogram(level.hist, `Histogram · ${level.label}`);
  } else if (snapshot.hist) addHistogram(snapshot.hist);
  if (snapshot.rankedFits.length) out.push({
    title: `Distribution fits · ranked by ${snapshot.rankingMetric === "aicc" ? "AICc" : "KS p"}`,
    columns: ["distribution", "parameters", "log likelihood", "AIC", "AICc", "KS D", "KS p", "N"],
    rows: snapshot.rankedFits.map((fit) => [
      fit.dist, Object.entries(fit.params).map(([key, value]) => `${key}=${value}`).join(", "),
      number(fit.loglike), number(fit.aic), number(fit.aicc), number(fit.ks_d), number(fit.ks_p), number(fit.N),
    ]),
  });
  if (snapshot.quantiles) out.push({
    title: "Fitted quantiles",
    columns: ["quantile", "value"],
    rows: [["25%", number(snapshot.quantiles.q1)], ["50%", number(snapshot.quantiles.median)],
      ["75%", number(snapshot.quantiles.q3)], ["requested percentile", number(snapshot.percentileValue)]],
  });
  return { tables: out, warnings };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function distributionRecipe(result: AnalysisResult, source?: Dataset): DistributionRecipe | null {
  if (result.producer.id !== "distribution-analysis") return null;
  const root = record(result.parameters);
  const recipe = record(root?.recipe);
  const fitDist = recipe?.fitDist;
  if (!recipe || !Number.isInteger(recipe.col) || (recipe.col as number) < -1 ||
      !(recipe.byCol === null || (Number.isInteger(recipe.byCol) && (recipe.byCol as number) >= 0)) ||
      (recipe.byCol !== null && recipe.byCol === recipe.col) ||
      (fitDist !== "none" && !["normal", "lognormal", "weibull", "gamma", "exponential"].includes(String(fitDist))) ||
      typeof recipe.compareOpen !== "boolean" || typeof recipe.percentileInput !== "number" ||
      !Number.isFinite(recipe.percentileInput) || recipe.percentileInput <= 0 || recipe.percentileInput >= 100 ||
      (source && ((recipe.col as number) >= source.data.labels.length ||
        (recipe.byCol !== null && (recipe.byCol as number) >= source.data.labels.length)))) return null;
  return { col: recipe.col as number, byCol: recipe.byCol as number | null,
    fitDist: fitDist as DistributionFitPick, compareOpen: recipe.compareOpen,
    percentileInput: recipe.percentileInput };
}

export function distributionAnalysisResult(
  id: string,
  source: Dataset,
  recipe: DistributionRecipe,
  snapshot: DistributionSnapshot,
  createdAt = new Date().toISOString(),
): AnalysisResult {
  const savedLevels = snapshot.levels.slice(0, 30);
  const savedSnapshot = { ...snapshot, levels: savedLevels };
  const savedTables = tables(savedSnapshot);
  const totalLevelCount = Math.max(snapshot.totalLevels, snapshot.levels.length);
  const channel = recipe.col >= 0 ? {
    index: recipe.col, label: source.data.labels[recipe.col] ?? snapshot.label,
    unit: source.data.units[recipe.col] ?? "",
  } : null;
  const byChannel = recipe.byCol != null && recipe.byCol >= 0 ? {
    index: recipe.byCol, label: source.data.labels[recipe.byCol] ?? snapshot.byLabel ?? `channel ${recipe.byCol + 1}`,
    unit: source.data.units[recipe.byCol] ?? "",
  } : null;
  const normality = savedSnapshot.levels.length
    ? `${snapshot.label} summarized across ${savedSnapshot.levels.length} level${savedSnapshot.levels.length === 1 ? "" : "s"}${snapshot.byLabel ? ` of ${snapshot.byLabel}` : ""}.`
    : snapshot.norm
      ? `Shapiro–Wilk p=${snapshot.norm.p}: ${snapshot.norm.p >= 0.05 ? "consistent with" : "evidence against"} normality at the 5% level.`
      : `${snapshot.label} distribution summary; ${snapshot.normNote ?? "normality was unavailable"}.`;
  return {
    version: ANALYSIS_RESULT_VERSION,
    id,
    name: `${snapshot.label} distribution · ${source.name}`,
    producer: { id: "distribution-analysis", label: "Distribution", version: 1 },
    sources: [{ datasetId: source.id, role: "input" }], outputs: [],
    selection: { datasetId: source.id, channels: [channel, byChannel].filter((item) => item !== null) },
    sourceFingerprint: analysisDataFingerprint(source),
    scalarValues: {
      Test: "Distribution", Interpretation: normality, Column: snapshot.label,
      ...(snapshot.byLabel ? { "By column": snapshot.byLabel } : {}),
      N: savedSnapshot.levels.length ? savedSnapshot.levels.reduce((sum, level) => sum + level.n, 0) : number(snapshot.desc?.N),
    },
    parameters: { recipe: { col: recipe.col, byCol: recipe.byCol, fitDist: recipe.fitDist,
      compareOpen: recipe.compareOpen, percentileInput: recipe.percentileInput },
      rankingMetric: snapshot.rankingMetric },
    tables: savedTables.tables,
    warnings: [
      ...(totalLevelCount > savedLevels.length ? [`Only ${savedLevels.length} of ${totalLevelCount} By levels were saved.`] : []),
      ...savedLevels.flatMap((level) => level.error ? [`${level.label}: ${level.error}`] : []),
      ...snapshot.skipped.map((item) => `${item.dist} fit skipped: ${item.reason}`),
      ...savedTables.warnings,
    ],
    createdAt,
  };
}
