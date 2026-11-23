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
// a refusal with a reason instead of inputs. A lazy preview whose full load
// FAILED is a distinct refusal ("load-failed", set by useAnalysisInputs, which
// can see the load state; this module stays pure) so the line says why it will
// not clear on its own. Pure: no store, no React.

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
  /** True for a tool with no X axis at all (Multivariate, Stats tests,
   *  Distribution...): the summary line omits "X:". Does not change which rows
   *  or columns are resolved. */
  noX?: boolean;
  /** False = the lean path: skip the excluded / filtered-out recount (an
   *  O(rows) pass plus two Sets) for a caller that never prints it, such as a
   *  per-render memo. The rows, columns and refusals are identical; the result
   *  then says `countsKnown: false` and `analysisRowPolicyNote` refuses to
   *  state counts it does not have. Default true. */
  counts?: boolean;
  policy: AnalysisRowPolicy;
}

export type AnalysisInputRefusal =
  | "no-dataset" | "missing-dataset" | "pending" | "load-failed" | "missing-column" | "no-response" | "no-rows";

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
  /** False when the tool declared it has no X (the summary omits it). */
  hasX: boolean;
  yKeys: number[];
  columnSource: "tool" | "selection";
  /** Original worksheet rows behind `data`, ascending. */
  rowIds: number[];
  range: AnalysisRangeSelection | null;
  rowCount: number;
  totalRows: number;
  /** Rows the policy's base view keeps (before selected rows / range), ascending:
   *  the analysis view's rows, or every row for a "keep" policy. */
  viewRowIds: number[];
  /** False on the lean path (`counts: false`): the two counts below are 0 and
   *  mean "not computed", never "none". */
  countsKnown: boolean;
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

/** Manually excluded rows, and Data Filter rows not also excluded. */
export function rowStateCounts(dataset: Dataset): { excludedCount: number; filteredCount: number } {
  const n = dataset.data.time.length;
  const excluded = excludedSet(dataset);
  return {
    excludedCount: [...excluded].filter((row) => row >= 0 && row < n).length,
    filteredCount: [...filteredOutSet(dataset)].filter((row) => !excluded.has(row)).length,
  };
}

const allRows = (n: number): number[] => Array.from({ length: n }, (_value, index) => index);

export function resolveAnalysisInputs(request: AnalysisInputRequest): AnalysisInputs {
  const { policy } = request;
  let datasetSource: Common["datasetSource"] = request.selection ? "selection" : "active";
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
  datasetSource = selection ? "selection" : "active";
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
  const countsKnown = request.counts !== false;
  const { excludedCount, filteredCount } = countsKnown ? rowStateCounts(dataset) : { excludedCount: 0, filteredCount: 0 };
  return {
    ok: true, policy, datasetSource, dataset, data, xKey, hasX: !request.noX, yKeys, columnSource, rowIds, range,
    rowCount: rowIds.length, totalRows: n, viewRowIds: baseRows, countsKnown, excludedCount, filteredCount, rowsNarrowed: pickedRows !== null,
  };
}

/** The resolved rows as one (x, y) pair: x is the resolved X column (the
 *  time/X column when `xKey` is null), y the `yIndex`-th resolved response.
 *  Tools that read one channel against one X take their arrays from here, so
 *  the rows they analyse are exactly the resolver's `data` (never a re-read of
 *  the worksheet). */
export function analysisSeries(
  inputs: AnalysisInputsResolved, yIndex = 0,
): { x: number[]; y: number[]; yKey: number } {
  const { data, xKey, yKeys } = inputs;
  const yKey = yKeys[yIndex];
  return {
    x: xKey === null ? data.time : data.values.map((row) => row[xKey]),
    y: data.values.map((row) => row[yKey]),
    yKey,
  };
}

function withUnit(label: string, unit: string | undefined): string {
  return unit ? `${label} (${unit})` : label;
}

export function analysisColumnName(dataset: Dataset, key: number | null): string {
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
  const parts = [`${heading}: ${dataset.name}`];
  if (inputs.hasX) parts.push(`X: ${analysisColumnName(dataset, inputs.xKey)}`);
  parts.push(
    `Y: ${inputs.yKeys.map((key) => analysisColumnName(dataset, key)).join(", ")}`,
    `${inputs.rowCount.toLocaleString()} of ${inputs.totalRows.toLocaleString()} rows`,
  );
  if (inputs.range) parts.push(`X ${fmt(inputs.range.lo)}–${fmt(inputs.range.hi)}`);
  return parts.join(" · ");
}

/** The exclusion / filter / selection policy, stated in full. */
export function analysisRowPolicyNote(inputs: AnalysisInputs): string {
  const { policy } = inputs;
  // A refusal still states the worksheet's row state (except a lazy preview,
  // whose rows are not the real ones).
  const state = inputs.ok ? (inputs.countsKnown ? inputs : null) : inputs.dataset && inputs.code !== "pending" && inputs.code !== "load-failed" ? rowStateCounts(inputs.dataset) : null;
  const dropped = state ? state.excludedCount + state.filteredCount : 0;
  const rowsOf = (count: number, what: string) => `${count.toLocaleString()} ${what} row${count === 1 ? "" : "s"}`;
  const counts = !state ? "" : dropped === 0 ? " (none at present)"
    : ` (${rowsOf(state.excludedCount, "excluded")}, ${rowsOf(state.filteredCount, "filtered-out")})`;
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
