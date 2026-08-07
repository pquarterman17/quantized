// Panel-source resolution + single-panel spec-building for the Figure Page
// composer (GOTO #4). Extracted out of useFigurePage.ts (FIGURE_AUTHORING_
// WORKFLOW_PLAN F3.4 size discipline: the hook had grown to 736 lines, flagged
// but not acted on by F3.3's log) — these are pure/module-level functions with
// no React state of their own; they read the store fresh via `useApp.getState()`
// or take an explicit `AppState` snapshot, exactly like they did inline. Moving
// them changes nothing about behavior, only where the code lives.

import {
  type FigureSpec,
  type PagePanelSpec,
} from "../../../lib/api";
import { buildExportStyles } from "../../../lib/exportStyles";
import type { FigureDocument } from "../../../lib/figureDocument";
import type { FigureOverrides } from "../../../lib/figureOverrides";
import { buildFigureSpecFromDocument } from "../../../lib/figureSpec";
import type { PanelSource } from "../../../lib/figurepage";
import { axisFmtParam, type DataStruct } from "../../../lib/types";
import { type PlotView, type PlotWindow } from "../../../lib/plotview";
import { useApp, type AppState } from "../../../store/useApp";

// PagePanelSpec is re-exported here only so callers that import panelFigure's
// return-adjacent types don't need a second import line; buildSpec (still in
// useFigurePage.ts) is the only real consumer today.
export type { PagePanelSpec };

/** Resolve one assigned session source to the canonical FigureDocument id a
 *  persisted PageDocument panel would reference (F3.2: reference, don't
 *  flatten). A "figdoc" source is a legacy FigureDoc — F1 never gave it a
 *  FigureDocument counterpart, so it has no representable id yet (and never
 *  will, until it is explicitly converted to an editable copy). A "window"
 *  source resolves only once its document has actually been SAVED (present
 *  in `editableFigures`); an open-but-unsaved window's figure isn't
 *  reachable from a reopened page either, so it resolves to null rather than
 *  pretending a transient id is durable. A "figure" source (F3.3: a saved
 *  figure picked directly, or a reopened page's own hydrated panel) already
 *  IS a canonical id — pass it through UNCONDITIONALLY, even if the figure
 *  has since been deleted from `editableFigures`: Save must persist that
 *  reference as-is so it resolves through `resolvePagePanel` to "missing" on
 *  its next read (F3.2's fail-closed contract), the same as any other
 *  dangling reference, rather than silently emptying the panel. */
export function resolveSlotFigureId(
  source: PanelSource | null,
  plotWindows: readonly PlotWindow[],
  editableFigures: readonly FigureDocument[],
): string | null {
  if (!source) return null;
  if (source.kind === "figure") return source.id;
  if (source.kind === "figdoc") return null;
  const win = plotWindows.find((w) => w.id === source.id);
  const documentId = win && win.kind === "plot" ? win.document?.id : undefined;
  return documentId && editableFigures.some((figure) => figure.id === documentId) ? documentId : null;
}

/** x_breaks / margins are single-figure-only (the page composer rejects them
 *  with a 422) — strip them from a saved override bag, keeping everything
 *  else. Shared by the "figdoc" and "figure" (F3.3) panel-source branches
 *  below, both of which embed a document's saved overrides into a panel. */
