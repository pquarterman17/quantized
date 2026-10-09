import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import type { QuickFigureMapping } from "../../../lib/quickFigureMapping";
import { initialQuickFigureMapping } from "../../../lib/quickFigureMappingActions";
import { peakTableMatchesData } from "../../../lib/peakTableFit";
import { signalRecipeChannels, signalRecipeXRange } from "../../../lib/signalRecipe";
import type { Dataset } from "../../../lib/types";
import { createSignalWorksheetFromApp } from "../../../store/signalWorksheetCommand";
import { useApp } from "../../../store/useApp";
import { askConfirm } from "../../overlays/ConfirmDialog";
import { askParams } from "../../overlays/ParamDialog";
import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";
import AnalysisResultFigures from "./AnalysisResultFigures";
import AnalysisResultPeakTable from "./AnalysisResultPeakTable";
import AnalysisResultTables from "./AnalysisResultTables";

type Tab = "overview" | "table" | "figures" | "diagnostics" | "provenance" | "notes";
const TABS: readonly Tab[] = ["overview", "table", "figures", "diagnostics", "provenance", "notes"];
// One sentence for the missing-source state: the notice AND the disabled
// actions' reason. Derived from the refs, so it clears when the source returns.
const SOURCE_MISSING = "Source data not found — results can't be recalculated.";
const PEAK_SOURCE_MISSING = "Source data not found — the fitted peak table is unavailable until that worksheet is restored.";

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

/** Start the figure builder from the result's recorded series, not from a
 * fresh whole-worksheet guess. Inferred uncertainty stays attached only when
 * it belongs to one of those series; every other ordinary channel starts as
 * ignored so opening the builder cannot silently add curves to the result. */
function mappingForResult(
  dataset: Dataset,
  recorded: readonly number[],
  recordedX?: number | null,
): QuickFigureMapping {
  const base = initialQuickFigureMapping(dataset);
  const yKeys = [...new Set(recorded)].filter((channel) =>
    Number.isInteger(channel) && channel >= 0 && channel < dataset.data.labels.length,
  );
  const ySet = new Set(yKeys);
  const candidateX = recordedX === undefined ? base.xKey : recordedX;
  const xKey = candidateX !== null && ySet.has(candidateX) ? null : candidateX;
  const xChanged = xKey !== base.xKey;
  const xKeyByY = base.xKeyByY
    ? Object.fromEntries(Object.entries(base.xKeyByY).filter(([channel]) => ySet.has(Number(channel))))
    : undefined;
  const errorBindings = base.errorBindings.filter((binding) =>
    !ySet.has(binding.channel) && (binding.axis === "y" ? ySet.has(binding.target) : !xChanged),
  );
  const reserved = new Set([
    ...(xKey === null ? [] : [xKey]),
    ...Object.values(xKeyByY ?? {}).filter((channel): channel is number => channel !== null),
    ...errorBindings.map((binding) => binding.channel),
    ...(base.groupKey == null || ySet.has(base.groupKey) ? [] : [base.groupKey]),
    ...(base.labelKey == null || ySet.has(base.labelKey) ? [] : [base.labelKey]),
  ]);
  const ignoredKeys = dataset.data.labels
    .map((_, channel) => channel)
    .filter((channel) => !ySet.has(channel) && !reserved.has(channel));
  const mapping: QuickFigureMapping = {
    ...base,
    xKey,
    yKeys,
    errorBindings,
    ignoredKeys,
    ...(base.groupKey != null && ySet.has(base.groupKey) ? { groupKey: null } : {}),
    ...(base.labelKey != null && ySet.has(base.labelKey) ? { labelKey: null } : {}),
  };
  if (xKeyByY && Object.keys(xKeyByY).length) mapping.xKeyByY = xKeyByY;
  else delete mapping.xKeyByY;
  return mapping;
}

