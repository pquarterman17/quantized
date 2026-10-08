import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import type { AnalysisResult } from "../../../lib/analysisResult";
import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import { createSignalWorksheetFromApp } from "../../../store/signalWorksheetCommand";
import { useApp } from "../../../store/useApp";
import { askConfirm } from "../../overlays/ConfirmDialog";
import { askParams } from "../../overlays/ParamDialog";
import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";

type Tab = "overview" | "table" | "diagnostics" | "provenance" | "notes";
const TABS: readonly Tab[] = ["overview", "table", "diagnostics", "provenance", "notes"];

// Its own seam, not store/analysisResultLazy.ts: importing that from this
// chunk would split it into a separate eagerly-named chunk (measured).
const loadActions = () => runLazy("Loading analysis result actions…", () => import("../../../store/analysisResultActions"));
const withActions = (run: (m: Awaited<ReturnType<typeof loadActions>>) => void): void => {
  void loadActions().then(run, onLoadFailure);
};

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-4)) return value.toExponential(6);
  return value.toLocaleString(undefined, { maximumSignificantDigits: 8 });
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function ResultTable({ result }: { result: AnalysisResult }) {
  const datasets = useApp((state) => state.datasets);
  const output = datasets.find((dataset) => dataset.id === result.tableRefs?.[0]?.datasetId)
    ?? datasets.find((dataset) => dataset.id === result.outputs[0]?.datasetId);
  if (!output) return <p className="qz-analysis-empty">The output worksheet is unavailable.</p>;
  const rows = Math.min(output.data.time.length, 100);
  return (
    <div className="qz-analysis-table-wrap">
      <table className="qz-analysis-table">
        <thead><tr>
          <th>{String(output.data.metadata.xLabel ?? "X")}</th>
          {output.data.labels.map((label, index) => <th key={`${label}-${index}`}>{label}</th>)}
        </tr></thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              <td>{formatValue(output.data.time[row])}</td>
              {output.data.labels.map((_, column) => <td key={column}>{formatValue(output.data.values[row]?.[column] ?? NaN)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {output.data.time.length > rows && <p className="qz-analysis-caption">Showing the first {rows.toLocaleString()} of {output.data.time.length.toLocaleString()} rows. Open the worksheet for the complete table.</p>}
    </div>
  );
}

export default function AnalysisResultPanel() {
  const openId = useApp((state) => state.openAnalysisResultId);
  const result = useApp((state) => state.analysisResults.find((item) => item.id === openId));
  const datasets = useApp((state) => state.datasets);
  const staleDatasets = useApp((state) => state.staleDatasets);
  const setActive = useApp((state) => state.setActive);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<"recalculate" | "rerun" | null>(null);
  const [notes, setNotes] = useState(result?.notes ?? "");
  useEffect(() => setNotes(result?.notes ?? ""), [result?.id, result?.notes]);

  const source = datasets.find((dataset) => dataset.id === result?.sources[0]?.datasetId);
  const output = datasets.find((dataset) => dataset.id === result?.outputs[0]?.datasetId);
  const diagnostics = useMemo(() => {
    if (!result) return [];
    return [
      ...result.warnings,
      ...result.sources.filter((ref) => !datasets.some((dataset) => dataset.id === ref.datasetId))
        .map((ref) => `Source worksheet ${ref.datasetId} is missing.`),
      ...result.outputs.filter((ref) => !datasets.some((dataset) => dataset.id === ref.datasetId))
        .map((ref) => `Output worksheet ${ref.datasetId} is missing.`),
      ...(output && staleDatasets.includes(output.id) ? ["The linked output is out of date and should be recalculated."] : []),
    ];
  }, [datasets, output, result, staleDatasets]);

  if (!result) return null;
  const close = () => useApp.setState({ openAnalysisResultId: null });
  const openOutput = () => {
    if (!output) return;
    setActive(output.id);
    close();
  };
  const recalculate = async () => {
    if (!source || !output || busy) return;
    setBusy("recalculate");
    try {
      await loadActions().then((m) => m.recalculateAnalysisResult(result.id), onLoadFailure);
    } finally {
      setBusy(null);
    }
  };
  const rerun = async () => {
    if (!source || !output?.analysisRecipe || busy) return;
    setBusy("rerun");
    try {
      const id = await createSignalWorksheetFromApp(source.id, output.analysisRecipe);
      if (id) setActive(id);
    } finally {
      setBusy(null);
    }
  };
  const rename = async () => {
    const picked = await askParams(`Rename "${result.name}"`, [
      { key: "name", label: "Name", type: "text", default: result.name },
    ]);
    const name = picked && String(picked.name).trim();
    if (name) withActions((m) => m.renameAnalysisResult(result.id, name));
  };
  const remove = async () => {
    const yes = await askConfirm(`Delete "${result.name}"?`, "This removes the result record from the Library. Its linked worksheet and scientific data are kept.", "Delete", true);
    if (yes) withActions((m) => m.removeAnalysisResult(result.id));
  };
  const status = !source || !output ? "Incomplete" : staleDatasets.includes(output.id) ? "Out of date" : "Current";
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1
      : offset ? (index + offset + TABS.length) % TABS.length : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(TABS[next]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };

  return (
    <ToolWindow id="analysis-result" title={result.name} width={680} x={210} y={100} onClose={close}>
      <div className="qz-analysis-result">
        <div className="qz-analysis-toolbar">
          <span className={`qz-analysis-status status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>
          <Button disabled={!output} onClick={openOutput}>Open worksheet</Button>
          <Button disabled={!source || !output || busy !== null} onClick={() => void recalculate()}>{busy === "recalculate" ? "Recalculating…" : "Recalculate"}</Button>
          <Button disabled={!source || !output?.analysisRecipe || busy !== null} onClick={() => void rerun()}>{busy === "rerun" ? "Rerunning…" : "Rerun as new"}</Button>
          <Button onClick={() => void rename()}>Rename…</Button>
          <Button variant="danger" onClick={() => void remove()}>Delete…</Button>
        </div>
        <div className="qz-analysis-tabs" role="tablist" aria-label="Analysis result views">
          {TABS.map((value, index) => (
            <button key={value} id={`analysis-result-tab-${value}`} role="tab" aria-controls="analysis-result-tabpanel" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} className={tab === value ? "active" : ""} onKeyDown={(event) => moveTab(event, index)} onClick={() => setTab(value)}>{value[0].toUpperCase() + value.slice(1)}{value === "diagnostics" && diagnostics.length ? ` (${diagnostics.length})` : ""}</button>
          ))}
        </div>
        <div id="analysis-result-tabpanel" className="qz-analysis-body" role="tabpanel" aria-labelledby={`analysis-result-tab-${tab}`}>
          {tab === "overview" && <>
            <dl className="qz-analysis-summary">
              <div><dt>Analysis</dt><dd>{result.producer.label}</dd></div>
              <div><dt>Source</dt><dd>{source?.name ?? "Missing source"}</dd></div>
              <div><dt>Output</dt><dd>{output?.name ?? "Missing output"}</dd></div>
              <div><dt>Selection</dt><dd>{result.selection?.channels.map((channel) => channel.label).join(", ") || "Not recorded"}</dd></div>
              <div><dt>Range</dt><dd>{result.selection?.xRange?.map(formatValue).join(" to ") ?? "Full worksheet"}</dd></div>
              <div><dt>Created</dt><dd>{formatDate(result.createdAt)}</dd></div>
            </dl>
            <p className="qz-analysis-caption">This result stays linked to its source. Recalculate updates this output; Rerun as new preserves it and creates another result.</p>
          </>}
          {tab === "table" && <ResultTable result={result} />}
          {tab === "diagnostics" && (diagnostics.length
            ? <ul className="qz-analysis-diagnostics">{diagnostics.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul>
            : <p className="qz-analysis-empty">No warnings or missing references.</p>)}
          {tab === "provenance" && <dl className="qz-analysis-summary">
            <div><dt>Producer</dt><dd>{result.producer.id} · v{result.producer.version}</dd></div>
            <div><dt>Result schema</dt><dd>v{result.version}</dd></div>
            <div><dt>Source ID</dt><dd>{result.sources.map((item) => item.datasetId).join(", ") || "None"}</dd></div>
            <div><dt>Output ID</dt><dd>{result.outputs.map((item) => item.datasetId).join(", ") || "None"}</dd></div>
            <div><dt>Settings authority</dt><dd>{result.settingsRef ? `${result.settingsRef.datasetId}.${result.settingsRef.field}` : "Not recorded"}</dd></div>
            <div><dt>Last recalculated</dt><dd>{result.updatedAt ? formatDate(result.updatedAt) : "Not since creation"}</dd></div>
          </dl>}
          {tab === "notes" && <div className="qz-analysis-notes">
            <label htmlFor="analysis-result-notes">Notes</label>
            <textarea id="analysis-result-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Record interpretation, assumptions, or follow-up work…" />
            <Button variant="primary" disabled={notes === (result.notes ?? "")} onClick={() => withActions((m) => m.updateAnalysisResultNotes(result.id, notes))}>Save notes</Button>
          </div>}
        </div>
      </div>
    </ToolWindow>
  );
}
