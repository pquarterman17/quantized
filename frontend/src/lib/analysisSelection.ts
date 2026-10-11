import { errKeysFromBindings, type ErrorBinding } from "./errorRoles";
import { effectiveChannels } from "./plotdata";
import { analysisView } from "./rowstate";
import { sliceDataStruct } from "./datasetsplit";
import { columnMetaList } from "./columnmeta";
import { channelModelingType, isCategorical } from "./modeling";
import type { RoiRect, RoiRuler, RoiSector } from "./roi";
import type { Dataset, DataStruct } from "./types";
import { ANALYSIS_SELECTION_VERSION } from "./analysisSelectionVersion";

export { ANALYSIS_SELECTION_VERSION } from "./analysisSelectionVersion";

export type AnalysisSelectionSource =
  | "analysis-center"
  | "library"
  | "plot"
  | "worksheet"
  | "result-rerun"
  | "tool-default";

export interface AnalysisRangeSelection {
  lo: number;
  hi: number;
  source: "gadget region" | "integration region" | "selected rows" | "manual";
}

export type AnalysisRoiSelection =
  | { kind: "rect"; value: RoiRect }
  | { kind: "ruler"; value: RoiRuler }
  | { kind: "sector"; value: RoiSector };

/** One dataset's exact analysis roles. Column -1 is represented as xKey=null;
 * every other column is a zero-based value-channel index. Row ids always
 * refer to the original worksheet, never a filtered-array position. */
export interface AnalysisSelectionItem {
  datasetId: string;
  xKey: number | null;
  yKeys: number[];
  /** Full error-role authority, including X and asymmetric +/- bindings. */
  errorBindings: ErrorBinding[];
  /** Compatibility projection used by algorithms that accept one symmetric Y sigma. */
  errorKeys: Record<number, number>;
  factorKeys: number[];
  /** null means every row in the dataset's current analysis view. */
  rowIds: number[] | null;
  range: AnalysisRangeSelection | null;
  roi: AnalysisRoiSelection | null;
}

export interface AnalysisSelection {
  version: typeof ANALYSIS_SELECTION_VERSION;
  source: AnalysisSelectionSource;
  createdAt: string;
  items: AnalysisSelectionItem[];
}

export interface AnalysisSelectionCapture {
  datasets: readonly Dataset[];
  activeId: string | null;
  selectedIds: readonly string[];
  xKey: number | null;
  yKeys: readonly number[] | null;
  seriesOrder: readonly number[] | null;
  errKeys: Readonly<Record<number, number>>;
  selection: { datasetId: string; rows: readonly number[] } | null;
  range: AnalysisRangeSelection | null;
  mapRoi?: RoiRect | null;
  mapRuler?: RoiRuler | null;
  mapSector?: RoiSector | null;
}

export interface AnalysisSelectionIssue {
  datasetId: string;
  severity: "error" | "warning";
  message: string;
}

export interface AnalysisSelectionResolvedItem {
  selection: AnalysisSelectionItem;
  dataset: Dataset;
  rowCount: number;
}

function rowRuns(rows: readonly number[]): string {
  if (!rows.length) return "";
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = sorted[0];
  let end = start;
  for (let index = 1; index < sorted.length; index++) {
    const row = sorted[index];
    if (row === end + 1) end = row;
    else {
      runs.push(start === end ? String(start) : `${start}-${end}`);
      start = end = row;
    }
  }
  runs.push(start === end ? String(start) : `${start}-${end}`);
  return runs.join(",");
}

/** JSON-safe durable provenance for an AnalysisResult. Row ids are run-length
 * encoded so a 100k-row worksheet cannot exceed the result sanitizer's 10k
 * array-node limit while still retaining the exact original-row contract. */
export function analysisSelectionSnapshot(selection: AnalysisSelection) {
  return {
    ...selection,
    rowEncoding: "ranges-v1" as const,
    items: selection.items.map(({ rowIds, ...item }) => ({
      ...item,
      rowRuns: rowIds === null ? null : rowRuns(rowIds),
    })),
  };
}

function liveColumn(index: number, width: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < width;
}

function cleanColumns(columns: readonly number[], width: number): number[] {
  return [...new Set(columns)].filter((index) => liveColumn(index, width));
}

function rowsFor(dataset: Dataset, selected: AnalysisSelectionCapture["selection"]): number[] | null {
  if (selected?.datasetId !== dataset.id || selected.rows.length === 0) return null;
  const live = new Set(analysisView(dataset).rowIds ?? dataset.data.time.map((_value, index) => index));
  const rows = [...new Set(selected.rows)]
    .filter((row) => Number.isInteger(row) && row >= 0 && row < dataset.data.time.length && live.has(row))
    .sort((a, b) => a - b);
  // Preserve an explicitly empty intersection. Converting it to null would
  // silently change “analyze these selected rows” into “analyze every row.”
  return rows;
}

