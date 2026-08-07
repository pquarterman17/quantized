// Panel-source resolution + single-panel spec-building for the Figure Page
// composer (GOTO #4). Extracted out of useFigurePage.ts (FIGURE_AUTHORING_
// WORKFLOW_PLAN F3.4 size discipline: the hook had grown to 736 lines, flagged
// but not acted on by F3.3's log) — these are pure/module-level functions with
// no React state of their own; they read the store fresh via `useApp.getState()`
// or take an explicit `AppState` snapshot, exactly like they did inline. Moving
// them changes nothing about behavior, only where the code lives.
//
// F3.6 "unified export from PageDocument": `panelFigure`'s "window" branch
// used to hand-assemble a REDUCED FigureSpec from a handful of PlotView
// fields (x/y key, scale, fmt, step, title, labels, series styles only) —
// exactly the "parallel ad-hoc spec assembly" the plan calls out, and a real
// fidelity gap: every open plot window has carried a canonical FigureDocument
// since F1 (`PlotWindow.document`, kept in sync by `syncPlotWindow`), so the
// reduced spec was silently dropping error bars, secondary-axis state,
// grouping, axis breaks, and publication overrides that the SAME window
// would export/copy/preview correctly once saved+reopened as a "figure"-kind
// panel. It now resolves through the exact same `buildFigureSpecFromDocument`
// adapter the "figure" branch already uses, so a window-sourced panel and its
// post-save "figure"-sourced reincarnation render identically — the round-
// trip property the F3 exit criterion names ("save -> close -> reopen ->
// export retains every ... visual setting"). The "figdoc" (legacy
// Publication figure) branch is UNCHANGED: F1 never gave that kind a
// FigureDocument counterpart at all (F3.1's log), so there is no canonical
// adapter to route it through — a pre-existing, already-documented gap this
// slice does not close.
//
// F3.6 also adds `buildPageSpecFromDocument`: the same resolve-and-build path
// applied to a SAVED `PageDocument` directly (Library "Export…"), so a page
// can be exported without reopening it into the workshop session.

import {
  type FigureSpec,
  type PagePanelSpec,
} from "../../../lib/api";
import type { FigurePageSpec } from "../../../lib/api/figurePage";
import type { FigureDocument } from "../../../lib/figureDocument";
import type { FigureOverrides } from "../../../lib/figureOverrides";
import { buildFigureSpecFromDocument } from "../../../lib/figureSpec";
import type { PanelSource } from "../../../lib/figurepage";
import {
  pagePanelLabels,
  resolvePagePanel,
  type PageDocument,
} from "../../../lib/pageDocument";
import type { DataStruct } from "../../../lib/types";
import { type PlotWindow } from "../../../lib/plotview";
import { useApp, type AppState } from "../../../store/useApp";

