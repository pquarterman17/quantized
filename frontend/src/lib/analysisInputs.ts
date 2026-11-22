// One input contract for single-run analysis tools (ANALYSIS_CAPABILITY_ROADMAP,
// "Selection semantics differ by tool"). Tools used to answer "which rows of
// which worksheet, against which columns?" each in their own way; this module
// answers it once and says the answer in one line.
//
// PRECEDENCE (one rule, every tool):
//   dataset  = the tool's shared AnalysisSelection item (an Analysis Center,
//              worksheet or rerun handoff, or the live plot capture) when the
//              tool consumes one, else the active worksheet. A handoff that
//              names a deleted worksheet REFUSES; it never falls back to
//              whatever happens to be active. Only the live plot capture
//              ("tool-default", re-seeded on the next render) follows the
//              active worksheet, because that is what it captures.
//   columns  = an explicit in-tool pick, else the selection item's roles.
//   rows     = the row policy's base (analysis view, or the full worksheet),
//              then narrowed by the selection's explicit rows and X range
//              when the policy says so.
//
// ROW POLICY is explicit per tool and always printed in the summary, so tools
// that disagree today (Signal Processing keeps excluded rows; the statistics
// tools drop them; Curve fit also narrows to selected rows and the fit range)
// keep their behaviour and say so instead of silently converging.
//
// Fail closed: no worksheet, a deleted worksheet or column, no response
// column, an empty explicit row selection, zero remaining rows, or a lazy
// Origin preview (its rows are a downsample, never the real data) each return
// a refusal with a reason instead of inputs. Pure: no store, no React.

import type { AnalysisRangeSelection, AnalysisSelectionItem } from "./analysisSelection";
import { sliceDataStruct } from "./datasetsplit";
import { magXAxis } from "./magDataKind";
import { analysisView, excludedSet, filteredOutSet } from "./rowstate";
import { xUnitOf } from "./transformResample";
import type { Dataset, DataStruct } from "./types";

export interface AnalysisRowPolicy {
  /** "drop": manual exclusions and Data Filter rows are left out (the analysis
   *  view). "keep": every worksheet row is used. */
  exclusions: "drop" | "keep";
  /** "narrow": the selection's explicit rows restrict the input. "ignore": the
   *  tool does not read the row selection (it may write it, e.g. brushing). */
  selectedRows: "narrow" | "ignore";
  /** "narrow": the selection's X range restricts the input. */
  range: "narrow" | "ignore";
}

export const ROW_POLICY = {
  /** Statistics tools: the analysis view, nothing else. */
  analysisView: { exclusions: "drop", selectedRows: "ignore", range: "ignore" },
  /** Plot-driven tools (Curve fit, Peaks, batch runs): the analysis view, then
   *  the selected rows and the X range. */
  selection: { exclusions: "drop", selectedRows: "narrow", range: "narrow" },
  /** Signal Processing: every row of the worksheet. */
  fullWorksheet: { exclusions: "keep", selectedRows: "ignore", range: "ignore" },
} as const satisfies Record<string, AnalysisRowPolicy>;

export interface AnalysisInputRequest {
  datasets: readonly Dataset[];
  activeId: string | null;
  /** The tool's shared-selection item, when the tool consumes one. */
  selection?: AnalysisSelectionItem | null;
  /** True when `selection` is the live plot capture ("tool-default"): a
   *  missing worksheet then means "re-seeding", so the active one is used. */
  followActive?: boolean;
  /** Explicit in-tool X pick (null = the X/time column). Undefined = no pick. */
  xKey?: number | null;
  /** Explicit in-tool response picks (-1 = the X/time column). Undefined = no pick. */
  yKeys?: readonly number[];
  policy: AnalysisRowPolicy;
}

export type AnalysisInputRefusal =
  | "no-dataset" | "missing-dataset" | "pending" | "missing-column" | "no-response" | "no-rows";

interface Common {
  policy: AnalysisRowPolicy;
  /** Where the dataset came from under the precedence rule. */
  datasetSource: "selection" | "active";
}

