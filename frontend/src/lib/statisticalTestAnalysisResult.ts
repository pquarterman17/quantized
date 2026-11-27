import type { StatsTestId } from "./api/statsTests";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { ANALYSIS_RESULT_VERSION, INLINE_TABLE_LIMITS, type AnalysisResult, type AnalysisResultTable } from "./analysisResult";
import { restoreMore } from "./statsTestsMore";
import { restoreLife } from "./statsTestsLife";
import { restoreRowT } from "./statsTestsRows";
import { restoreScreen } from "./statsTestsScreen";
import { restoreSpc } from "./statsTestsSpc";
import { DEFAULT_PARAMS, STATS_TESTS, testColumns, testDef, type TestParams, type TestSelection } from "./statsTests";
import type { TestOutput } from "./statsTestsResults";
import type { Dataset } from "./types";
import { INPUTS_PARAM, recordedInputs } from "./resultInputsRecord";

export interface StatisticalTestRecipe {
  testId: StatsTestId;
  selection: TestSelection;
  params: TestParams;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Recover a producer-owned recipe only when every field required by the
 * current workshop is valid. Future or hand-edited records stay inspectable
 * but do not seed an ambiguous rerun. */
export function statisticalTestRecipe(result: AnalysisResult): StatisticalTestRecipe | null {
  if (result.producer.id !== "statistical-test") return null;
  const root = record(result.parameters);
  const selection = record(root?.selection);
  const params = record(root?.params);
  const testId = root?.testId;
  if (typeof testId !== "string" || !STATS_TESTS.some((test) => test.id === testId) || !selection || !params ||
      !Number.isInteger(selection.x) || !Number.isInteger(selection.y) ||
      !Array.isArray(selection.cols) || !selection.cols.every(Number.isInteger) ||
      !Number.isInteger(selection.byCol) || !Number.isInteger(selection.byCol2) ||
      (selection.groupMode !== "columns" && selection.groupMode !== "category") ||
      typeof params.alpha !== "number" || !Number.isFinite(params.alpha) ||
      !["two-sided", "less", "greater"].includes(String(params.alternative)) ||
      (params.ssType !== 2 && params.ssType !== 3) ||
      (params.criterion !== "aic" && params.criterion !== "bic") ||
      !["forward", "backward", "both"].includes(String(params.direction)) ||
      typeof params.effectSize !== "number" || !Number.isFinite(params.effectSize) ||
      !(params.n === null || (typeof params.n === "number" && Number.isFinite(params.n))) ||
      typeof params.power !== "number" || !Number.isFinite(params.power) ||
      !["two-sample", "paired", "one-sample"].includes(String(params.kind)) ||
      (params.tails !== 1 && params.tails !== 2) ||
      // Added later: a result saved before them still reopens (defaults below).
      (params.adjustMethod !== undefined && !["holm", "bonferroni", "bh"].includes(String(params.adjustMethod))) ||
      (params.gofExpected !== undefined && !["uniform", "column"].includes(String(params.gofExpected))) ||
      (params.survivalGroups !== undefined && typeof params.survivalGroups !== "boolean") ||
      restoreMore(params.more) === null || restoreSpc(params.spc) === null || restoreLife(params.life) === null ||
      restoreScreen(params.screen) === null || restoreRowT(params.rowt) === null) return null;
  return {
    testId: testId as StatsTestId,
    selection: {
      x: selection.x as number, y: selection.y as number,
      cols: [...selection.cols] as number[], byCol: selection.byCol as number,
      byCol2: selection.byCol2 as number, groupMode: selection.groupMode,
    },
    params: {
      alpha: params.alpha, alternative: params.alternative as TestParams["alternative"],
      ssType: params.ssType, criterion: params.criterion, direction: params.direction as TestParams["direction"],
      effectSize: params.effectSize, n: params.n as number | null, power: params.power,
      kind: params.kind as TestParams["kind"], tails: params.tails,
      adjustMethod: (params.adjustMethod ?? DEFAULT_PARAMS.adjustMethod) as TestParams["adjustMethod"],
      gofExpected: (params.gofExpected ?? DEFAULT_PARAMS.gofExpected) as TestParams["gofExpected"],
      survivalGroups: (params.survivalGroups ?? DEFAULT_PARAMS.survivalGroups) as boolean,
      more: restoreMore(params.more) ?? DEFAULT_PARAMS.more,
      spc: restoreSpc(params.spc) ?? DEFAULT_PARAMS.spc,
      life: restoreLife(params.life) ?? DEFAULT_PARAMS.life,
      screen: restoreScreen(params.screen) ?? DEFAULT_PARAMS.screen,
      rowt: restoreRowT(params.rowt) ?? DEFAULT_PARAMS.rowt,
    },
  };
}

/** Fit the result tables inside the envelope's saved-table bounds, saying
 * what was left out. Without this the sanitizer would discard every table on
 * reopen with no trace (e.g. partial correlation over >255 columns, or
 * pairwise comparisons across >141 groups). Rows are cut, never columns: a
 * table with too many columns is omitted whole rather than shown misaligned. */
function boundedTables(output: TestOutput): { tables: AnalysisResultTable[]; warnings: string[] } {
  const limits = INLINE_TABLE_LIMITS;
  const tables: AnalysisResultTable[] = [];
  const warnings: string[] = [];
  let cells = 0;
  output.tables.forEach((table, index) => {
    const name = table.title ? `"${table.title}"` : `Table ${index + 1}`;
    if (tables.length >= limits.tables || table.columns.length > limits.columns) {
      warnings.push(`${name} was too large to save with this result and was omitted. Export it from the Statistical Tests workshop.`);
      return;
    }
    const fit = Math.min(table.rows.length, limits.rows, Math.floor((limits.cells - cells) / table.columns.length));
    if (fit < table.rows.length) {
      warnings.push(`${name} was saved with ${fit} of ${table.rows.length} rows. Export the complete table from the Statistical Tests workshop.`);
    }
    cells += fit * table.columns.length;
    tables.push({
      ...(table.title ? { title: table.title } : {}),
      columns: [...table.columns],
      rows: table.rows.slice(0, fit).map((row) => row.map((cell) =>
        typeof cell === "number" && !Number.isFinite(cell) ? null : cell)),
    });
  });
  return { tables, warnings };
}

/** Create the durable authority for a completed statistical test. Raw source
 * samples are deliberately excluded: the source worksheet plus its fit-time
 * fingerprint owns those, while this envelope owns the compact result tables
 * and the exact column/parameter question that produced them. */
export function statisticalTestAnalysisResult(
  id: string,
  source: Dataset | null,
  testId: StatsTestId,
  selection: TestSelection,
  params: TestParams,
  labels: string[],
  output: TestOutput,
  createdAt = new Date().toISOString(),
): AnalysisResult {
  const def = testDef(testId);
  const bounded = boundedTables(output);
  const indices = [...new Set(testColumns(testId, selection, params).filter((index) => index >= 0))];
  return {
    version: ANALYSIS_RESULT_VERSION,
    id,
    name: `${def.label}${source ? ` · ${source.name}` : ""}`,
    producer: { id: "statistical-test", label: "Statistical Test", version: 1 },
    sources: source ? [{ datasetId: source.id, role: "input" }] : [],
    outputs: [],
    ...(source ? {
      selection: {
        datasetId: source.id,
        channels: indices.map((index) => ({
          index,
          label: source.data.labels[index] ?? `channel ${index + 1}`,
          unit: source.data.units[index] ?? "",
        })),
      },
      sourceFingerprint: analysisDataFingerprint(source),
    } : {}),
    scalarValues: {
      Test: def.label,
      Interpretation: output.sentence,
      "Significance level": params.alpha,
    },
    parameters: {
      testId,
      selection: { ...selection, cols: [...selection.cols] },
      params: { ...params },
      labels: [...labels],
      ...(source ? { [INPUTS_PARAM]: recordedInputs([source], { xKey: undefined }) } : {}),
    },
    tables: bounded.tables,
    warnings: bounded.warnings,
    createdAt,
  };
}