export function stripPageIncompatibleOverrides(
  saved: FigureOverrides | null | undefined,
): FigureOverrides | undefined {
  const { x_breaks: _xb, margins: _mg, ...overrides } = saved ?? {};
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

/** Resolve one panel source into the single-figure payload the page route
 *  embeds. Reads through the store at call time: `windowsForSave()` so the
 *  FOCUSED window's live view is captured, `resolveDataset` so a pending
 *  (preview-only) dataset never exports small (#38 discipline). Returns null
 *  when the source can no longer render (window unbound, doc dataset gone,
 *  or — F3.3's "figure" kind — the referenced editableFigures entry is gone,
 *  its live dataset is unavailable, or its FigureDocument->FigureSpec adapter
 *  rejects the document, e.g. a grouped figure with a secondary axis). */
export async function panelFigure(source: PanelSource): Promise<FigureSpec | null> {
  const s = useApp.getState();
  if (source.kind === "figure") {
    const document = s.editableFigures.find((f) => f.id === source.id);
    if (!document) return null;
    if (document.data.mode === "live" && !document.bindings.datasetId) return null;
    const dataset =
      document.data.mode === "live" && document.bindings.datasetId
        ? await s.resolveDataset(document.bindings.datasetId)
        : undefined;
    if (document.data.mode === "live" && !dataset) return null;
    // F1.5's reversible FigureDocument -> FigureSpec adapter — the SAME path
    // Publication Preview's export/copy uses, so a page panel sourced from a
    // saved figure renders identically to opening that figure on its own.
    // It can throw (no visible series, a dataset mismatch, an unsupported
    // grouped+secondary-axis combination) — any such failure is exactly a
    // "this source can no longer render" case, same as a dead window/figdoc.
    try {
      const spec = buildFigureSpecFromDocument(document, dataset, document.name);
      return { ...spec, overrides: stripPageIncompatibleOverrides(spec.overrides) };
    } catch {
      return null;
    }
  }
  if (source.kind === "window") {
    const win = s.windowsForSave().find((w) => w.id === source.id);
    if (!win || win.kind !== "plot" || !win.datasetId) return null;
    const ds = await s.resolveDataset(win.datasetId);
    if (!ds) return null;
    const v = win.view;
    const plotted = v.yKeys ?? ds.data.labels.map((_, i) => i);
    return {
      dataset: ds.data,
      x_key: v.xKey ?? undefined,
      y_keys: v.yKeys ?? undefined,
      x_log: v.xScale === "log",
      y_log: v.yScale === "log",
      x_scale: v.xScale,
      y_scale: v.yScale,
      x_fmt: axisFmtParam(v.xFmt),
      y_fmt: axisFmtParam(v.yFmt),
      x_step: v.xStep,
      y_step: v.yStep,
      title: v.plotTitle.trim(),
      x_label: v.xAxisLabel.trim() || undefined,
      y_label: v.yAxisLabel.trim() || undefined,
      series_styles: buildExportStyles(plotted, v.seriesStyles),
    };
  }
  const doc = s.figureDocs.find((d) => d.id === source.id);
  if (!doc) return null;
  let data: DataStruct | undefined;
  if (doc.live) {
    data = doc.datasetId ? (await s.resolveDataset(doc.datasetId))?.data : undefined;
  } else {
    data = doc.dataSnapshot;
  }
  if (!data) return null;
  const c = doc.config;
  // MAIN #24: FigureConfig (a saved Library figure) doesn't persist a tick
  // format at all -- unlike xScale/yScale, this predates the feature, so
  // there is no saved xFmt/yFmt to restore here; a doc-sourced panel exports
  // at the backend's default ("auto") until FigureConfig grows the field.
  return {
    dataset: data,
    x_key: c.xKey ?? undefined,
    y_keys: c.yKeys ?? undefined,
    x_log: c.xScale === "log",
    y_log: c.yScale === "log",
    x_scale: c.xScale,
    y_scale: c.yScale,
    title: c.title.trim(),
    x_label: c.xLabel.trim() || undefined,
    y_label: c.yLabel.trim() || undefined,
    series_styles: c.seriesStyles ?? undefined,
    overrides: stripPageIncompatibleOverrides(c.overrides),
  };
}

/** Preview invalidation (MAIN #8g): the flattened store inputs the assigned
 *  panels render from — EXACTLY the state `panelFigure` reads through the
 *  store (keep the two in sync), flattened so `useShallow` can compare it.
 *  Keying the preview effect on this re-renders the on-screen preview when
 *  the state under a slot changes (dataset corrected/recomputed, view
 *  edited, window closed/unbound, saved figure edited/deleted) and ONLY
 *  then — unrelated store churn (window moves/z, other datasets, selection)
 *  leaves the array shallow-equal and never re-fetches. This is the preview
 *  half of buildSpec's export-time guard (review 2026-07-11), which re-reads
 *  the same store state at export time.
 *
 *  F3.4: the "figure" branch already tracks the document OBJECT (not just
 *  its id) — every store action that edits a saved editableFigures entry
 *  (`saveFigure`, Save As, rename, `applyFigurePublicationEdit` for a
 *  "new-editable" target, `duplicateEditableFigure`) replaces it with a new
 *  reference via `.map()`/spread, never mutates in place, so this dependency
 *  correctly picks up an edit-then-save without any change here — verified
 *  by a characterization test in useFigurePage.test.ts rather than assumed. */
export function panelRenderInputs(slots: { source: PanelSource | null }[], s: AppState): unknown[] {
  const parts: unknown[] = [];
  for (const { source } of slots) {
    if (!source) continue;
    if (source.kind === "window") {
      const win = s.plotWindows.find((w) => w.id === source.id);
      if (!win || win.kind !== "plot" || !win.datasetId) {
        parts.push("gone"); // dead source — re-render so the guard surfaces it
        continue;
      }
      // The FOCUSED window's record view is stale (store/windows.ts): its
      // live view rides the top-level singleton fields — the same swap
      // windowsForSave() makes for panelFigure. Only the view fields the
      // panel payload serializes matter (xLim/zoom etc. deliberately don't).
      const v: PlotView = win.id === s.focusedWindowId ? s : win.view;
      parts.push(
        win.datasetId,
        s.datasets.find((d) => d.id === win.datasetId)?.data,
        v.xKey,
        v.yKeys,
        v.xScale,
        v.yScale,
        v.xFmt,
        v.yFmt,
        v.plotTitle,
        v.xAxisLabel,
        v.yAxisLabel,
        v.seriesStyles,
      );
    } else if (source.kind === "figure") {
      // F3.3: mirrors the figdoc branch below — the document itself is
      // immutable (any edit replaces the reference), plus its live dataset.
      const document = s.editableFigures.find((f) => f.id === source.id);
      if (!document) {
        parts.push("gone");
        continue;
      }
      parts.push(
        document,
        document.data.mode === "live" && document.bindings.datasetId
          ? s.datasets.find((d) => d.id === document.bindings.datasetId)?.data
          : null,
      );
    } else {
      const doc = s.figureDocs.find((d) => d.id === source.id);
      if (!doc) {
        parts.push("gone");
        continue;
      }
      parts.push(
        doc, // records are immutable — any config/name edit replaces it
        doc.live && doc.datasetId
          ? s.datasets.find((d) => d.id === doc.datasetId)?.data
          : null,
      );
    }
  }
  return parts;
}