export interface AnalysisInputsResolved extends Common {
  ok: true;
  dataset: Dataset;
  /** The exact rows the tool analyses (same reference as analysisData when
   *  the policy is the plain analysis view). */
  data: DataStruct;
  xKey: number | null;
  yKeys: number[];
  columnSource: "tool" | "selection";
  /** Original worksheet rows behind `data`, ascending. */
  rowIds: number[];
  range: AnalysisRangeSelection | null;
  rowCount: number;
  totalRows: number;
  excludedCount: number;
  /** Rows dropped by the Data Filter that are not also manually excluded. */
  filteredCount: number;
  /** True when explicit selected rows narrowed the input. */
  rowsNarrowed: boolean;
}

export interface AnalysisInputsRefused extends Common {
  ok: false;
  code: AnalysisInputRefusal;
  reason: string;
  dataset: Dataset | null;
}

export type AnalysisInputs = AnalysisInputsResolved | AnalysisInputsRefused;

/** The precedence rule's dataset half, shared with tools whose data path is
 *  not yet resolver-driven: a selection item wins (a deleted handoff worksheet
 *  -> null, never the active one); without one, the active worksheet. */
export function analysisTargetDataset(
  datasets: readonly Dataset[],
  activeId: string | null,
  selection: AnalysisSelectionItem | null | undefined,
  followActive = false,
): Dataset | null {
  const find = (id: string | null) => id == null ? null : datasets.find((dataset) => dataset.id === id) ?? null;
  if (!selection) return find(activeId);
  return find(selection.datasetId) ?? (followActive ? find(activeId) : null);
}

const allRows = (n: number): number[] => Array.from({ length: n }, (_value, index) => index);

export function resolveAnalysisInputs(request: AnalysisInputRequest): AnalysisInputs {
  const { policy } = request;
  const datasetSource = request.selection ? "selection" : "active";
  const refuse = (code: AnalysisInputRefusal, reason: string, dataset: Dataset | null = null): AnalysisInputsRefused =>
    ({ ok: false, code, reason, dataset, policy, datasetSource });
  const dataset = analysisTargetDataset(request.datasets, request.activeId, request.selection, request.followActive);
  if (!dataset) {
    return request.selection
      ? refuse("missing-dataset", "The selected worksheet is no longer available.")
      : refuse("no-dataset", "No worksheet is selected.");
  }
  // A followed-active fallback must not apply another worksheet's roles/rows.
  const selection = request.selection && request.selection.datasetId === dataset.id ? request.selection : null;
  if (dataset.pending) {
    return refuse("pending", "The full worksheet is still loading; its preview rows are not analysed.", dataset);
  }
  const width = dataset.data.labels.length;
  const live = (column: number) => Number.isInteger(column) && column >= -1 && column < width;
  const columnSource = request.yKeys !== undefined || request.xKey !== undefined ? "tool" : "selection";
  const rawX = request.xKey !== undefined ? request.xKey : selection?.xKey ?? null;
  const xKey = rawX === -1 ? null : rawX;
  const yKeys = [...(request.yKeys ?? selection?.yKeys ?? [])];
  if (xKey !== null && !live(xKey)) return refuse("missing-column", "The selected X column no longer exists.", dataset);
  if (yKeys.length === 0) return refuse("no-response", "No response column is selected.", dataset);
  if (yKeys.some((key) => !live(key))) return refuse("missing-column", "A selected response column no longer exists.", dataset);

  const n = dataset.data.time.length;
  const view = policy.exclusions === "drop" ? analysisView(dataset) : { data: dataset.data, rowIds: null };
  const baseData = view.data ?? dataset.data;
  const baseRows = view.rowIds ?? allRows(n);
  const pickedRows = policy.selectedRows === "narrow" ? selection?.rowIds ?? null : null;
  if (pickedRows !== null && pickedRows.length === 0) {
    return refuse("no-rows", "The row selection is empty, so there is nothing to analyse.", dataset);
  }
  const range = policy.range === "narrow" ? selection?.range ?? null : null;
  let data = baseData;
  let rowIds = baseRows;
  if (pickedRows !== null || range !== null) {
    const wanted = pickedRows === null ? null : new Set(pickedRows);
    const x = xKey === null ? baseData.time : baseData.values.map((row) => row[xKey]);
    const keep: number[] = [];
    baseRows.forEach((row, index) => {
      if (wanted && !wanted.has(row)) return;
      if (range && (!Number.isFinite(x[index]) || x[index] < range.lo || x[index] > range.hi)) return;
      keep.push(index);
    });
    data = sliceDataStruct(baseData, keep);
    rowIds = keep.map((index) => baseRows[index]);
  }
  if (rowIds.length === 0) return refuse("no-rows", "No rows remain after exclusions, filters, selected rows and range.", dataset);
  const excluded = excludedSet(dataset);
  const excludedCount = [...excluded].filter((row) => row >= 0 && row < n).length;
  const filteredCount = [...filteredOutSet(dataset)].filter((row) => !excluded.has(row)).length;
  return {
    ok: true, policy, datasetSource, dataset, data, xKey, yKeys, columnSource, rowIds, range,
    rowCount: rowIds.length, totalRows: n, excludedCount, filteredCount, rowsNarrowed: pickedRows !== null,
  };
}

