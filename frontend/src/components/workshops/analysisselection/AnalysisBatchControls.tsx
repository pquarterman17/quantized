import { useMemo, useRef, useState } from "react";

import { ANALYSIS_RESULT_VERSION, type AnalysisResultValue } from "../../../lib/analysisResult";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { analysisSelectionSnapshot, resolveAnalysisSelection, type AnalysisSelectionItem } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { registerAnalysisResult } from "../../../store/analysisResultActions";
import { nextAnalysisResultId } from "../../../store/idSeq";
import { beginOp, endOp, updateOp } from "../../../store/pendingOps";
import { analysisBatchRuntime, useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";

export interface AnalysisBatchOutcome {
  values: (string | number | null)[];
  warnings?: string[];
}

interface Props {
  toolId: string;
  label: string;
  summaryColumns: string[];
  runItem: (dataset: Dataset, selection: AnalysisSelectionItem) => Promise<AnalysisBatchOutcome>;
}

type RunStatus = "ready" | "completed" | "failed" | "cancelled";

const MAX_BATCH_INPUTS = 1_000;

interface RunRow {
  datasetId: string;
  name: string;
  rows: number;
  status: RunStatus;
  values: (string | number | null)[];
  warning: string | null;
}

const displayStatus = (status: RunStatus): string => status[0].toUpperCase() + status.slice(1);

/** Shared batch shell: honest preflight first, sequential execution so cancel
 * has a deterministic boundary, and one durable result even after a partial
 * failure/cancel. Scientific algorithms remain tool-owned via runItem. */
export default function AnalysisBatchControls({ toolId, label, summaryColumns, runItem }: Props) {
  const owner = useAnalysisSelection((state) => state.toolId);
  const selection = useAnalysisSelection((state) => state.selection);
  const datasets = useApp((state) => state.datasets);
  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRows, setLastRows] = useState<RunRow[] | null>(null);
  const cancelRef = useRef(false);
  const runningRef = useRef(false);
  const current = owner === toolId ? selection : null;
  const resolved = useMemo(
    () => current ? resolveAnalysisSelection(current, datasets) : { items: [], issues: [] },
    [current, datasets],
  );
  if (!current || current.items.length === 0) return null;

  const issuesById = new Map<string, string[]>();
  for (const issue of resolved.issues) {
    issuesById.set(issue.datasetId, [...(issuesById.get(issue.datasetId) ?? []), issue.message]);
  }
  const errorById = new Map(resolved.issues.filter((issue) => issue.severity === "error").map((issue) => [issue.datasetId, issue.message]));
  const readyById = new Map(resolved.items.map((item) => [item.selection.datasetId, item]));
  const exceedsBatchLimit = current.items.length > MAX_BATCH_INPUTS;
  const blocked = errorById.size > 0 || resolved.items.length === 0 || exceedsBatchLimit;

  const runBatch = async (): Promise<void> => {
    if (runningRef.current || blocked) return;
    const snapshot = structuredClone(current);
    const start = resolveAnalysisSelection(snapshot, analysisBatchRuntime().datasets);
    if (start.issues.some((issue) => issue.severity === "error") || start.items.length === 0) return;
    cancelRef.current = false;
    runningRef.current = true;
    setRunning(true);
    const warnings: string[] = [];
    const runFingerprints = new Map<string, string>();
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
          const outcome = await runItem(live, selected.selection);
          rows[index].status = "completed";
          rows[index].values = outcome.values;
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
      analysisBatchRuntime().recordHistory(`run ${label.toLowerCase()}`);
      registerAnalysisResult({
        version: ANALYSIS_RESULT_VERSION,
        id: nextAnalysisResultId(),
        name: `${label} — ${new Date().toLocaleString()}`,
        producer: { id: "analysis-batch", label, version: 1 },
        // Unstarted cancelled inputs are status rows, not scientific sources.
        // Excluding them keeps a pending preview from making an otherwise
        // valid partial result permanently out of date.
        sources: executedIds.map((datasetId) => ({ datasetId, role: "input" as const })),
        outputs: [],
        parameters: { toolId, selection: analysisSelectionSnapshot(snapshot) as unknown as AnalysisResultValue },
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
      });
    } finally {
      endOp(opId);
      runningRef.current = false;
      setRunning(false);
      setLastRows(rows.map((row) => ({ ...row })));
    }
  };

  const displayRows = lastRows ?? current.items.map((item) => {
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
      <table className="qzk-analysis-batch-table">
        <thead><tr><th>Worksheet</th><th>Rows</th><th>Status</th><th>Warning</th></tr></thead>
        <tbody>{displayRows.map((row) => <tr key={row.datasetId}>
          <td>{row.name}</td><td>{row.rows}</td><td>{displayStatus(row.status)}</td><td>{row.warning ?? "—"}</td>
        </tr>)}</tbody>
      </table>
      <div className="qzk-analysis-input-review-actions">
        <span>{exceedsBatchLimit
          ? `Select ${MAX_BATCH_INPUTS.toLocaleString()} or fewer worksheets for one batch.`
          : blocked ? "Fix blocked inputs above before running."
            : "Cancel finishes the current worksheet, then marks the remaining inputs Cancelled."}</span>
        <Button variant="primary" size="sm" disabled={blocked || running} onClick={() => void runBatch()}>
          {running ? "Running…" : `Run ${label} batch`}
        </Button>
      </div>
    </div>}
  </section>;
}
