import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import { SNAPSHOT_RESULT_STATUS, dataFingerprint, isSnapshotResult, snapshotResultState } from "../../../lib/analysisResultFreshness";
import { distributionRecipe } from "../../../lib/distributionAnalysisResult";
import { fitYByXRecipe } from "../../../lib/fitYByXAnalysisResult";
import { variabilityRecipe } from "../../../lib/variabilityAnalysisResult";
import { outlierScreeningRecipe } from "../../../lib/outlierScreeningAnalysisResult";
import { multivariateRecipe } from "../../../lib/multivariateAnalysisResult";
import { peakTableMatchesData } from "../../../lib/peakTableFit";
import { signalRecipeChannels, signalRecipeXRange } from "../../../lib/signalRecipe";
import { statisticalTestRecipe } from "../../../lib/statisticalTestAnalysisResult";
import { createSignalWorksheetFromApp } from "../../../store/signalWorksheetCommand";
import { useApp } from "../../../store/useApp";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useDistributionRequestStore } from "../../../store/distribution";
import { useFitYByXStore } from "../../../store/fitYByX";
import { useVariabilityStore } from "../../../store/variability";
import { useOutlierScreeningStore } from "../../../store/outlierScreening";
import { useMultivarStore } from "../../../store/multivar";
import { askConfirm } from "../../overlays/ConfirmDialog";
import { askParams } from "../../overlays/ParamDialog";
import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";
import AnalysisResultFitOverview from "./AnalysisResultFitOverview";
import AnalysisResultFitTable from "./AnalysisResultFitTable";
import AnalysisResultFigures from "./AnalysisResultFigures";
import AnalysisResultPeakTable from "./AnalysisResultPeakTable";
import AnalysisResultRefl, { liveReflectivityFit, reflectivityFitIssues } from "./AnalysisResultRefl";
import AnalysisResultSnapshotToolbar from "./AnalysisResultSnapshotToolbar";
import AnalysisResultSnapshot from "./AnalysisResultSnapshot";
import AnalysisResultTables from "./AnalysisResultTables";
import { analysisResultDiagnostics } from "./analysisResultDiagnostics";
import { mappingForResult } from "./analysisResultFigureMapping";
import { recordsFor } from "../reflectivity/reflFitRecord";
import { FIT_SOURCE_MISSING, formatDate, formatValue, PEAK_SOURCE_MISSING, SOURCE_MISSING } from "./analysisResultPanelText";
type Tab = "overview" | "table" | "figures" | "diagnostics" | "provenance" | "notes";
const TABS: readonly Tab[] = ["overview", "table", "figures", "diagnostics", "provenance", "notes"];
// Its own seam, not store/analysisResultLazy.ts: importing that from this
// chunk would split it into a separate eagerly-named chunk (measured).
const loadActions = () => runLazy("Loading analysis result actions…", () => import("../../../store/analysisResultActions"));
const withActions = (run: (m: Awaited<ReturnType<typeof loadActions>>) => void): void => {
  void loadActions().then(run, onLoadFailure);
};
export default function AnalysisResultPanel() {
  const openId = useApp((state) => state.openAnalysisResultId);
  const result = useApp((state) => state.analysisResults.find((item) => item.id === openId));
  const datasets = useApp((state) => state.datasets);
  const staleDatasets = useApp((state) => state.staleDatasets);
  const staleFits = useApp((state) => state.staleFits);
  const setActive = useApp((state) => state.setActive);
  const setXKey = useApp((state) => state.setXKey);
  const setYKeys = useApp((state) => state.setYKeys);
  const setStageTab = useApp((state) => state.setStageTab);
  const setPeaksOpen = useApp((state) => state.setPeaksOpen);
  const setCurveFitOpen = useApp((state) => state.setCurveFitOpen);
  const openReflectivityFitRecord = useApp((state) => state.openReflectivityFitRecord);
  const openQuickFigureBuilder = useApp((state) => state.openQuickFigureBuilder);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<"recalculate" | "rerun" | "duplicate" | "freeze" | "figure" | "report" | "export" | null>(null);
  const [notes, setNotes] = useState(result?.notes ?? "");
  useEffect(() => setNotes(result?.notes ?? ""), [result?.id, result?.notes]);

  const source = datasets.find((dataset) => dataset.id === result?.sources[0]?.datasetId);
  const output = datasets.find((dataset) => dataset.id === result?.outputs[0]?.datasetId);
  const isPeak = result?.settingsRef?.field === "peakTable";
  const isFit = result?.settingsRef?.field === "fitSpec";
  const isRefl = result?.settingsRef?.field === "reflFits";
  const isStats = result?.producer.id === "statistical-test";
  const isDistribution = result?.producer.id === "distribution-analysis";
  const isFitYByX = result?.producer.id === "fit-y-by-x";
  const isVariability = result?.producer.id === "variability-analysis";
  const isOutlierScreening = result?.producer.id === "outlier-screening";
  const isMultivariate = result?.producer.id === "multivariate-analysis";
  const isSnapshot = !!result && isSnapshotResult(result);
  const statsRecipe = result && isStats ? statisticalTestRecipe(result) : null;
  const savedDistributionRecipe = result && isDistribution ? distributionRecipe(result, source) : null;
  const savedFitYByXRecipe = result && isFitYByX ? fitYByXRecipe(result, source) : null;
  const savedVariabilityRecipe = result && isVariability ? variabilityRecipe(result, source) : null;
  const savedOutlierRecipe = result && isOutlierScreening ? outlierScreeningRecipe(result, source) : null;
  const savedMultivariateRecipe = result && isMultivariate ? multivariateRecipe(result, source) : null;
  const peakTable = isPeak ? source?.peakTable ?? null : null;
  const fitSpec = isFit ? source?.fitSpec ?? null : null;
  const reflFit = isRefl ? liveReflectivityFit(result, datasets) : null;
  const reflIssues = reflectivityFitIssues(reflFit, datasets);
  const fitFingerprintStale = !!(isFit && source && !source.pending && result?.sourceFingerprint &&
    result.sourceFingerprint !== dataFingerprint(source.data));
  // One authority for status, gates, diagnostics, and report handoff.
  const snapshotState = result && isSnapshot ? snapshotResultState(result, datasets) : null;
  const diagnostics = useMemo(() => result ? analysisResultDiagnostics({
    result, datasets, source, output, staleDatasets, staleFits, isPeak, isFit, isRefl,
    peakTable, fitSpec, fitFingerprintStale, reflFit, reflIssues, snapshotState,
  }) : [], [datasets, fitFingerprintStale, fitSpec, isFit, isPeak, isRefl, output, peakTable, reflFit, reflIssues, result, snapshotState, source, staleDatasets, staleFits]);

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
  const editFit = () => {
    if (!source || !fitSpec) return;
    setActive(source.id);
    setStageTab("plot");
    if (fitSpec.xKey !== undefined) setXKey(fitSpec.xKey);
    if (fitSpec.yKey !== undefined) setYKeys([fitSpec.yKey]);
    setCurveFitOpen(true);
    close();
  };
  const editReflFit = () => {
    const recordId = result.settingsRef?.field === "reflFits" ? result.settingsRef.recordId : null;
    const live = recordId && result.sources.find((ref) => {
      const dataset = datasets.find((item) => item.id === ref.datasetId);
      return recordsFor(dataset).some((record) => record.id === recordId);
    });
    if (!live) return;
    setActive(live.datasetId); setStageTab("plot");
    openReflectivityFitRecord(recordId);
    close();
  };
  const editSnapshot = () => {
    if (snapshotState !== "current" && snapshotState !== "pending") return;
    if (source) setActive(source.id);
    if (statsRecipe) useStatsTestsStore.getState().openWith(statsRecipe);
    else if (savedDistributionRecipe) {
      useDistributionRequestStore.getState().openWith(savedDistributionRecipe);
      useApp.setState({ distributionOpen: true });
    } else if (savedFitYByXRecipe) useFitYByXStore.getState().openWith(savedFitYByXRecipe);
    else if (savedVariabilityRecipe) useVariabilityStore.getState().openWith(savedVariabilityRecipe);
    else if (savedOutlierRecipe) useOutlierScreeningStore.getState().openWith(savedOutlierRecipe);
    else if (savedMultivariateRecipe) useMultivarStore.getState().openWith(savedMultivariateRecipe);
    else return;
    close();
  };
  const recalculate = async () => {
    if (!source || (!isFit && !output) || busy) return;
    setBusy("recalculate");
    try {
      await loadActions().then((m) => isFit
        ? m.recalculateFitAnalysisResult(result.id)
        : m.recalculateAnalysisResult(result.id), onLoadFailure);
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
    const kept = isPeak ? "Its fitted peak table and source data are kept."
      : isFit ? "Its saved fit and source data are kept."
      : isRefl ? "Its saved reflectivity fit and source data are kept."
      : "Its linked worksheet and scientific data are kept.";
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
        .then((m) => m.resolveAnalysisResultPlot(result.id, index, true), () => { onLoadFailure(); return null; });
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
  const exportFit = async () => {
    if (busy) return;
    setBusy("export");
    try { await loadActions().then((m) => m.exportAnalysisFitTable(result.id), onLoadFailure); }
    finally { setBusy(null); }
  };
  const exportInlineTables = async () => {
    if (busy) return;
    setBusy("export");
    try { await loadActions().then((m) => m.exportAnalysisInlineTables(result.id), onLoadFailure); }
    finally { setBusy(null); }
  };
  const sendInlineReport = async () => {
    if (busy) return;
    setBusy("report");
    try { await loadActions().then((m) => m.sendAnalysisInlineTableToReport(result.id), onLoadFailure); }
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
  const fitStale = !!(isFit && source && (staleFits.includes(source.id) || fitFingerprintStale));
  const fitReplayable = !!(fitSpec && fitSpec.xKey !== undefined && fitSpec.yKey !== undefined);
  const status = isRefl
    ? !reflFit || reflIssues.missing.length ? "Source missing" : reflIssues.changed.length ? "Out of date" : "Current"
    : isSnapshot
    ? SNAPSHOT_RESULT_STATUS[snapshotState ?? "source-missing"]
    : isFit
    ? !source ? "Source missing" : !fitSpec ? "Incomplete" : fitStale ? "Out of date" : "Current"
    : isPeak
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
          {isSnapshot ? <AnalysisResultSnapshotToolbar result={result} source={source} recipeReady={!!(statsRecipe || savedDistributionRecipe || savedFitYByXRecipe || savedVariabilityRecipe || savedOutlierRecipe || savedMultivariateRecipe)}
            state={snapshotState ?? "source-missing"} busy={busy} onOpen={() => source && openTable(source.id)} onEdit={editSnapshot}
            onDuplicate={() => void duplicate()} onReport={() => void sendInlineReport()} /> : isRefl ? <>
            <Button disabled={!reflFit || busy !== null} onClick={editReflFit}>Open fit workbench</Button>
          </> : isPeak ? <>
            <Button disabled={!source || busy !== null} onClick={() => source && openTable(source.id)}>Open data</Button>
            <Button disabled={!source || busy !== null} onClick={editPeaks}>Edit / Re-fit…</Button>
          </> : isFit ? <>
            <Button disabled={!source || busy !== null} onClick={() => source && openTable(source.id)}>Open data</Button>
            <Button disabled={!source || !fitSpec || busy !== null} onClick={editFit}>Edit / Re-fit…</Button>
            <Button disabled={!source || !fitReplayable || busy !== null}
              title={!fitReplayable && fitSpec ? "This legacy fit does not record exact X/Y channels; use Edit / Re-fit first." : undefined}
              onClick={() => void recalculate()}>{busy === "recalculate" ? "Recalculating…" : "Recalculate"}</Button>
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
        {(sourceMissing || ((isPeak || isFit) && !source) || snapshotState === "source-missing" || (isRefl && !reflFit)) && <p className="qz-analysis-missing" role="note">
          {isPeak ? PEAK_SOURCE_MISSING : isFit ? FIT_SOURCE_MISSING : isRefl ? "Saved reflectivity fit not found — restore one of its source worksheets to inspect it." : SOURCE_MISSING}
        </p>}
        <div className="qz-analysis-tabs" role="tablist" aria-label="Analysis result views">
          {TABS.map((value, index) => (
            <button key={value} id={`analysis-result-tab-${value}`} role="tab" aria-controls="analysis-result-tabpanel" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} className={tab === value ? "active" : ""} onKeyDown={(event) => moveTab(event, index)} onClick={() => setTab(value)}>{value[0].toUpperCase() + value.slice(1)}{value === "diagnostics" && diagnostics.length ? ` (${diagnostics.length})` : ""}</button>
          ))}
        </div>
        <div id="analysis-result-tabpanel" className="qz-analysis-body" role="tabpanel" aria-labelledby={`analysis-result-tab-${tab}`}>
          {tab === "overview" && <>
            {isSnapshot ? <AnalysisResultSnapshot result={result} source={source} view="overview" onExport={() => void exportInlineTables()} /> : isRefl ? <AnalysisResultRefl result={result} record={reflFit} datasets={datasets} view="overview" /> : isPeak ? <dl className="qz-analysis-summary">
              <div><dt>Analysis</dt><dd>{result.producer.label}</dd></div>
              <div><dt>Source</dt><dd>{source?.name ?? "Missing source"}</dd></div>
              <div><dt>Peaks</dt><dd>{peakTable ? `${peakTable.peaks.length} total · ${peakTable.peaks.filter((peak) => peak.excluded).length} excluded` : "Table unavailable"}</dd></div>
              <div><dt>Model</dt><dd>{peakTable?.provenance.model ?? "Unavailable"}</dd></div>
              <div><dt>Method</dt><dd>{peakTable?.provenance.method ?? "Unavailable"}</dd></div>
              <div><dt>X axis</dt><dd>{peakTable ? `${peakTable.provenance.xLabel || "Unknown"}${peakTable.provenance.xUnit ? ` (${peakTable.provenance.xUnit})` : ""}` : "Unavailable"}</dd></div>
              <div><dt>R²</dt><dd>{peakTable?.provenance.R2 == null ? "Not reported" : formatValue(peakTable.provenance.R2)}</dd></div>
              <div><dt>Fitted</dt><dd>{peakTable ? formatDate(peakTable.provenance.fittedAt) : "Unavailable"}</dd></div>
            </dl> : isFit ? <AnalysisResultFitOverview result={result} source={source} spec={fitSpec} /> : <dl className="qz-analysis-summary">
              <div><dt>Analysis</dt><dd>{result.producer.label}</dd></div>
              <div><dt>Source</dt><dd>{source?.name ?? "Missing source"}</dd></div>
              <div><dt>Output</dt><dd>{output?.name ?? "Missing output"}</dd></div>
              <div><dt>Selection</dt><dd>{channels?.map((channel) => channel.label).join(", ") || "Not recorded"}</dd></div>
              <div><dt>Range</dt><dd>{xRange?.map(formatValue).join(" to ") ?? "Full worksheet"}</dd></div>
              <div><dt>Created</dt><dd>{formatDate(result.createdAt)}</dd></div>
            </dl>}
            {isPeak
              ? <p className="qz-analysis-caption">Values are read live from the source worksheet’s fitted peak table. Editing or re-fitting updates this result; deleting this Library item keeps the scientific table.</p>
              : !isSnapshot && !isFit && !isRefl && !sourceMissing && <p className="qz-analysis-caption">This result stays linked to its source. Recalculate updates this output; Rerun as new preserves it and creates another result.</p>}
          </>}
          {tab === "table" && (isSnapshot
            ? <AnalysisResultSnapshot result={result} source={source} view="table" disabled={busy !== null} onExport={() => void exportInlineTables()} />
            : isRefl
            ? <AnalysisResultRefl result={result} record={reflFit} datasets={datasets} view="table" />
            : isPeak
            ? <AnalysisResultPeakTable table={peakTable} onExport={() => void exportPeaks()} />
            : isFit ? <AnalysisResultFitTable spec={fitSpec} onExport={() => void exportFit()} />
            : <AnalysisResultTables result={result} onOpen={openTable} onExport={(datasetId) => void exportTable(datasetId)} />)}
          {tab === "figures" && <AnalysisResultFigures result={result} onOpen={(index) => void openPlot(index)} onBuild={(index) => void buildFigure(index)} onReport={(index) => void sendReport(index)} />}
          {tab === "diagnostics" && (diagnostics.length
            ? <ul className="qz-analysis-diagnostics">{diagnostics.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul>
            : <p className="qz-analysis-empty">No warnings or missing references.</p>)}
          {tab === "provenance" && (isSnapshot
            ? <AnalysisResultSnapshot result={result} source={source} view="provenance" onExport={() => void exportInlineTables()} />
            : isRefl
            ? <AnalysisResultRefl result={result} record={reflFit} datasets={datasets} view="provenance" />
            : isFit
            ? <AnalysisResultFitOverview result={result} source={source} spec={fitSpec} provenance />
            : <dl className="qz-analysis-summary">
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
          </dl>)}
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