function withUnit(label: string, unit: string | undefined): string {
  return unit ? `${label} (${unit})` : label;
}

function columnName(dataset: Dataset, key: number | null): string {
  if (key === null || key < 0) {
    const axis = magXAxis(dataset.data, null);
    const metaLabel = typeof dataset.data.metadata.xLabel === "string" ? dataset.data.metadata.xLabel : "";
    return withUnit(axis.label.trim() || metaLabel.trim() || "X", xUnitOf(dataset.data) || axis.unit.trim());
  }
  return withUnit(dataset.data.labels[key] || `Column ${key + 1}`, dataset.data.units[key]);
}

const fmt = (value: number) => Number(value.toPrecision(5)).toString();

/** "Input: <sheet> · X: … · Y: … · N of M rows · X 1–5", or the refusal. */
export function analysisInputSummary(inputs: AnalysisInputs, heading = "Input"): string {
  if (!inputs.ok) return `${heading}: ${inputs.dataset?.name ?? "none"} · ${inputs.reason}`;
  const { dataset } = inputs;
  const parts = [
    `${heading}: ${dataset.name}`,
    `X: ${columnName(dataset, inputs.xKey)}`,
    `Y: ${inputs.yKeys.map((key) => columnName(dataset, key)).join(", ")}`,
    `${inputs.rowCount.toLocaleString()} of ${inputs.totalRows.toLocaleString()} rows`,
  ];
  if (inputs.range) parts.push(`X ${fmt(inputs.range.lo)}–${fmt(inputs.range.hi)}`);
  return parts.join(" · ");
}

/** The exclusion / filter / selection policy, stated in full. */
export function analysisRowPolicyNote(inputs: AnalysisInputs): string {
  const { policy } = inputs;
  const dropped = inputs.ok ? inputs.excludedCount + inputs.filteredCount : 0;
  const rowsOf = (count: number, what: string) => `${count.toLocaleString()} ${what} row${count === 1 ? "" : "s"}`;
  const counts = !inputs.ok ? "" : dropped === 0 ? " (none at present)"
    : ` (${rowsOf(inputs.excludedCount, "excluded")}, ${rowsOf(inputs.filteredCount, "filtered-out")})`;
  const rows = policy.exclusions === "drop"
    ? `Excluded and filtered-out rows are left out${counts}.`
    : dropped > 0 ? `Uses every row, including ${rowsOf(dropped, "excluded or filtered-out")}.`
      : "Uses every row; exclusions and filters are not applied.";
  const selection = policy.selectedRows === "narrow"
    ? inputs.ok && inputs.rowsNarrowed ? " Only the selected rows are used." : " Selected rows narrow the input when present."
    : " Selected rows are not used.";
  const range = policy.range === "narrow" ? inputs.ok && inputs.range ? " Limited to the X range." : "" : " The plot X range is not applied.";
  return `${rows}${selection}${range}`;
}
