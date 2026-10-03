import { useEffect, useMemo, useRef, useState } from "react";

import { BUILTIN_PLOT_RECIPES } from "../../../lib/builtinPlotRecipes";
import { downloadBatchFigures, MAX_BATCH_FIGURE_EXPORT } from "../../../lib/batchFigureExport";
import type { PlotRecipe } from "../../../lib/plotRecipeSchema";
import { runSequentialBatch, type BatchProgress } from "../../../lib/sequentialBatch";
import { nextFigureId } from "../../../store/figureLifecycle";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { recordRecipeUse } from "../../../store/recordRecipeUse";
import {
  batchSeedDatasetIds,
  buildBatchFigureArtifacts,
  commitBatchFigureArtifacts,
  preflightBatchFigure,
  type BatchFigureRow,
  type BatchRecipeChoice,
} from "../../../store/batchFigureBuild";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { nextPageDocumentId } from "../../../store/pageDocuments";
import ToolWindow from "../../overlays/ToolWindow";
import { Badge, Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";

type Phase = "idle" | "checking" | "review" | "creating" | "done";

const SCOPE_LABEL = { project: "Project", global: "Global", "built-in": "Built-in" } as const;
const STATUS_LABEL = { ready: "Ready", partial: "Needs review", blocked: "Cannot build" } as const;
const STATUS_TONE = { ready: "ok", partial: "warn", blocked: "danger" } as const;
const EXPORT_FORMATS = ["pdf", "svg", "png", "tiff"] as const;
const EXPORT_STYLES = ["default", "aps", "nature", "thesis", "report", "web", "presentation", "poster"];

function recipeChoices(project: readonly PlotRecipe[], global: readonly PlotRecipe[]): BatchRecipeChoice[] {
  return [
    ...project.map((recipe) => ({ key: `project:${recipe.id}`, scope: "project" as const, recipe })),
    ...global.map((recipe) => ({ key: `global:${recipe.id}`, scope: "global" as const, recipe })),
    ...BUILTIN_PLOT_RECIPES.map((recipe) => ({ key: `built-in:${recipe.id}`, scope: "built-in" as const, recipe })),
  ];
}

export default function BatchFigureBuilder({ seedDatasetIds, onClose }: { seedDatasetIds: readonly string[]; onClose: () => void }) {
  const datasets = useApp((state) => state.datasets);
  const folders = useApp((state) => state.folders);
  const workbooks = useApp((state) => state.workbooks);
  const selectedIds = useApp((state) => state.selectedIds);
  const activeId = useApp((state) => state.activeId);
  const librarySelection = useApp((state) => state.librarySelection);
  const projectRecipes = useApp((state) => state.plotRecipes);
  const globalRecipes = useGlobalPlotRecipes((state) => state.recipes);
  const hydrateGlobal = useGlobalPlotRecipes((state) => state.hydrate);

  const initialIds = useMemo(() => {
    const explicit = seedDatasetIds.filter((id) => datasets.some((dataset) => dataset.id === id));
    return explicit.length > 0
      ? explicit
      : batchSeedDatasetIds({ datasets, folders, workbooks, selectedIds, activeId, librarySelection });
    // Seeds are intentionally latched for this opening. Later Library clicks
    // must not rewrite a half-reviewed batch under the user's hands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choices = useMemo(() => recipeChoices(projectRecipes, globalRecipes), [projectRecipes, globalRecipes]);
  const [datasetIds, setDatasetIds] = useState<string[]>(initialIds);
  const [recipeKey, setRecipeKey] = useState(choices[0]?.key ?? "");
  const [rows, setRows] = useState<BatchFigureRow[]>([]);
  const [includedIds, setIncludedIds] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [namePattern, setNamePattern] = useState("{dataset} — {recipe}");
  const [createPage, setCreatePage] = useState(true);
  const [pageName, setPageName] = useState("");
  const [columns, setColumns] = useState<number | "auto">("auto");
  const [downloadArchive, setDownloadArchive] = useState(false);
  const [exportFormat, setExportFormat] = useState<(typeof EXPORT_FORMATS)[number]>("pdf");
  const [exportStyle, setExportStyle] = useState("default");
  const [exportDpi, setExportDpi] = useState(300);
  const [archiveName, setArchiveName] = useState("");
  const [result, setResult] = useState<{ figures: number; pages: string[]; pageOpened: boolean; downloaded: boolean } | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => hydrateGlobal(), [hydrateGlobal]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!choices.some((choice) => choice.key === recipeKey)) setRecipeKey(choices[0]?.key ?? "");
  }, [choices, recipeKey]);

  const recipeChoice = choices.find((choice) => choice.key === recipeKey) ?? null;
  const selectedSet = useMemo(() => new Set(datasetIds), [datasetIds]);
  const workbookNames = useMemo(() => new Map(workbooks.map((workbook) => [workbook.id, workbook.name])), [workbooks]);
  const busy = phase === "checking" || phase === "creating";

  const invalidate = () => {
    setRows([]);
    setIncludedIds(new Set());
    setResult(null);
    setPhase("idle");
  };

  const toggleDataset = (id: string, on: boolean) => {
    setDatasetIds((current) => on ? [...current, id] : current.filter((candidate) => candidate !== id));
    invalidate();
  };

  const checkCompatibility = async () => {
    if (!recipeChoice || datasetIds.length === 0) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setPhase("checking");
    setRows([]);
    setIncludedIds(new Set());
    setResult(null);
    const targets = datasets.filter((dataset) => selectedSet.has(dataset.id));
    const results = await runSequentialBatch(
      targets.map((dataset) => ({ id: dataset.id, name: dataset.name })),
      async (item) => {
        // Yield between large imported worksheets so Stop is observable.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        const dataset = useApp.getState().datasets.find((candidate) => candidate.id === item.id);
        if (!dataset) throw new Error("dataset was removed while checking");
        return preflightBatchFigure(recipeChoice.recipe, dataset, { datasets: useApp.getState().datasets });
      },
      { signal: abort.signal, onProgress: setProgress },
    );
    if (abort.signal.aborted) {
      setPhase("idle");
      setProgress(null);
      return;
    }
    const checked = results.map((entry): BatchFigureRow => {
      if (entry.status === "created") return entry.value;
      return {
        datasetId: entry.item.id,
        datasetName: entry.item.name,
        status: "blocked",
        summary: entry.status === "failed" ? entry.reason : "Check stopped before this dataset.",
        unmatched: [],
        warnings: [],
        resolved: null,
      };
    });
    setRows(checked);
    setIncludedIds(new Set(checked.filter((row) => row.status === "ready").map((row) => row.datasetId)));
    setPageName(`${recipeChoice.recipe.name} batch`);
    setProgress(null);
    setPhase("review");
  };

  const build = async () => {
    if (!recipeChoice || includedIds.size === 0) return;
    const latestState = useApp.getState();
    const latestRows = rows.map((row): BatchFigureRow => {
      const dataset = latestState.datasets.find((candidate) => candidate.id === row.datasetId);
      return dataset
        ? preflightBatchFigure(recipeChoice.recipe, dataset, { datasets: latestState.datasets })
        : { ...row, status: "blocked", summary: "Dataset was removed after compatibility was checked.", resolved: null };
    });
    // The panel is non-modal: a worksheet can be edited while this review is
    // open. Re-resolve immediately before commit and force another review if
    // any mapping or recipe visual changed; stale channel indices must never
    // be used merely because the dataset id still exists.
    if (JSON.stringify(latestRows) !== JSON.stringify(rows)) {
      setRows(latestRows);
      setIncludedIds(new Set(latestRows.filter((row) => row.status === "ready").map((row) => row.datasetId)));
      setPhase("review");
      toast("Data or recipe settings changed. Review the refreshed compatibility results before creating figures; partial-figure opt-ins were cleared.", "danger");
      return;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setPhase("creating");
    setProgress({ done: 0, total: includedIds.size, current: null });
    // Give the progress state a paint before constructing the documents.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    if (abort.signal.aborted) return;
    const state = latestState;
    const artifacts = buildBatchFigureArtifacts({
      recipe: recipeChoice.recipe,
      rows,
      includedDatasetIds: includedIds,
      existingFigureNames: state.editableFigures.map((figure) => figure.name),
      existingPageNames: state.pages.map((page) => page.name),
      namePattern,
      createPage,
      pageName,
      columns,
      nextFigureId,
      nextPageId: nextPageDocumentId,
    });
    if (abort.signal.aborted) return;
    if (artifacts.figures.length === 0) {
      setPhase("review");
      setProgress(null);
      toast("No figures were created. Select at least one compatible dataset.", "danger");
      return;
    }
    if (downloadArchive) {
      try {
        await downloadBatchFigures(artifacts.figures, state.datasets, {
          format: exportFormat,
          style: exportStyle,
          dpi: Math.max(50, Math.min(1200, exportDpi)),
          archiveName: archiveName.trim() || `${recipeChoice.recipe.name} figures`,
        }, abort.signal);
      } catch (error) {
        setProgress(null);
        setPhase("review");
        if (error instanceof Error && error.name === "AbortError") {
          toast("Batch figure export cancelled.", "info");
        } else {
          toast(`Batch figure export failed: ${error instanceof Error ? error.message : String(error)}`, "danger");
        }
        return;
      }
    }
    if (abort.signal.aborted) return;
    const { pageOpened } = commitBatchFigureArtifacts(artifacts);
    if (recipeChoice.scope !== "built-in") {
      recordRecipeUse({ kind: "plot", scope: recipeChoice.scope, id: recipeChoice.recipe.id });
    }
    setProgress({ done: artifacts.figures.length, total: artifacts.figures.length, current: null });
    setResult({ figures: artifacts.figures.length, pages: artifacts.pages.map((page) => page.name), pageOpened, downloaded: downloadArchive });
    setPhase("done");
  };

  const stop = () => {
    controller.current?.abort();
    setProgress(null);
    setPhase(rows.length > 0 ? "review" : "idle");
  };

  return (
    <ToolWindow id="batch-figure-builder" title="Batch Figure Builder" width={780} x={180} y={80} onClose={onClose}>
      <div className="qzk-ds-meta">
        Repeat one Plot Recipe across several datasets. Quantized checks every mapping first; incompatible datasets are never silently dropped.
      </div>

      <label className="qzk-field">
        <span className="qzk-field-lbl">Plot Recipe</span>
        <Select
          aria-label="Plot Recipe"
          value={recipeKey}
          disabled={busy || choices.length === 0}
          onChange={(event) => { setRecipeKey(event.target.value); invalidate(); }}
          options={choices.map((choice) => ({
            value: choice.key,
            label: `${choice.recipe.name} — ${SCOPE_LABEL[choice.scope]}`,
          }))}
        />
      </label>
      {choices.length === 0 && <div style={{ color: "var(--danger)" }}>No Plot Recipes are available. Save one from a plot first.</div>}

      <div className="qzk-win-section">Datasets</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <Button size="sm" disabled={busy} onClick={() => { setDatasetIds(datasets.map((dataset) => dataset.id)); invalidate(); }}>Select all</Button>
        <Button size="sm" disabled={busy || datasetIds.length === 0} onClick={() => { setDatasetIds([]); invalidate(); }}>Clear</Button>
        <span className="qzk-ds-meta">{datasetIds.length} of {datasets.length} selected</span>
      </div>
      <div role="group" aria-label="Datasets to build" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4, maxHeight: 170, overflowY: "auto", padding: 6, border: "1px solid var(--border-soft)", borderRadius: 6 }}>
        {datasets.map((dataset) => (
          <Checkbox key={dataset.id} checked={selectedSet.has(dataset.id)} disabled={busy} onChange={(on) => toggleDataset(dataset.id, on)}>
            <span title={dataset.name} style={{ display: "inline-block", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>{dataset.name}</span>
            {dataset.workbookId && <span className="qzk-ds-meta"> · {workbookNames.get(dataset.workbookId) ?? "Workbook"}</span>}
          </Checkbox>
        ))}
        {datasets.length === 0 && <span className="qzk-ds-meta">Load datasets before building figures.</span>}
      </div>

      {phase === "idle" && (
        <Button variant="primary" disabled={!recipeChoice || datasetIds.length === 0} onClick={() => void checkCompatibility()}>
          Check compatibility
        </Button>
      )}
      {busy && progress && (
        <div aria-live="polite" className="qzk-ds-meta">
          {phase === "checking" ? "Checking" : "Creating"} {progress.done}/{progress.total}{progress.current ? ` — ${progress.current}` : ""}
          <progress aria-label="Batch Figure Builder progress" value={progress.done} max={Math.max(progress.total, 1)} style={{ width: "100%" }} />
          <Button size="sm" onClick={stop}>Stop</Button>
        </div>
      )}

      {(phase === "review" || phase === "creating" || phase === "done") && rows.length > 0 && (
        <>
          <div className="qzk-win-section">Compatibility review</div>
          <div style={{ maxHeight: 230, overflow: "auto" }}>
            <table className="qz-table" aria-label="Batch figure compatibility">
              <thead><tr><th>Build</th><th>Dataset</th><th>Status</th><th>Details</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.datasetId}>
                    <td>
                      <Checkbox
                        aria-label={`Build ${row.datasetName}`}
                        checked={includedIds.has(row.datasetId)}
                        disabled={busy || phase === "done" || row.status === "blocked"}
                        onChange={(on) => setIncludedIds((current) => {
                          const next = new Set(current);
                          if (on) next.add(row.datasetId); else next.delete(row.datasetId);
                          return next;
                        })}
                      />
                    </td>
                    <td>{row.datasetName}</td>
                    <td><Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge></td>
                    <td>
                      <div>{row.summary}</div>
                      {row.status === "partial" && !includedIds.has(row.datasetId) && <div className="qzk-ds-meta">Check Build to explicitly accept a partial figure.</div>}
                      {row.unmatched.length > 0 && <div className="qzk-ds-meta" title={row.unmatched.join("; ")}>Missing: {row.unmatched.join("; ")}</div>}
                      {row.warnings.length > 0 && <div className="qzk-ds-meta" title={row.warnings.join("; ")}>Warnings: {row.warnings.join("; ")}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(phase === "review" || phase === "creating") && (
        <>
          <div className="qzk-win-section">Output</div>
          <label className="qzk-field">
            <span className="qzk-field-lbl">Figure names</span>
            <input className="qz-input" value={namePattern} disabled={busy} onChange={(event) => setNamePattern(event.target.value)} aria-label="Figure name pattern" />
            <span className="qzk-ds-meta">Use {"{dataset}"} and {"{recipe}"}. Existing names are numbered, never overwritten.</span>
          </label>
          <Checkbox checked={createPage} disabled={busy} onChange={setCreatePage}>Also create an editable multi-panel Figure Page</Checkbox>
          {createPage && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 160px", gap: 8 }}>
              <label className="qzk-field"><span className="qzk-field-lbl">Page name</span><input className="qz-input" value={pageName} disabled={busy} onChange={(event) => setPageName(event.target.value)} /></label>
              <label className="qzk-field"><span className="qzk-field-lbl">Columns</span><Select value={String(columns)} disabled={busy} onChange={(event) => setColumns(event.target.value === "auto" ? "auto" : Number(event.target.value))} options={[{ value: "auto", label: "Automatic" }, ...[1, 2, 3, 4].map((value) => ({ value: String(value), label: String(value) }))]} /></label>
            </div>
          )}
          <Checkbox checked={downloadArchive} disabled={busy} onChange={setDownloadArchive}>
            Also download one ZIP of publication figures
          </Checkbox>
          {downloadArchive && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) repeat(3, 120px)", gap: 8 }}>
              <label className="qzk-field"><span className="qzk-field-lbl">Archive name</span><input className="qz-input" value={archiveName} placeholder={`${recipeChoice?.recipe.name ?? "Batch"} figures`} disabled={busy} onChange={(event) => setArchiveName(event.target.value)} /></label>
              <label className="qzk-field"><span className="qzk-field-lbl">Format</span><Select value={exportFormat} disabled={busy} onChange={(event) => setExportFormat(event.target.value as (typeof EXPORT_FORMATS)[number])} options={EXPORT_FORMATS.map((value) => ({ value, label: value.toUpperCase() }))} /></label>
              <label className="qzk-field"><span className="qzk-field-lbl">Style</span><Select value={exportStyle} disabled={busy} onChange={(event) => setExportStyle(event.target.value)} options={EXPORT_STYLES.map((value) => ({ value, label: value }))} /></label>
              <label className="qzk-field"><span className="qzk-field-lbl">DPI</span><input className="qz-input" type="number" min={50} max={1200} value={exportDpi} disabled={busy || exportFormat === "pdf" || exportFormat === "svg"} onChange={(event) => setExportDpi(Number(event.target.value) || 300)} /></label>
            </div>
          )}
          {downloadArchive && includedIds.size > MAX_BATCH_FIGURE_EXPORT && (
            <div style={{ color: "var(--danger)" }}>A ZIP archive supports at most {MAX_BATCH_FIGURE_EXPORT} figures. Uncheck some datasets or turn off ZIP export.</div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <Button onClick={() => void checkCompatibility()} disabled={busy}>Check again</Button>
            <Button variant="primary" onClick={() => void build()} disabled={busy || includedIds.size === 0 || (downloadArchive && includedIds.size > MAX_BATCH_FIGURE_EXPORT)}>Create {includedIds.size} figure{includedIds.size === 1 ? "" : "s"}</Button>
          </div>
        </>
      )}

      {phase === "done" && result && (
        <div role="status" style={{ border: "1px solid var(--ok)", borderRadius: 6, padding: 10 }}>
          Created {result.figures} editable figure{result.figures === 1 ? "" : "s"}{result.pages.length === 1 ? result.pageOpened ? ` and opened Figure Page “${result.pages[0]}”.` : ` and saved Figure Page “${result.pages[0]}” in the Library. Your already-open page was left unchanged.` : result.pages.length > 1 ? result.pageOpened ? ` and ${result.pages.length} Figure Pages. The first page is open; the rest are saved in the Library.` : ` and ${result.pages.length} Figure Pages in the Library. Your already-open page was left unchanged.` : "."}{result.downloaded ? " The publication-file ZIP was downloaded." : ""}
          <div style={{ marginTop: 8 }}><Button variant="primary" onClick={onClose}>Done</Button></div>
        </div>
      )}
    </ToolWindow>
  );
}