function itemFor(dataset: Dataset, capture: AnalysisSelectionCapture, primary: boolean): AnalysisSelectionItem {
  const width = dataset.data.labels.length;
  const designatedX = columnMetaList(dataset.data).findIndex((column) => column?.designation === "X");
  const xKey = primary
    ? capture.xKey != null && liveColumn(capture.xKey, width) ? capture.xKey : null
    : designatedX >= 0 ? designatedX : null;
  const requestedY = primary ? capture.yKeys : null;
  const yKeys = effectiveChannels(
    dataset.data,
    requestedY ? [...requestedY] : null,
    xKey,
    dataset.channelRoles,
    primary && capture.seriesOrder ? [...capture.seriesOrder] : null,
  );
  const inferredErrors = errKeysFromBindings(dataset.errorRoles ?? []);
  const errors = primary ? { ...inferredErrors, ...capture.errKeys } : inferredErrors;
  const errorKeys = Object.fromEntries(
    Object.entries(errors)
      .map(([target, error]) => [Number(target), error] as const)
      .filter(([target, error]) => yKeys.includes(target) && liveColumn(error, width)),
  );
  const roi = primary
    ? capture.mapRoi
      ? { kind: "rect" as const, value: { ...capture.mapRoi } }
      : capture.mapRuler
        ? { kind: "ruler" as const, value: { ...capture.mapRuler } }
        : capture.mapSector
          ? { kind: "sector" as const, value: { ...capture.mapSector } }
          : null
    : null;
  const errorBindings = (dataset.errorRoles ?? []).filter((binding) =>
    liveColumn(binding.channel, width) &&
    (binding.target === -1 || liveColumn(binding.target, width)),
  ).map((binding) => ({ ...binding }));
  if (primary) {
    for (const [targetText, channel] of Object.entries(capture.errKeys)) {
      const target = Number(targetText);
      if (!liveColumn(target, width) || !liveColumn(channel, width)) continue;
      if (!errorBindings.some((binding) =>
        binding.channel === channel && binding.target === target && binding.axis === "y" && binding.side === "both")) {
        errorBindings.push({ channel, target, axis: "y", side: "both" });
      }
    }
  }
  return {
    datasetId: dataset.id,
    xKey,
    yKeys: cleanColumns(yKeys, width),
    errorBindings,
    errorKeys,
    // A categorical column is a candidate, not an instruction to partition.
    // Only a worksheet handoff or the explicit Review-inputs picker sets this.
    factorKeys: [],
    rowIds: primary ? rowsFor(dataset, capture.selection) : null,
    range: primary && capture.range ? { ...capture.range } : null,
    roi,
  };
}

/** Capture Library multi-selection when it exists; otherwise capture the
 * active worksheet. The active worksheet is first so single-tool launches
 * retain the visible plot's X/Y/error/range choices. */
export function captureAnalysisSelection(
  capture: AnalysisSelectionCapture,
  source: AnalysisSelectionSource,
  createdAt = new Date().toISOString(),
): AnalysisSelection {
  const live = new Map(capture.datasets.map((dataset) => [dataset.id, dataset]));
  const chosen = capture.selectedIds.length > 0
    ? [...new Set(capture.selectedIds)].filter((id) => live.has(id))
    : capture.activeId && live.has(capture.activeId) ? [capture.activeId] : [];
  if (capture.activeId && chosen.includes(capture.activeId)) {
    chosen.splice(chosen.indexOf(capture.activeId), 1);
    chosen.unshift(capture.activeId);
  }
  return {
    version: ANALYSIS_SELECTION_VERSION,
    source,
    createdAt,
    items: chosen.map((id) => itemFor(live.get(id)!, capture, id === capture.activeId)),
  };
}

/** Validate just before execution. Dataset ids are stable, while names and
 * column labels are intentionally resolved live so a harmless rename does not
 * invalidate a scientific selection. */
