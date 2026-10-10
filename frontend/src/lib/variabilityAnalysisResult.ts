import type { NestedAnovaResponse, VarianceComponentsResponse, VariabilitySummaryResponse } from "./api";
import { ANALYSIS_RESULT_VERSION, INLINE_TABLE_LIMITS, type AnalysisResult, type AnalysisResultTable } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import type { Dataset } from "./types";

export interface VariabilityRecipe {
  responseCol: number;
  factorACol: number;
  factorBCol: number;
}

export interface VariabilityLevelLabels {
  aLabel: string;
  bLabels: string[];
}

export interface VariabilitySnapshot {
  responseLabel: string;
  factorALabel: string;
  factorBLabel: string;
  levelLabels: VariabilityLevelLabels[];
  anova: NestedAnovaResponse;
  summary: VariabilitySummaryResponse;
  varComp: VarianceComponentsResponse | null;
  varCompNote: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function variabilityRecipe(result: AnalysisResult, source?: Dataset): VariabilityRecipe | null {
  if (result.producer.id !== "variability-analysis") return null;
  const recipe = record(record(result.parameters)?.recipe);
  if (!recipe) return null;
  const indices = [recipe.responseCol, recipe.factorACol, recipe.factorBCol];
  if (!indices.every((value) => Number.isInteger(value) && (value as number) >= -1) ||
      new Set(indices).size !== indices.length) return null;
  if (source && indices.some((value) => (value as number) >= source.data.labels.length)) return null;
  return {
    responseCol: recipe.responseCol as number,
    factorACol: recipe.factorACol as number,
    factorBCol: recipe.factorBCol as number,
  };
}

function finite(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedTables(input: AnalysisResultTable[]): { tables: AnalysisResultTable[]; warnings: string[] } {
  const tables: AnalysisResultTable[] = [];
  const warnings: string[] = [];
  let cells = 0;
  input.forEach((table, index) => {
    const name = table.title ? `"${table.title}"` : `Table ${index + 1}`;
    if (tables.length >= INLINE_TABLE_LIMITS.tables || table.columns.length > INLINE_TABLE_LIMITS.columns) {
      warnings.push(`${name} was too large to save and was omitted.`);
      return;
    }
    const remaining = Math.max(0, INLINE_TABLE_LIMITS.cells - cells);
    const fit = Math.min(table.rows.length, INLINE_TABLE_LIMITS.rows,
      table.columns.length ? Math.floor(remaining / table.columns.length) : 0);
    if (fit < table.rows.length) warnings.push(`${name} was saved with ${fit} of ${table.rows.length} rows.`);
    cells += fit * table.columns.length;
    tables.push({ ...table, rows: table.rows.slice(0, fit) });
  });
  return { tables, warnings };
}

function tables(snapshot: VariabilitySnapshot): AnalysisResultTable[] {
  const anova: AnalysisResultTable = {
    title: "Nested ANOVA",
    columns: ["source", "SS", "df", "MS", "F", "p"],
    rows: snapshot.anova.table.map((row) => [
      row.source, finite(row.SS), finite(row.df), finite(row.MS), finite(row.F), finite(row.p),
    ]),
  };
  const components: AnalysisResultTable[] = snapshot.varComp ? [{
    title: "Variance components",
    columns: ["component", "variance", "raw estimate", "% total", "clamped"],
    rows: [
      ["A", finite(snapshot.varComp.sigma2_A), finite(snapshot.varComp.sigma2_A_raw), finite(snapshot.varComp.pct_A), snapshot.varComp.clamped.A ? "yes" : "no"],
      ["B(A)", finite(snapshot.varComp.sigma2_B_within_A), finite(snapshot.varComp.sigma2_B_within_A_raw), finite(snapshot.varComp.pct_B_within_A), snapshot.varComp.clamped.B_within_A ? "yes" : "no"],
      ["Error", finite(snapshot.varComp.sigma2_error), finite(snapshot.varComp.sigma2_error_raw), finite(snapshot.varComp.pct_error), snapshot.varComp.clamped.error ? "yes" : "no"],
    ],
  }] : [];
  const cells: AnalysisResultTable = {
    title: "Cell summaries",
    columns: [snapshot.factorALabel, snapshot.factorBLabel, "N", "mean", "sd"],
    rows: snapshot.summary.cells.map((cell) => [
      snapshot.levelLabels[cell.a_index]?.aLabel ?? String(cell.a_index),
      snapshot.levelLabels[cell.a_index]?.bLabels[cell.b_index] ?? String(cell.b_index),
      finite(cell.n), finite(cell.mean), finite(cell.sd),
    ]),
  };
  const groups: AnalysisResultTable = {
    title: "Factor A summaries",
    columns: [snapshot.factorALabel, "N", "mean"],
    rows: snapshot.summary.a_groups.map((group) => [
      snapshot.levelLabels[group.a_index]?.aLabel ?? String(group.a_index), finite(group.n), finite(group.mean),
    ]),
  };
  return [anova, ...components, cells, groups];
}

export function variabilityAnalysisResult(
  id: string,
  source: Dataset,
  recipe: VariabilityRecipe,
  snapshot: VariabilitySnapshot,
  createdAt = new Date().toISOString(),
): AnalysisResult {
  const bounded = boundedTables(tables(snapshot));
  const grandN = finite(snapshot.summary.grand_n);
  const grandMean = finite(snapshot.summary.grand_mean);
  const clamped = snapshot.varComp ? Object.entries(snapshot.varComp.clamped)
    .filter(([, value]) => value).map(([key]) => key === "B_within_A" ? "B(A)" : key) : [];
  const warnings = [
    ...(snapshot.varCompNote ? [snapshot.varCompNote] : []),
    ...(clamped.length ? [`Negative raw variance estimate${clamped.length === 1 ? "" : "s"} for ${clamped.join(", ")} ${clamped.length === 1 ? "was" : "were"} clamped to zero.`] : []),
    ...(!snapshot.anova.balanced ? ["The nested design is unbalanced; review the reported test denominator and variance-component method."] : []),
    ...bounded.warnings,
  ];
  const channel = (index: number, fallback: string) => index < 0 ? null : ({
    index, label: source.data.labels[index] ?? fallback, unit: source.data.units[index] ?? "",
  });
  return {
    version: ANALYSIS_RESULT_VERSION,
    id,
    name: `${snapshot.responseLabel} variability · ${source.name}`,
    producer: { id: "variability-analysis", label: "Variability", version: 1 },
    sources: [{ datasetId: source.id, role: "input" }], outputs: [],
    selection: {
      datasetId: source.id,
      channels: [
        channel(recipe.responseCol, snapshot.responseLabel),
        channel(recipe.factorACol, snapshot.factorALabel),
        channel(recipe.factorBCol, snapshot.factorBLabel),
      ].filter((value) => value !== null),
    },
    sourceFingerprint: analysisDataFingerprint(source),
    scalarValues: {
      Test: "Nested variability", Interpretation: `${grandN ?? "unknown"} observations; grand mean ${grandMean ?? "unavailable"}.`,
      Response: snapshot.responseLabel, "Factor A": snapshot.factorALabel, "Factor B (nested)": snapshot.factorBLabel,
      "A test denominator": snapshot.anova.a_tested_against,
      N: grandN, "Grand mean": grandMean, Alpha: finite(snapshot.anova.alpha),
      Balanced: snapshot.anova.balanced ? "yes" : "no",
      ...(snapshot.varComp ? {
        "Variance method": snapshot.varComp.method,
        "n1 coefficient": finite(snapshot.varComp.n1_coefficient),
        "n2 coefficient": finite(snapshot.varComp.n2_coefficient),
      } : {}),
    },
    parameters: { recipe: { ...recipe } },
    tables: bounded.tables, warnings, createdAt,
  };
}
