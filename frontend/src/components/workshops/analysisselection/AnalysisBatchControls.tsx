import { useMemo, useRef, useState, type ReactNode } from "react";

import { findIdenticalBatchResult } from "../../../lib/analysisBatchDedupe";
import { ANALYSIS_RESULT_VERSION, type AnalysisResult, type AnalysisResultValue } from "../../../lib/analysisResult";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { analysisSelectionData, analysisSelectionSnapshot, resolveAnalysisSelection, type AnalysisSelection, type AnalysisSelectionItem } from "../../../lib/analysisSelection";
import { INPUTS_PARAM, recordedInputs, type InputX } from "../../../lib/resultInputsRecord";
import type { DataStruct, Dataset } from "../../../lib/types";
import { registerAnalysisResult } from "../../../store/analysisResultActions";
import { nextAnalysisResultId } from "../../../store/idSeq";
import { beginOp, endOp, updateOp } from "../../../store/pendingOps";
import { analysisBatchRuntime, useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { INDEX_X, defaultNameChoice, numericMetaFields, paramNamesOf, type SummaryXChoice } from "../../../lib/batchSummaryX";
import { Button } from "../../primitives";
import { datasetsInputsToken } from "../workbench/inputsKey";
import { OutOfDateNote } from "../workbench/WorkbenchParts";
import SummaryXPicker from "./SummaryXPicker";
import { fmtInt } from "../../../lib/locale";

export interface AnalysisBatchOutcome {
  values: (string | number | null)[];
  warnings?: string[];
  /** Replaces the row count shown for this input (a tool that reads rows the shared preflight does not count). */
  rows?: number;
}

interface Props {
  toolId: string;
  label: string;
  summaryColumns: string[];
  runItem: (dataset: Dataset, selection: AnalysisSelectionItem) => Promise<AnalysisBatchOutcome>;
  /** Small, JSON-safe settings needed to interpret this tool's saved table.
   * Source arrays remain in their worksheets; this is provenance only. */
  resultParameters?: Record<string, AnalysisResultValue>;
  blockedReason?: string | null;
  /** When given, a finished run offers "Create summary worksheet", which hands
   *  the run's rows (every input, in order) and the chosen summary X (index,
   *  metadata field, user parameter or number in the name) to this tool-owned
   *  builder. */
  onSummarySheet?: (rows: readonly AnalysisBatchRow[], x: SummaryXChoice) => void;
  /** Extra controls under a finished run, given its rows (e.g. a results table for the graph). */
  afterRun?: (rows: readonly AnalysisBatchRow[], x: SummaryXChoice) => ReactNode;
  /** Open the batch table and Run button with the section (a multi-worksheet
   *  launch from a tool whose own Run is this batch). */
  defaultExpanded?: boolean;
  /** Open the section each time this changes (a header action that means "the
   *  batch": the section may be mounted already, and collapsed). */
  expandSignal?: number;
  /** What each worksheet's input is. "selection" (default): the item's
   *  plot roles, on the analysis view narrowed by its selected rows and X
   *  range. "statistics": the statistics tools' contract -- every row of the
   *  analysis view (the items' row / range / ROI narrowing is dropped from the
   *  run AND its saved provenance, so the batch reads what the single run
   *  reads) and columns read BY NAME by `runItem` (lib/statsBatchColumns), so
   *  the plot X / Y roles are not checked: every channel is kept as a
   *  candidate and preflight only refuses a worksheet that is gone, has no
   *  channel or no rows. */
  inputs?: "selection" | "statistics";
  /** Every setting the per-worksheet values depend on, as one string. When it
   *  changes, the finished table is dropped (rows run with other settings must
   *  not sit under the new ones); a run in flight finishes and is dropped
   *  when it ends. Omitted = a finished table is kept (the long-standing
   *  default). The statistics tools reset by remounting instead (StatsBatchSection). */
  settingsKey?: string;
  /** What a change of `settingsKey` does to a finished table. "drop" (default,
   *  the long-standing rule): the table is dropped. "mark": the table stays,
   *  says "Out of date" and withholds the summary worksheet and `afterRun`
   *  until the batch is run again. Either way, a change of the selected
   *  worksheets or of the data of a worksheet that ran marks the table. */
  settingsChange?: "drop" | "mark";
  /** The X column a worksheet's run actually read, when it is not the selection's own
   *  `xKey` (a tool that fits against a Y's own X). Read when the run's result is
   *  written, so a tool may report what it resolved while running. Omitted = the
   *  selection's X; `inputs="statistics"` never records an X (those tools have none). */
  xKeyOf?: (dataset: Dataset, selection: AnalysisSelectionItem) => InputX;
}

type RunStatus = "ready" | "completed" | "failed" | "cancelled";

const MAX_BATCH_INPUTS = 1_000;

export type AnalysisBatchRow = RunRow;

interface RunRow {
  datasetId: string;
  name: string;
  rows: number;
  status: RunStatus;
  values: (string | number | null)[];
  warning: string | null;
}

/** What a finished table was run with: the worksheets asked for, the data
 *  identity of those that ran, and (for "mark") the tool's settings. */
interface RanWith {
  selection: string;
  ids: string[];
  data: string;
  settings: string | undefined;
  /** A worksheet that ran changed (or was still a lazy preview) before the run ended. */
  changed: boolean;
}

/** The selected worksheets and what is read from each, independent of order. */
const selectionKey = (selection: AnalysisSelection): string =>
  JSON.stringify([...selection.items].sort((a, b) => (a.datasetId < b.datasetId ? -1 : 1)));

const dataKey = datasetsInputsToken;

const displayStatus = (status: RunStatus): string => status[0].toUpperCase() + status.slice(1);

/** The "statistics" input contract over a selection: analysis-view rows, no
 *  plot roles (every channel a candidate; the tool reads its columns by name). */
function statisticsSelection(selection: AnalysisSelection, datasets: readonly Dataset[]): AnalysisSelection {
  const width = new Map(datasets.map((dataset) => [dataset.id, dataset.data.labels.length]));
  return {
    ...selection,
    items: selection.items.map((item) => ({
      ...item, xKey: null, yKeys: Array.from({ length: width.get(item.datasetId) ?? 0 }, (_v, index) => index),
      errorBindings: [], errorKeys: {}, factorKeys: [], rowIds: null, range: null, roi: null,
    })),
  };
}

/** Shared batch shell: honest preflight first, sequential execution so cancel
 * has a deterministic boundary, and one durable result even after a partial
 * failure/cancel. Scientific algorithms remain tool-owned via runItem. */
export default function AnalysisBatchControls({
  toolId, label, summaryColumns, runItem, resultParameters, blockedReason, onSummarySheet, afterRun, defaultExpanded = false, expandSignal = 0,
  inputs = "selection", settingsKey, settingsChange = "drop", xKeyOf,
}: Props) {
  const owner = useAnalysisSelection((state) => state.toolId);
  const selection = useAnalysisSelection((state) => state.selection);
  const datasets = useApp((state) => state.datasets);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [seenSignal, setSeenSignal] = useState(expandSignal);
  if (seenSignal !== expandSignal) {
    setSeenSignal(expandSignal);
    setExpanded(true);
  }
  const [running, setRunning] = useState(false);
  const [lastRows, setLastRows] = useState<RunRow[] | null>(null);
  const [seenKey, setSeenKey] = useState(settingsKey);
  const keyRef = useRef(settingsKey);
  keyRef.current = settingsKey;
  if (seenKey !== settingsKey) {
    setSeenKey(settingsKey);
    if (!running && settingsChange === "drop") setLastRows(null);
  }
  // What the finished table was run with, for the "Out of date" marker below.
  const [ranWith, setRanWith] = useState<RanWith | null>(null);
  const [xChoice, setXChoice] = useState<SummaryXChoice>(INDEX_X);
  // Set once the user touches the X picker: a deliberate choice (even "Input
  // order") is never replaced by the default below, in this run or a later one.
  const userPickedX = useRef(false);
  const pickX = (choice: SummaryXChoice) => { userPickedX.current = true; setXChoice(choice); };
  const cancelRef = useRef(false);
  const runningRef = useRef(false);
  const owned = owner === toolId ? selection : null;
  const current = useMemo(
    () => owned && inputs === "statistics" ? statisticsSelection(owned, datasets) : owned,
    [owned, inputs, datasets],
  );
  const resolved = useMemo(
    () => current ? resolveAnalysisSelection(current, datasets) : { items: [], issues: [] },
    [current, datasets],
  );
  const ranInputs = useMemo(() => {
    const ids = new Set((lastRows ?? []).map((r) => r.datasetId));
    return datasets.filter((d) => ids.has(d.id));
  }, [lastRows, datasets]);
  const xFields = useMemo(() => numericMetaFields(ranInputs), [ranInputs]);
  const xParams = useMemo(() => paramNamesOf(ranInputs), [ranInputs]);
  const selectionNow = useMemo(() => (current ? selectionKey(current) : ""), [current]);
  // Out of date: the worksheets asked for, the data of one that ran, or (in
  // "mark" mode) the tool's settings differ from what the table was run with.
  const stale = lastRows !== null && ranWith !== null && !running && (
    ranWith.changed || ranWith.selection !== selectionNow || ranWith.data !== dataKey(ranWith.ids, datasets) ||
    (settingsChange === "mark" && ranWith.settings !== settingsKey)
  );
  if (!current || current.items.length === 0) return null;

  const issuesById = new Map<string, string[]>();
  for (const issue of resolved.issues) {
    issuesById.set(issue.datasetId, [...(issuesById.get(issue.datasetId) ?? []), issue.message]);
  }
  const errorById = new Map(resolved.issues.filter((issue) => issue.severity === "error").map((issue) => [issue.datasetId, issue.message]));
  const readyById = new Map(resolved.items.map((item) => [item.selection.datasetId, item]));
  const exceedsBatchLimit = current.items.length > MAX_BATCH_INPUTS;
  const blocked = errorById.size > 0 || resolved.items.length === 0 || exceedsBatchLimit || !!blockedReason;

  const runBatch = async (): Promise<void> => {
    if (runningRef.current || blocked) return;
    const snapshot = structuredClone(current);
    // Library order, not selection order (which puts the active sheet first):
    // the table and any summary then read in the order the samples are listed.
    const libraryIds = analysisBatchRuntime().datasets.map((d) => d.id);
    snapshot.items.sort((a, b) => libraryIds.indexOf(a.datasetId) - libraryIds.indexOf(b.datasetId));
    const start = resolveAnalysisSelection(snapshot, analysisBatchRuntime().datasets);
    if (start.issues.some((issue) => issue.severity === "error") || start.items.length === 0) return;
    const keyAtStart = settingsKey;
    cancelRef.current = false;
    runningRef.current = true;
    setRunning(true);
    const warnings: string[] = [];
    const runFingerprints = new Map<string, string>();
    const ranOn = new Map<string, { dataset: Dataset; view: DataStruct; item: AnalysisSelectionItem }>();
    let changedAtEnd = true; // a run that did not reach its end is not current
    const rows: RunRow[] = start.items.map(({ dataset, rowCount }) => {
      const selectionWarnings = start.issues
        .filter((issue) => issue.datasetId === dataset.id && issue.severity === "warning")
        .map((issue) => issue.message);
      warnings.push(...selectionWarnings.map((warning) => `${dataset.name}: ${warning}`));
      return {
        datasetId: dataset.id, name: dataset.name, rows: rowCount, status: "ready" as const, values: [],
        warning: selectionWarnings.length ? selectionWarnings.join(" ") : null,
      };
    });
    setLastRows(rows.map((row) => ({ ...row })));
    const opId = beginOp(`${label}: 0/${rows.length}`, () => { cancelRef.current = true; });
    try {
      for (let index = 0; index < start.items.length; index++) {
        if (cancelRef.current) {
          for (let rest = index; rest < rows.length; rest++) rows[rest].status = "cancelled";
          break;
        }
        updateOp(opId, `${label}: ${index + 1}/${rows.length}`);
        const selected = start.items[index];
        try {
          const live = await analysisBatchRuntime().resolveDataset(selected.dataset.id);
          if (!live) throw new Error("The full worksheet could not be loaded.");
          // Capture what this row actually ran on. A later worksheet must not
          // let an earlier, edited input inherit an end-of-batch fingerprint.
          runFingerprints.set(live.id, analysisDataFingerprint(live));
          // The rows the selection actually handed the tool (its row ids / range), not the whole view.
          ranOn.set(live.id, { dataset: live, view: analysisSelectionData(live, selected.selection), item: selected.selection });
          const outcome = await runItem(live, selected.selection);
          rows[index].status = "completed";
          rows[index].values = outcome.values;
          if (outcome.rows !== undefined) rows[index].rows = outcome.rows;
          const outcomeWarning = outcome.warnings?.join(" ") ?? null;
          rows[index].warning = [rows[index].warning, outcomeWarning].filter(Boolean).join(" ") || null;
          warnings.push(...(outcome.warnings ?? []).map((warning) => `${live.name}: ${warning}`));
        } catch (error) {
          const message = error instanceof Error ? error.message : `${label} failed`;
          rows[index].status = "failed";
          rows[index].warning = [rows[index].warning, message].filter(Boolean).join(" ");
          warnings.push(`${selected.dataset.name}: ${message}`);
        }
        setLastRows(rows.map((row) => ({ ...row })));
      }
      const cancelled = rows.filter((row) => row.status === "cancelled").length;
      if (cancelled) warnings.unshift(`Batch cancelled: ${cancelled} of ${rows.length} inputs were not started.`);
      const executedIds = snapshot.items
        .map((item) => item.datasetId)
        .filter((id) => runFingerprints.has(id));
      const sourceFingerprint = executedIds.length
        ? executedIds.map((id) => runFingerprints.get(id)!).join(":")
        : undefined;
      const liveDatasets = analysisBatchRuntime().datasets;
      const changedDuringRun = executedIds.some((id) => {
        const live = liveDatasets.find((dataset) => dataset.id === id);
        return !live || !!live.pending || analysisDataFingerprint(live) !== runFingerprints.get(id);
      });
      changedAtEnd = changedDuringRun;
      const result: AnalysisResult = {
        version: ANALYSIS_RESULT_VERSION,
        id: nextAnalysisResultId(),
        name: `${label} — ${new Date().toLocaleString()}`,
        producer: { id: "analysis-batch", label, version: 1 },
        // Unstarted cancelled inputs are status rows, not scientific sources.
        // Excluding them keeps a pending preview from making an otherwise
        // valid partial result permanently out of date.
        sources: executedIds.map((datasetId) => ({ datasetId, role: "input" as const })),
        outputs: [],
        parameters: {
          ...resultParameters,
          toolId,
          selection: analysisSelectionSnapshot(snapshot) as unknown as AnalysisResultValue,
          [INPUTS_PARAM]: recordedInputs(executedIds.map((id) => ranOn.get(id)!.dataset), {
            xKey: executedIds.map((id) => {
              // The statistics tools read columns by name and have no X of their own.
              if (inputs === "statistics") return undefined;
              const ran = ranOn.get(id)!;
              return xKeyOf ? xKeyOf(ran.dataset, ran.item) : ran.item.xKey;
            }), views: executedIds.map((id) => ranOn.get(id)!.view),
          }),
        },
        tables: [{
          title: "Batch status",
          columns: ["Worksheet", "Status", "Rows", ...summaryColumns, "Warnings"],
          rows: rows.map((row) => [
            row.name, displayStatus(row.status), row.rows,
            ...summaryColumns.map((_column, index) => row.values[index] ?? null), row.warning,
          ]),
        }],
        warnings: [...new Set(warnings)],
        createdAt: new Date().toISOString(),
        ...(sourceFingerprint ? { sourceFingerprint } : {}),
        ...(!sourceFingerprint || changedDuringRun ? { stale: true as const } : {}),
      };
      // An identical re-run (same data, settings, tables) is not saved twice.
      const twin = findIdenticalBatchResult(analysisBatchRuntime().analysisResults, result);
      if (!twin) {
        analysisBatchRuntime().recordHistory(`run ${label.toLowerCase()}`);
        registerAnalysisResult(result);
      }
      // The run's outcome in the status line (it used to end silently: the
      // table below showed "Completed" but nothing said where the numbers went).
      const completed = rows.filter((row) => row.status === "completed").length;
      analysisBatchRuntime().setStatus(
        `${label} batch finished: ${completed} of ${rows.length} worksheet${rows.length === 1 ? "" : "s"} completed — the results are in the Library${twin ? " (identical to the saved result; nothing was duplicated)" : ""}`,
      );
    } finally {
      endOp(opId);
      runningRef.current = false;
      setRunning(false);
      // Settings changed mid-run: this table belongs to the old ones (dropped,
      // or kept and marked out of date).
      const keep = settingsChange === "mark" || keyRef.current === keyAtStart;
      setLastRows(keep ? rows.map((row) => ({ ...row })) : null);
      const ranIds = [...runFingerprints.keys()];
      setRanWith({
        selection: selectionKey(snapshot), ids: ranIds, settings: keyAtStart,
        data: dataKey(ranIds, analysisBatchRuntime().datasets), changed: changedAtEnd,
      });
      // "010K, 050K, …": plot against the number in the name, sorted, when
      // that is a trend (defaultNameChoice) and the user has not chosen an X.
      if (!userPickedX.current) setXChoice(defaultNameChoice(rows.map((r) => ({ name: r.name }))) ?? INDEX_X);
    }
  };

  const displayRows = lastRows ?? [...current.items].sort(
    (a, b) => datasets.findIndex((d) => d.id === a.datasetId) - datasets.findIndex((d) => d.id === b.datasetId),
  ).map((item) => {
    const found = readyById.get(item.datasetId);
    const dataset = datasets.find((entry) => entry.id === item.datasetId);
    return {
      datasetId: item.datasetId,
      name: dataset?.name ?? item.datasetId,
      rows: found?.rowCount ?? 0,
      status: errorById.has(item.datasetId) ? "failed" as const : "ready" as const,
      values: [], warning: issuesById.get(item.datasetId)?.join(" ") ?? null,
    };
  });

  return <section className="qzk-analysis-batch" aria-label={`${label} batch`}>
    <button type="button" className="qzk-analysis-input-review-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      <span><strong>Batch</strong> · {current.items.length} worksheet{current.items.length === 1 ? "" : "s"}</span>
      <span>{expanded ? "▾" : "▸"}</span>
    </button>
    {expanded && <div className="qzk-analysis-input-review-body">
      {stale && <OutOfDateNote block>
        the worksheets, their data or the settings changed since this run. Run the batch again before using its summary.
      </OutOfDateNote>}
      <table className="qzk-analysis-batch-table">
        <thead><tr><th>Worksheet</th><th>Rows</th><th>Status</th><th>Warning</th></tr></thead>
        <tbody>{displayRows.map((row) => <tr key={row.datasetId}>
          <td>{row.name}</td><td>{row.rows}</td><td>{displayStatus(row.status)}</td><td>{row.warning ?? "—"}</td>
        </tr>)}</tbody>
      </table>
      <div className="qzk-analysis-input-review-actions">
        <span>{exceedsBatchLimit
          ? `Select ${fmtInt(MAX_BATCH_INPUTS)} or fewer worksheets for one batch.`
          : errorById.size > 0 || resolved.items.length === 0
            ? "Fix blocked inputs above before running."
          : blockedReason ? "Fix the configuration issue above before running."
            : "Cancel finishes the current worksheet, then marks the remaining inputs Cancelled."}</span>
        <Button variant="primary" size="sm" disabled={blocked || running} onClick={() => void runBatch()}>
          {running ? "Running…" : `Run ${label} batch`}
        </Button>
        {onSummarySheet && lastRows && !running && !stale && lastRows.some((row) => row.status === "completed") && (<>
          <SummaryXPicker choice={xChoice} onChange={pickX} metaFields={xFields} params={xParams} />
          <Button size="sm" onClick={() => onSummarySheet(lastRows, xChoice)} title="A worksheet with one row per input and a column per parameter and statistic, ready to plot">
            Create summary worksheet
          </Button>
        </>)}
      </div>
      {afterRun && lastRows && !running && !stale && lastRows.some((row) => row.status === "completed") && afterRun(lastRows, xChoice)}
    </div>}
  </section>;
}