export function resolveAnalysisSelection(
  selection: AnalysisSelection,
  datasets: readonly Dataset[],
): { items: AnalysisSelectionResolvedItem[]; issues: AnalysisSelectionIssue[] } {
  if ((selection as { version: unknown }).version !== ANALYSIS_SELECTION_VERSION) {
    return {
      items: [],
      issues: selection.items.map((item) => ({
        datasetId: item.datasetId,
        severity: "error" as const,
        message: "This analysis selection was saved by an unsupported version.",
      })),
    };
  }
  const live = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  const items: AnalysisSelectionResolvedItem[] = [];
  const issues: AnalysisSelectionIssue[] = [];
  for (const selected of selection.items) {
    const dataset = live.get(selected.datasetId);
    if (!dataset) {
      issues.push({ datasetId: selected.datasetId, severity: "error", message: "The selected worksheet is no longer available." });
      continue;
    }
    const width = dataset.data.labels.length;
    if (selected.xKey != null && !liveColumn(selected.xKey, width)) {
      issues.push({ datasetId: dataset.id, severity: "error", message: "The selected X column no longer exists." });
      continue;
    }
    const yKeys = cleanColumns(selected.yKeys, width);
    if (yKeys.length === 0) {
      issues.push({ datasetId: dataset.id, severity: "error", message: "No selected response column is still available." });
      continue;
    }
    if (yKeys.length !== selected.yKeys.length) {
      issues.push({ datasetId: dataset.id, severity: "warning", message: "One or more selected response columns no longer exist and were omitted." });
    }
    const analysisRows = analysisView(dataset).rowIds ?? dataset.data.time.map((_value, index) => index);
    const liveRows = new Set(analysisRows);
    const rowIds = selected.rowIds === null
      ? null
      : [...new Set(selected.rowIds)].filter((row) => liveRows.has(row)).sort((a, b) => a - b);
    if (rowIds !== null && selected.rowIds !== null && rowIds.length !== selected.rowIds.length) {
      issues.push({ datasetId: dataset.id, severity: "warning", message: "Rows that are now filtered, excluded, or missing were omitted." });
    }
    if (rowIds !== null && rowIds.length === 0) {
      issues.push({ datasetId: dataset.id, severity: "error", message: "No selected rows remain in the analysis view." });
      continue;
    }
    const errorKeys = Object.fromEntries(
      Object.entries(selected.errorKeys)
        .map(([target, error]) => [Number(target), error] as const)
        .filter(([target, error]) => yKeys.includes(target) && liveColumn(error, width)),
    );
    const factorKeys = cleanColumns(selected.factorKeys, width);
    if (factorKeys.length !== selected.factorKeys.length) {
      issues.push({ datasetId: dataset.id, severity: "error", message: "The selected Run by column no longer exists." });
      continue;
    }
    if (factorKeys.some((key) => !isCategorical(channelModelingType(dataset, key)))) {
      issues.push({ datasetId: dataset.id, severity: "error", message: "The selected Run by column is no longer categorical." });
      continue;
    }
    const normalized: AnalysisSelectionItem = {
      ...selected,
      yKeys,
      errorBindings: selected.errorBindings.filter((binding) =>
        liveColumn(binding.channel, width) &&
        (binding.target === -1 || liveColumn(binding.target, width))),
      errorKeys,
      factorKeys,
      rowIds,
    };
    const rowCount = dataset.pending && normalized.rowIds === null && normalized.range === null
      ? dataset.pending.rows
      : analysisSelectionData(dataset, normalized).time.length;
    if (rowCount === 0) {
      issues.push({ datasetId: dataset.id, severity: "error", message: "No rows remain inside the selected range." });
      continue;
    }
    if (dataset.pending) {
      issues.push({
        datasetId: dataset.id,
        severity: "warning",
        message: "The full Origin worksheet will be loaded before analysis; its preview is not used for the calculation.",
      });
    }
    items.push({ selection: normalized, dataset, rowCount });
  }
  return { items, issues };
}

export function updateAnalysisSelectionItem(
  selection: AnalysisSelection,
  datasetId: string,
  patch: Partial<Omit<AnalysisSelectionItem, "datasetId">>,
): AnalysisSelection {
  return {
    ...selection,
    items: selection.items.map((item) => item.datasetId === datasetId ? { ...item, ...patch } : item),
  };
}

export function removeAnalysisSelectionItem(selection: AnalysisSelection, datasetId: string): AnalysisSelection {
  return { ...selection, items: selection.items.filter((item) => item.datasetId !== datasetId) };
}

/** Exact row/range view described by a selection item, retaining categorical
 * metadata and row-indexed sidecars for factor/By analyses. */
export function analysisSelectionData(dataset: Dataset, item: AnalysisSelectionItem): DataStruct {
  const view = analysisView(dataset);
  const data = view.data ?? dataset.data;
  if (item.rowIds === null && item.range === null) return data;
  const originalRows = view.rowIds ?? data.time.map((_value, index) => index);
  const selectedRows = item.rowIds === null ? null : new Set(item.rowIds);
  const x = item.xKey === null ? data.time : data.values.map((row) => row[item.xKey!]);
  const keep: number[] = [];
  for (let index = 0; index < originalRows.length; index++) {
    if (selectedRows && !selectedRows.has(originalRows[index])) continue;
    if (item.range && (!Number.isFinite(x[index]) || x[index] < item.range.lo || x[index] > item.range.hi)) continue;
    keep.push(index);
  }
  return sliceDataStruct(data, keep);
}