export default function AnalysisResultPanel() {
  const openId = useApp((state) => state.openAnalysisResultId);
  const result = useApp((state) => state.analysisResults.find((item) => item.id === openId));
  const datasets = useApp((state) => state.datasets);
  const staleDatasets = useApp((state) => state.staleDatasets);
  const setActive = useApp((state) => state.setActive);
  const setStageTab = useApp((state) => state.setStageTab);
  const setPeaksOpen = useApp((state) => state.setPeaksOpen);
  const openQuickFigureBuilder = useApp((state) => state.openQuickFigureBuilder);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<"recalculate" | "rerun" | "duplicate" | "freeze" | "figure" | "report" | "export" | null>(null);
  const [notes, setNotes] = useState(result?.notes ?? "");
  useEffect(() => setNotes(result?.notes ?? ""), [result?.id, result?.notes]);

  const source = datasets.find((dataset) => dataset.id === result?.sources[0]?.datasetId);
  const output = datasets.find((dataset) => dataset.id === result?.outputs[0]?.datasetId);
  const isPeak = result?.settingsRef?.field === "peakTable";
  const peakTable = isPeak ? source?.peakTable ?? null : null;
  const diagnostics = useMemo(() => {
    if (!result) return [];
    return [
      ...result.warnings,
      ...result.sources.filter((ref) => !datasets.some((dataset) => dataset.id === ref.datasetId))
        .map((ref) => `Source worksheet ${ref.datasetId} is missing.`),
      ...result.outputs.filter((ref) => !datasets.some((dataset) => dataset.id === ref.datasetId))
        .map((ref) => `Output worksheet ${ref.datasetId} is missing.`),
      ...(output && staleDatasets.includes(output.id) ? ["The linked output is out of date and should be recalculated."] : []),
      ...(peakTable?.provenance.warnings ?? []),
      ...(isPeak && source && peakTable && !peakTableMatchesData(peakTable, source)
        ? ["The source data changed after this peak fit. Re-fit before using these values."]
        : []),
      ...(isPeak && source && !peakTable ? ["The fitted peak table is no longer available on the source worksheet."] : []),
    ];
  }, [datasets, isPeak, output, peakTable, result, source, staleDatasets]);

  if (!result) return null;
  const close = () => useApp.setState({ openAnalysisResultId: null });
  const openOutput = () => {
    if (!output) return;
    setActive(output.id);
    setStageTab("worksheet");
    close();
  };
  const openTable = (datasetId: string) => {
    setActive(datasetId);
    setStageTab("worksheet");
    close();
  };
  const editPeaks = () => {
    if (!source) return;
    setActive(source.id);
    setStageTab("plot");
    setPeaksOpen(true);
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
    const kept = isPeak ? "Its fitted peak table and source data are kept." : "Its linked worksheet and scientific data are kept.";
    const yes = await askConfirm(`Delete "${result.name}"?`, `This removes the result record from the Library. ${kept}`, "Delete", true);
    if (yes) withActions((m) => m.removeAnalysisResult(result.id));
  };
  const duplicate = async () => {
    if (busy) return;
    setBusy("duplicate");
    try { await loadActions().then((m) => m.duplicateAnalysisResult(result.id), onLoadFailure); }
    finally { setBusy(null); }
  };
  const freeze = async () => {
    if (busy) return;
    setBusy("freeze");
    try {
      const frozenId = await loadActions().then((m) => m.freezeAnalysisResult(result.id), () => { onLoadFailure(); return null; });
      if (frozenId) setActive(frozenId);
    } finally { setBusy(null); }
  };
  const preparePlot = async (index: number) => loadActions()
    .then((m) => m.prepareAnalysisResultPlot(result.id, index), () => { onLoadFailure(); return null; });
  const openPlot = async (index: number) => {
    if (busy) return;
    setBusy("figure");
    try { if (await preparePlot(index)) close(); } finally { setBusy(null); }
  };
  const buildFigure = async (index: number) => {
    if (busy) return;
    setBusy("figure");
    try {
      const prepared = await loadActions()
        .then((m) => m.resolveAnalysisResultPlot(result.id, index), () => { onLoadFailure(); return null; });
      if (prepared && openQuickFigureBuilder(prepared.dataset.id, mappingForResult(prepared.dataset, prepared.channels, prepared.xChannel))) close();
    } finally { setBusy(null); }
  };
  const sendReport = async (index: number) => {
    if (busy) return;
    setBusy("report");
    try {
      await loadActions().then((m) => m.sendAnalysisResultPlotToReport(result.id, index), onLoadFailure);
    } finally { setBusy(null); }
  };
  const exportTable = async (datasetId: string) => {
    if (busy) return;
    setBusy("export");
    try { await loadActions().then((m) => m.exportAnalysisResultTable(result.id, datasetId), onLoadFailure); }
    finally { setBusy(null); }
  };
  const exportPeaks = async () => {
    if (busy) return;
    setBusy("export");
    try { await loadActions().then((m) => m.exportAnalysisPeakTable(result.id), onLoadFailure); }
    finally { setBusy(null); }
  };
  // The linked recipe is the authority; an old envelope's copy is a fallback.
  const recipe = output?.analysisRecipe;
  const channels = recipe ? signalRecipeChannels(recipe) : result.selection?.channels;
  const xRange = recipe ? signalRecipeXRange(recipe) : result.selection?.xRange;
  // A kept output with no source (an older file, or a deleted source) is its
  // own state: still openable, never recalculable.
  const sourceMissing = !!output && !source && result.sources.length > 0;
  const blocked = sourceMissing ? SOURCE_MISSING : undefined;
  const freezeReason = result.outputs.length !== 1
    ? "Freeze is available when a result has one linked output worksheet."
    : !output?.derivedFrom
      ? "The linked output is already independent or unavailable."
      : "Create an independent worksheet from the current linked output.";
  const peakStale = !!(isPeak && source && peakTable && !peakTableMatchesData(peakTable, source));
  const status = isPeak
    ? !source ? "Source missing" : !peakTable ? "Incomplete" : peakStale ? "Out of date" : "Current"
    : sourceMissing ? "Source missing" : !source || !output ? "Incomplete" : staleDatasets.includes(output.id) ? "Out of date" : "Current";
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
    <ToolWindow id="analysis-result" title={result.name} width={760} x={210} y={100} onClose={close}>
      <div className="qz-analysis-result">
        <div className="qz-analysis-toolbar">
          <span className={`qz-analysis-status status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>
          {isPeak ? <>
            <Button disabled={!source || busy !== null} onClick={() => source && openTable(source.id)}>Open data</Button>
            <Button disabled={!source || busy !== null} onClick={editPeaks}>Edit / Re-fit…</Button>
          </> : <>
            <Button disabled={!output} onClick={openOutput}>Open worksheet</Button>
            <Button disabled={!source || !output || busy !== null} title={blocked} onClick={() => void recalculate()}>{busy === "recalculate" ? "Recalculating…" : "Recalculate"}</Button>
            <Button disabled={!source || !output?.analysisRecipe || busy !== null} title={blocked} onClick={() => void rerun()}>{busy === "rerun" ? "Rerunning…" : "Rerun as new"}</Button>
            <Button disabled={result.outputs.length !== 1 || !output || busy !== null} title="Create a separate linked output worksheet and result." onClick={() => void duplicate()}>{busy === "duplicate" ? "Duplicating…" : "Duplicate"}</Button>
            <Button disabled={result.outputs.length !== 1 || !output?.derivedFrom || busy !== null} title={freezeReason} onClick={() => void freeze()}>{busy === "freeze" ? "Freezing…" : "Freeze data"}</Button>
          </>}
          <Button disabled={busy !== null} onClick={() => void rename()}>Rename…</Button>
          <Button disabled={busy !== null} variant="danger" onClick={() => void remove()}>Delete…</Button>
        </div>
        {(sourceMissing || (isPeak && !source)) && <p className="qz-analysis-missing" role="note">
          {isPeak ? PEAK_SOURCE_MISSING : SOURCE_MISSING}
        </p>}
        <div className="qz-analysis-tabs" role="tablist" aria-label="Analysis result views">
          {TABS.map((value, index) => (
            <button key={value} id={`analysis-result-tab-${value}`} role="tab" aria-controls="analysis-result-tabpanel" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} className={tab === value ? "active" : ""} onKeyDown={(event) => moveTab(event, index)} onClick={() => setTab(value)}>{value[0].toUpperCase() + value.slice(1)}{value === "diagnostics" && diagnostics.length ? ` (${diagnostics.length})` : ""}</button>
          ))}
        </div>
        <div id="analysis-result-tabpanel" className="qz-analysis-body" role="tabpanel" aria-labelledby={`analysis-result-tab-${tab}`}>
          {tab === "overview" && <>
            {isPeak ? <dl className="qz-analysis-summary">
              <div><dt>Analysis</dt><dd>{result.producer.label}</dd></div>
              <div><dt>Source</dt><dd>{source?.name ?? "Missing source"}</dd></div>
              <div><dt>Peaks</dt><dd>{peakTable ? `${peakTable.peaks.length} total · ${peakTable.peaks.filter((peak) => peak.excluded).length} excluded` : "Table unavailable"}</dd></div>
              <div><dt>Model</dt><dd>{peakTable?.provenance.model ?? "Unavailable"}</dd></div>
              <div><dt>Method</dt><dd>{peakTable?.provenance.method ?? "Unavailable"}</dd></div>
              <div><dt>X axis</dt><dd>{peakTable ? `${peakTable.provenance.xLabel || "Unknown"}${peakTable.provenance.xUnit ? ` (${peakTable.provenance.xUnit})` : ""}` : "Unavailable"}</dd></div>
              <div><dt>R²</dt><dd>{peakTable?.provenance.R2 == null ? "Not reported" : formatValue(peakTable.provenance.R2)}</dd></div>
              <div><dt>Fitted</dt><dd>{peakTable ? formatDate(peakTable.provenance.fittedAt) : "Unavailable"}</dd></div>
            </dl> : <dl className="qz-analysis-summary">
              <div><dt>Analysis</dt><dd>{result.producer.label}</dd></div>
              <div><dt>Source</dt><dd>{source?.name ?? "Missing source"}</dd></div>
              <div><dt>Output</dt><dd>{output?.name ?? "Missing output"}</dd></div>
              <div><dt>Selection</dt><dd>{channels?.map((channel) => channel.label).join(", ") || "Not recorded"}</dd></div>
              <div><dt>Range</dt><dd>{xRange?.map(formatValue).join(" to ") ?? "Full worksheet"}</dd></div>
              <div><dt>Created</dt><dd>{formatDate(result.createdAt)}</dd></div>
            </dl>}
            {isPeak
              ? <p className="qz-analysis-caption">Values are read live from the source worksheet’s fitted peak table. Editing or re-fitting updates this result; deleting this Library item keeps the scientific table.</p>
              : !sourceMissing && <p className="qz-analysis-caption">This result stays linked to its source. Recalculate updates this output; Rerun as new preserves it and creates another result.</p>}
          </>}
          {tab === "table" && (isPeak
            ? <AnalysisResultPeakTable table={peakTable} onExport={() => void exportPeaks()} />
            : <AnalysisResultTables result={result} onOpen={openTable} onExport={(datasetId) => void exportTable(datasetId)} />)}
          {tab === "figures" && <AnalysisResultFigures result={result} onOpen={(index) => void openPlot(index)} onBuild={(index) => void buildFigure(index)} onReport={(index) => void sendReport(index)} />}
          {tab === "diagnostics" && (diagnostics.length
            ? <ul className="qz-analysis-diagnostics">{diagnostics.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul>
            : <p className="qz-analysis-empty">No warnings or missing references.</p>)}
          {tab === "provenance" && <dl className="qz-analysis-summary">
            <div><dt>Producer</dt><dd>{result.producer.id} · v{result.producer.version}</dd></div>
            <div><dt>Result schema</dt><dd>v{result.version}</dd></div>
            <div><dt>Source ID</dt><dd>{result.sources.map((item) => item.datasetId).join(", ") || "None"}</dd></div>
            <div><dt>Output ID</dt><dd>{result.outputs.map((item) => item.datasetId).join(", ") || "None"}</dd></div>
            <div><dt>Settings authority</dt><dd>{result.settingsRef ? `${result.settingsRef.datasetId}.${result.settingsRef.field}` : "Not recorded"}</dd></div>
            <div><dt>Last updated</dt><dd>{result.updatedAt ? formatDate(result.updatedAt) : formatDate(result.createdAt)}</dd></div>
            {isPeak && peakTable && <>
              <div><dt>Background degree</dt><dd>{peakTable.provenance.bgDegree}</dd></div>
              <div><dt>Link mode</dt><dd>{peakTable.provenance.linkMode || "None"}</dd></div>
              <div><dt>RMSE</dt><dd>{peakTable.provenance.rmse == null ? "Not reported" : formatValue(peakTable.provenance.rmse)}</dd></div>
              <div><dt>Fingerprint</dt><dd>{peakTable.provenance.fingerprint ?? "Not recorded"}</dd></div>
            </>}
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