// PagePanelSpec is re-exported here only so callers that import panelFigure's
// return-adjacent types don't need a second import line; buildSpec (still in
// useFigurePage.ts, now via usePagePreviewExport.ts) is the only real
// consumer today.
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
    // F3.6: route through the SAME canonical adapter the "figure" branch
    // above uses, via the window's own bound FigureDocument (`win.document`
    // — every real window has one since F1; `windowsForSave()` also
    // freshens the FOCUSED window's document from its live view, mirroring
    // what it already does for `.view`). This closes the fidelity gap a
    // hand-assembled PlotView-only spec had (see the module header).
    const win = s.windowsForSave().find((w) => w.id === source.id);
    if (!win || win.kind !== "plot" || !win.document) return null;
    const document = win.document;
    // A window's document is always "live" (frozen documents belong to
    // kind:"snapshot" windows, which are never a page source) — it always
    // needs its bound dataset.
    const dataset = document.bindings.datasetId
      ? await s.resolveDataset(document.bindings.datasetId)
      : undefined;
    if (!dataset) return null;
    try {
      const spec = buildFigureSpecFromDocument(document, dataset, document.name);
      return { ...spec, overrides: stripPageIncompatibleOverrides(spec.overrides) };
    } catch {
      return null;
    }
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
 *  F3.4/F3.6: the "figure" branch, and a NON-focused "window" branch, both
 *  track the DOCUMENT OBJECT (not just an id) — every store action that
 *  edits a saved editableFigures entry (`saveFigure`, Save As, rename,
 *  `applyFigurePublicationEdit` for a "new-editable" target,
 *  `duplicateEditableFigure`) replaces it with a new reference via
 *  `.map()`/spread, never mutates in place, and `syncPlotWindow` does the
 *  same for a window's own `.document` on every COMMITTED edit — so this
 *  dependency picks up any such change without maintaining a parallel field
 *  list. The FOCUSED window is deliberately different: its `.document` is
 *  stale until the edit commits (the live state rides the top-level
 *  singleton fields instead — see `windowsForSave()`'s doc), and calling
 *  `windowsForSave()` HERE to freshen it would be wrong even though
 *  `panelFigure` safely calls it at render/export time: this function runs
 *  inside a `useShallow` selector, which React's `useSyncExternalStore` may
 *  invoke several times per commit to verify a stable snapshot;
 *  `windowsForSave()` reconstructs the focused window's document via
 *  `structuredClone` on every call, so two calls in the same tick are never
 *  `===`, and React logs "getSnapshot should be cached" then loops until
 *  "Maximum update depth exceeded" (verified — this was the fix's own first,
 *  failing attempt). The focused branch below instead lists the live
 *  singleton fields directly (stable object/primitive references that only
 *  change when the store actually changes) — the same shape the pre-F3.6
 *  code used, extended with the fields the canonical adapter now also reads
 *  (error bindings, hidden/reordered series, secondary axis). */
export function panelRenderInputs(slots: { source: PanelSource | null }[], s: AppState): unknown[] {
  const parts: unknown[] = [];
  for (const { source } of slots) {
    if (!source) continue;
    if (source.kind === "window") {
      const win = s.plotWindows.find((w) => w.id === source.id);
      if (!win || win.kind !== "plot" || !win.document) {
        parts.push("gone"); // dead source — re-render so the guard surfaces it
        continue;
      }
      if (win.id === s.focusedWindowId) {
        parts.push(
          win.datasetId,
          s.datasets.find((d) => d.id === win.datasetId)?.data,
          s.xKey,
          s.yKeys,
          s.xScale,
          s.yScale,
          s.xFmt,
          s.yFmt,
          s.xStep,
          s.yStep,
          s.plotTitle,
          s.xAxisLabel,
          s.yAxisLabel,
          s.seriesStyles,
          s.errKeys,
          s.hiddenChannels,
          s.seriesOrder,
          s.y2Keys,
          s.y2Lim,
          s.y2Scale,
          s.y2Step,
          s.y2AxisLabel,
        );
      } else {
        parts.push(
          win.document,
          win.document.bindings.datasetId
            ? s.datasets.find((d) => d.id === win.document?.bindings.datasetId)?.data
            : null,
        );
      }
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

/** F3.6 "export a saved page without reopening it": resolve a SAVED
 *  `PageDocument` directly into the page route's spec (sans fmt/dpi — the
 *  caller's own choice, same convention as `buildSpec`'s session
 *  equivalent), without hydrating a workshop session first. Reuses the exact
 *  `resolvePagePanel`/`buildFigureSpecFromDocument` path a reopened session's
 *  "figure"-kind panels already resolve through (F3.3), so a Library
 *  "Export…" action produces the SAME output opening the page would.
 *
 *  Fail-closed (F3.2): a "missing" panel (a dangling `figureId`) or a figure
 *  whose adapter rejects it (dataset gone, unsupported grouped+secondary-axis
 *  combination) throws naming the panel's own previewed label, rather than
 *  silently skipping it and exporting a smaller page. Returns null only when
 *  every panel is genuinely empty (nothing to export). */
export async function buildPageSpecFromDocument(
  pageDoc: PageDocument,
  figures: readonly FigureDocument[],
): Promise<FigurePageSpec | null> {
  const labels = pagePanelLabels(pageDoc.panels, pageDoc.output.labelFormat);
  const panels: PagePanelSpec[] = [];
  for (let i = 0; i < pageDoc.panels.length; i++) {
    const panel = pageDoc.panels[i];
    const resolution = resolvePagePanel(panel, figures);
    if (resolution.status === "empty") continue;
    const label = labels[i] || `#${i + 1}`;
    if (resolution.status === "missing") {
      throw new Error(`panel ${label}: referenced figure no longer exists — open the page to clear or reassign it`);
    }
    const document = resolution.figure;
    const dataset =
      document.data.mode === "live" && document.bindings.datasetId
        ? await useApp.getState().resolveDataset(document.bindings.datasetId)
        : undefined;
    if (document.data.mode === "live" && !dataset) {
      throw new Error(`panel ${label}: "${document.name}" is missing its dataset — open the page to clear or reassign it`);
    }
    let figure: FigureSpec;
    try {
      const spec = buildFigureSpecFromDocument(document, dataset, document.name);
      figure = { ...spec, overrides: stripPageIncompatibleOverrides(spec.overrides) };
    } catch (e) {
      throw new Error(
        `panel ${label}: "${document.name}" can't be rendered — ${e instanceof Error ? e.message : "error"}`,
      );
    }
    panels.push({
      figure,
      row: Math.floor(i / pageDoc.cols),
      col: i % pageDoc.cols,
      ...(panel.label !== null ? { label: panel.label } : {}),
      ...(panel.title !== null ? { title: panel.title } : {}),
    });
  }
  if (panels.length === 0) return null;
  return {
    rows: pageDoc.rows,
    cols: pageDoc.cols,
    panels,
    style: pageDoc.output.stylePreset,
    label_format: pageDoc.output.labelFormat,
    label_pos: pageDoc.output.labelPos,
    row_gap: pageDoc.layout.rowGap,
    col_gap: pageDoc.layout.colGap,
    link_x: pageDoc.layout.linkX,
    link_y: pageDoc.layout.linkY,
    align_labels: pageDoc.layout.alignLabels,
    resize_mode: pageDoc.layout.resizeMode,
  };
}
