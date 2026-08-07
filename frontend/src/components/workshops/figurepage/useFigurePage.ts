// Figure page composer state hook (GOTO #4). Holds the page grid (rows x
// cols of slots), the panel sources assigned into them (open plot windows
// and/or saved Library figures), the page-level options (style preset,
// label format/position, export format + DPI), drives a debounced
// server-rendered low-DPI PNG preview, and exports through the same
// /api/export/figure-page route (vector PDF by default). The heavy
// composition is the matplotlib route — this is a thin WYSIWYG layer on it,
// the figure-builder pattern applied to N panels.
//
// FIGURE_AUTHORING_WORKFLOW_PLAN F3.1: the grid geometry + output settings
// are held as one PageDocument draft (lib/pageDocument.ts) instead of loose
// parallel useStates, and `pageDocument` exposes the full persistable
// projection (panels resolved to canonical FigureDocument ids where
// possible).
//
// F3.3: Save/Save As now write that projection into the store's `pages`
// library (store/pageDocuments.ts), and a saved page can be reopened
// (`store.openPageDocument` seeds `pageDocSeed`; the effect below consumes it
// once, mirroring `figureDocSeed`'s pattern for the figure builder). A saved
// PageDocument panel only ever references a canonical `editableFigures` id
// (F3.1/F3.2's "reference, never flatten" contract), so reopening hydrates
// every occupied panel to a NEW session source kind, "figure" — a saved
// figure picked directly, distinct from "window" (an open plot window) and
// "figdoc" (a legacy Publication figure). Save is refused, with a specific
// per-slot reason, whenever a FILLED slot has no canonical figureId yet
// (an open-but-unsaved window, or a figdoc that can never resolve) — saving
// anyway would silently persist `figureId: null`, i.e. drop the panel, the
// exact failure F3.2 exists to prevent.

import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  exportFigurePage,
  renderFigurePageBlob,
  type FigurePageSpec,
  type FigureSpec,
  type PagePanelSpec,
} from "../../../lib/api";
import { buildExportStyles } from "../../../lib/exportStyles";
import { docRenderable } from "../../../lib/figuredoc";
import type { FigureDocument } from "../../../lib/figureDocument";
import { buildFigureSpecFromDocument } from "../../../lib/figureSpec";
import type { FigureOverrides } from "../../../lib/figureOverrides";
import {
  PAGE_MAX_GRID,
  assignSlot,
  clearSlot,
  emptySlots,
  filledCount,
  patchSlot,
  resizeSlots,
  resolvePanelSource,
  slotLabels,
  type PageLabelFormat,
  type PageLabelPosition,
  type PageSlot,
  type PanelSource,
  type PanelSourceStatus,
} from "../../../lib/figurepage";
import {
  createPageDocument,
  pageDocumentDirty,
  pageDocumentHasUnsavedEdits,
  type PageDocument,
  type PagePanel,
} from "../../../lib/pageDocument";
import { displayedWindowTitle, type PlotView, type PlotWindow } from "../../../lib/plotview";
import { axisFmtParam, type DataStruct } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useApp, type AppState } from "../../../store/useApp";
import { askConfirm } from "../../overlays/ConfirmDialog";
import { FIGURE_STYLE_DPI } from "../figurebuilder/useFigureBuilder";

// F3.3: a FRESH id per mount (never a shared literal) — this hook has at most
// one page open at a time (mirrors Publication Preview's one-session rule),
// but `savePage` upserts `pages` BY ID, so two DIFFERENT never-saved sessions
// sharing one constant id would make the second session's first Save
// silently overwrite whatever the first session had already saved under it.
// A per-mount counter costs nothing and closes that hole outright.
let _draftSeq = 0;
const nextDraftId = (): string => `figurepage-draft-${Date.now().toString(36)}-${++_draftSeq}`;

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
function resolveSlotFigureId(
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

const PREVIEW_DPI = 90; // screen-resolution page preview; export uses the chosen DPI

/** Blob -> data: URL (FileReader, jsdom-safe — no URL.createObjectURL). */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("preview read failed"));
    r.readAsDataURL(blob);
  });
}

/** x_breaks / margins are single-figure-only (the page composer rejects them
 *  with a 422) — strip them from a saved override bag, keeping everything
 *  else. Shared by the "figdoc" and "figure" (F3.3) panel-source branches
 *  below, both of which embed a document's saved overrides into a panel. */
function stripPageIncompatibleOverrides(
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
async function panelFigure(source: PanelSource): Promise<FigureSpec | null> {
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
 *  the same store state at export time. */
function panelRenderInputs(slots: PageSlot[], s: AppState): unknown[] {
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

export function useFigurePage() {
  const plotWindows = useApp((s) => s.plotWindows);
  const datasets = useApp((s) => s.datasets);
  const figureDocs = useApp((s) => s.figureDocs);
  const editableFigures = useApp((s) => s.editableFigures);
  const setStatus = useApp((s) => s.setStatus);
  const pages = useApp((s) => s.pages);
  const pageDocSeed = useApp((s) => s.pageDocSeed);
  const clearPageDocSeed = useApp((s) => s.clearPageDocSeed);

  // F3.1: the grid geometry + output settings live in ONE PageDocument draft
  // (lib/pageDocument.ts) instead of loose parallel useStates — rows/cols/
  // style/fmt/dpi/label format+position are all `draft` fields now; `panels`
  // is resolved separately below (see `pageDocument`) since a session source
  // can reference a still-unsaved window, which a persisted document can't.
  const [draft, setDraft] = useState<PageDocument>(() => createPageDocument({ id: nextDraftId(), name: "Untitled page" }));
  const rows = draft.rows;
  const cols = draft.cols;
  const labelFormat = draft.output.labelFormat;
  const labelPos = draft.output.labelPos;
  const style = draft.output.stylePreset;
  const fmt = draft.output.format;
  const dpi = draft.output.dpi;

  const [slots, setSlots] = useState<PageSlot[]>(() => emptySlots(2, 2));
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The full persistable draft (F3.1): `draft`'s geometry/output plus each
   *  slot's session source resolved to a canonical FigureDocument id where
   *  possible. This is what F3.3's eventual Save writes into `pages`. */
  const pageDocument = useMemo<PageDocument>(
    () => ({
      ...draft,
      panels: slots.map((slot): PagePanel => ({
        figureId: resolveSlotFigureId(slot.source, plotWindows, editableFigures),
        label: slot.label,
        title: slot.title,
      })),
    }),
    [draft, slots, plotWindows, editableFigures],
  );

  const datasetIds = useMemo(() => new Set(datasets.map((dataset) => dataset.id)), [datasets]);

  // Panel sources: open (live, dataset-bound) plot windows + renderable
  // saved Library figures. Snapshot/worksheet/map windows are not plots.
  const windowSources = useMemo<PanelSource[]>(
    () =>
      plotWindows
        .filter((w) => w.kind === "plot" && w.datasetId !== null)
        .map((w) => ({ kind: "window", id: w.id, name: displayedWindowTitle(w, datasets) })),
    [plotWindows, datasets],
  );
  const docSources = useMemo<PanelSource[]>(
    () =>
      figureDocs
        .filter((document) => docRenderable(document, datasetIds))
        .map((document) => ({ kind: "figdoc", id: document.id, name: document.name })),
    [figureDocs, datasetIds],
  );
  // F3.3: saved canonical figures, pickable directly (not just via an open
  // window that happens to have been saved) — also how a reopened page's
  // panels are named once hydrated (see the pageDocSeed effect below). Only
  // renderable ones are offered, mirroring docSources' docRenderable filter
  // (the same "ok" test resolvePanelSource applies once assigned).
  const figureSources = useMemo<PanelSource[]>(
    () =>
      editableFigures
        .filter((document) =>
          document.data.mode === "live"
            ? document.bindings.datasetId !== null && datasetIds.has(document.bindings.datasetId)
            : document.data.snapshot !== undefined,
        )
        .map((document) => ({ kind: "figure", id: document.id, name: document.name })),
    [editableFigures, datasetIds],
  );

  /** Per-slot preview labels (auto sequence in row-major order, overrides win). */
  const labels = useMemo(() => slotLabels(slots, labelFormat), [slots, labelFormat]);

  /** Per-slot LIVE status (F3.2): re-checked every render against the current
   *  session state, so a source that dies (window closed, figdoc deleted, its
   *  dataset removed) while assigned is reported "missing" instead of
   *  silently keeping the stale cached name on display — see
   *  lib/figurepage.ts's `resolvePanelSource` for the fail-closed contract. */
  const sourceStatuses = useMemo<PanelSourceStatus[]>(
    () =>
      slots.map((slot) =>
        resolvePanelSource(slot.source, plotWindows, figureDocs, datasetIds, editableFigures),
      ),
    [slots, plotWindows, figureDocs, datasetIds, editableFigures],
  );

  // #8g: the store state the assigned panels render from (see
  // panelRenderInputs) — useShallow keeps the reference stable until one of
  // those inputs actually changes, so it can key the preview effect below.
  const renderInputs = useApp(useShallow((s) => panelRenderInputs(slots, s)));

  function setGrid(nextRows: number, nextCols: number): void {
    const r = Math.max(1, Math.min(PAGE_MAX_GRID, Math.round(nextRows)));
    const c = Math.max(1, Math.min(PAGE_MAX_GRID, Math.round(nextCols)));
    setSlots((prev) => resizeSlots(prev, cols, r, c));
    setDraft((prev) => ({ ...prev, rows: r, cols: c }));
    setSelected(null);
  }

  /** Style preset change re-syncs DPI to that preset's calibrated value
   *  (same convention as the figure builder); manual overrides stick after. */
  function setStyle(next: string): void {
    const presetDpi = FIGURE_STYLE_DPI[next];
    setDraft((prev) => ({
      ...prev,
      output: { ...prev.output, stylePreset: next, ...(presetDpi !== undefined ? { dpi: presetDpi } : {}) },
    }));
  }

  function setFmt(next: string): void {
    setDraft((prev) => ({ ...prev, output: { ...prev.output, format: next } }));
  }

  function setDpi(next: number): void {
    setDraft((prev) => ({ ...prev, output: { ...prev.output, dpi: next } }));
  }

  function setLabelFormat(next: PageLabelFormat): void {
    setDraft((prev) => ({ ...prev, output: { ...prev.output, labelFormat: next } }));
  }

  function setLabelPos(next: PageLabelPosition): void {
    setDraft((prev) => ({ ...prev, output: { ...prev.output, labelPos: next } }));
  }

  function assign(i: number, source: PanelSource): void {
    setSlots((prev) => assignSlot(prev, i, source));
    setSelected(i);
  }

  /** Click a source: fill the selected slot, else the first empty one. */
  function assignToNext(source: PanelSource): void {
    const target = selected !== null ? selected : slots.findIndex((s) => s.source === null);
    if (target < 0) return;
    assign(target, source);
  }

  function clear(i: number): void {
    setSlots((prev) => clearSlot(prev, i));
  }

  function setSlotLabel(i: number, label: string | null): void {
    setSlots((prev) => patchSlot(prev, i, { label }));
  }

  function setSlotTitle(i: number, title: string | null): void {
    setSlots((prev) => patchSlot(prev, i, { title }));
  }

  function setName(next: string): void {
    setDraft((prev) => ({ ...prev, name: next }));
  }

  // F3.3: reopen a saved page. `store.openPageDocument` seeds `pageDocSeed`;
  // this effect consumes it ONCE — mirrors useFigureBuilder.ts's own
  // `figureDocSeed` effect exactly, including its "unconditionally overwrite
  // the current session" behavior (opening a different page while this one
  // is unsaved is treated the same as switching documents in the figure
  // builder, not a new confirm surface — the close-confirm gate below covers
  // discarding via the WINDOW's close button). A saved PageDocument panel
  // only ever holds a canonical figureId (F3.1/F3.2), so every occupied panel
  // hydrates to a "figure" source; a dangling figureId (its figure was since
  // deleted) still gets a slot — it keeps its place on the grid and surfaces
  // through sourceStatuses/SlotGrid as "missing", never silently dropped.
  useEffect(() => {
    if (!pageDocSeed) return;
    const figures = useApp.getState().editableFigures;
    setDraft(pageDocSeed);
    setSlots(
      pageDocSeed.panels.map((panel): PageSlot => ({
        source: panel.figureId
          ? {
              kind: "figure",
              id: panel.figureId,
              name: figures.find((f) => f.id === panel.figureId)?.name ?? "deleted figure",
            }
          : null,
        label: panel.label,
        title: panel.title,
      })),
    );
    setSelected(null);
    clearPageDocSeed();
  }, [pageDocSeed, clearPageDocSeed]);

  /** F3.3: FILLED slots that would be silently dropped (`figureId: null`) if
   *  saved right now — an open plot window never saved as an editable
   *  figure, or a legacy Publication figure (F1 never gave that kind a
   *  FigureDocument counterpart, so it can never resolve). A "figure" source
   *  is NEVER listed here even if its target was since deleted: it already
   *  carries a real id, so Save persists that reference as-is (F3.2 fail-
   *  closed) rather than needing to block. Each entry names its slot's
   *  PREVIEWED label (matching what the user sees on the grid) and a
   *  specific, actionable next step — reusing the existing save/promote
   *  mechanisms (F1.4's per-window Save, and "Editable" copy-conversion)
   *  rather than inventing a new one. */
  const unresolvedSlots = useMemo(() => {
    const out: string[] = [];
    slots.forEach((slot, i) => {
      if (!slot.source) return;
      if (resolveSlotFigureId(slot.source, plotWindows, editableFigures) !== null) return;
      const label = labels[i] || `#${i + 1}`;
      out.push(
        slot.source.kind === "window"
          ? `slot ${label}: "${slot.source.name}" is an open plot window not yet saved as an editable figure — save it (its title-bar Save button, or File > Save Editable Figure), then Save this page again`
          : `slot ${label}: "${slot.source.name}" is a Publication figure — create an editable copy first (its "Editable" button in the Library), then assign the copy to this slot`,
      );
    });
    return out;
  }, [slots, labels, plotWindows, editableFigures]);

  /** Has this session ever been saved (its id names a real `pages` entry)?
   *  Drives the view's "not yet saved" disclosure — the honest, narrower
   *  replacement for the pre-F3.3 blanket "this composition is temporary"
   *  note, which stopped being true the moment Save existed. */
  const everSaved = pages.some((p) => p.id === pageDocument.id);

  /** F3.3 dirty state: broad (never saved, OR a saved page has drifted) —
   *  drives the Save affordance's "•" cue, mirroring
   *  store/figureLifecycle.ts's `editableFigureDirty`. */
  const dirty = pageDocumentDirty(pageDocument, pages);
  /** Narrower than `dirty` — false for a page never saved at all. Mirrors the
   *  corrected `editableFigureHasUnsavedEdits` convention: only a SAVED
   *  page's drift gates a close confirmation. */
  const hasUnsavedEdits = pageDocumentHasUnsavedEdits(pageDocument, pages);

  /** Save (update-in-place once saved, insert on the first save). Refused
   *  with the specific per-slot reasons above rather than silently dropping
   *  an unresolved panel. */
  function save(): void {
    if (unresolvedSlots.length > 0) {
      const msg = `cannot save page: ${unresolvedSlots.join("; ")}`;
      setStatus(msg);
      toast(msg, "danger");
      return;
    }
    const id = useApp.getState().savePage(pageDocument);
    const saved = useApp.getState().pages.find((p) => p.id === id);
    if (saved) setDraft((prev) => ({ ...prev, id: saved.id, createdAt: saved.createdAt, modifiedAt: saved.modifiedAt }));
  }

  /** Save As: always a NEW named entry; rebinds this session's draft to it so
   *  the next plain Save updates the new entry, not the old one (mirrors
   *  `saveFigureAs` rebinding the window's document). */
  async function saveAs(): Promise<void> {
    if (unresolvedSlots.length > 0) {
      const msg = `cannot save page: ${unresolvedSlots.join("; ")}`;
      setStatus(msg);
      toast(msg, "danger");
      return;
    }
    const { askParams } = await import("../../overlays/ParamDialog");
    const params = await askParams("Save page as", [
      { key: "name", label: "Name", type: "text", default: draft.name || "Untitled page" },
    ]);
    if (!params) return;
    const id = useApp.getState().savePageAs(pageDocument, String(params.name));
    if (!id) return;
    const saved = useApp.getState().pages.find((p) => p.id === id);
    if (saved) {
      setDraft((prev) => ({
        ...prev,
        id: saved.id,
        name: saved.name,
        createdAt: saved.createdAt,
        modifiedAt: saved.modifiedAt,
      }));
    }
  }

  /** Gate the ToolWindow's close button: only a SAVED page's drift confirms
   *  (see `hasUnsavedEdits`'s doc) — a fresh, never-saved page discards
   *  plainly, same as the pre-F3.3 "this composition is temporary" behavior.
   *  Returns whether the caller should actually close. */
  async function requestClose(): Promise<boolean> {
    if (!hasUnsavedEdits) return true;
    return askConfirm(
      `Close "${draft.name || "Untitled page"}" without saving?`,
      "Changes to this saved page will be lost. Use Save first to keep them.",
      "Close without saving",
      true,
    );
  }

  /** The page spec (sans format/dpi — the preview and the export choose their
   *  own). null when nothing is assigned or nothing can render anymore. */
  async function buildSpec(): Promise<FigurePageSpec | null> {
    if (filledCount(slots) === 0) return null;
    const panels: PagePanelSpec[] = [];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot.source) continue;
      const figure = await panelFigure(slot.source);
      if (!figure) {
        // A dead source (window closed, dataset gone) must FAIL the build,
        // not silently drop the panel and re-letter the rest (review
        // 2026-07-11: export no longer matched the last-rendered preview).
        setError(`slot ${i + 1}: source "${slot.source.name}" no longer exists - clear or reassign it`);
        return null;
      }
      panels.push({
        figure,
        row: Math.floor(i / cols),
        col: i % cols,
        ...(slot.label !== null ? { label: slot.label } : {}),
        ...(slot.title !== null ? { title: slot.title } : {}),
      });
    }
    if (panels.length === 0) return null;
    return { rows, cols, panels, style, label_format: labelFormat, label_pos: labelPos };
  }

  // Debounced low-DPI PNG preview — re-renders on any page-shape change AND
  // when the store state an assigned panel renders from changes underneath
  // it (#8g — renderInputs), so the preview never goes silently stale.
  useEffect(() => {
    let cancelled = false;
    if (filledCount(slots) === 0) {
      setPreview(null);
      setError(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const spec = await buildSpec();
          if (cancelled) return;
          if (!spec) {
            // F3.2: past the filledCount===0 guard above, buildSpec() can
            // only return null because it hit a dead source and already
            // called setError() with the specific "slot N: ... no longer
            // exists" message — do NOT clear it here. This branch used to
            // unconditionally setError(null) right after buildSpec set it,
            // so a missing panel silently fell back to the plain "assign
            // plots to grid slots" empty-state text with no explanation
            // (exactly the "render a hole without explanation" failure mode
            // F3.2 rules out). Only clear preview; leave the message intact.
            setPreview(null);
            return;
          }
          const blob = await renderFigurePageBlob({ ...spec, fmt: "png", dpi: PREVIEW_DPI });
          const url = await blobToDataUrl(blob);
          if (!cancelled) {
            setPreview(url);
            setError(null);
          }
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : "preview failed");
        } finally {
          if (!cancelled) setBusy(false);
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // buildSpec reads slots/rows/cols/style/labels from local state plus the
    // panels' windows/datasets/docs THROUGH the store — renderInputs is the
    // fingerprint of exactly those store reads (#8g); the 400 ms debounce
    // absorbs any churn while they settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, rows, cols, style, labelFormat, labelPos, renderInputs]);

  async function exportNow(): Promise<void> {
    try {
      // F3.2: distinguish "nothing assigned" from "something is assigned but
      // can't render" BEFORE calling buildSpec — it used to report the same
      // "assign at least one panel" message for both, which is actively
      // misleading when panels ARE assigned and one has simply gone missing
      // (window closed / figure deleted since it was dropped onto the grid).
      if (filledCount(slots) === 0) {
        setStatus("assign at least one panel to export a figure page");
        return;
      }
      const spec = await buildSpec();
      if (!spec) {
        // buildSpec() already set the specific `error` state (visible in the
        // preview pane); mirror it on the status bar too so Export's failure
        // reads the same as the preview's, not a generic non-sequitur.
        setStatus("cannot export: a panel's source is missing - see the highlighted slot, then clear or reassign it");
        return;
      }
      await exportFigurePage({ ...spec, fmt, dpi });
      setStatus(`exported figure_page.${fmt}`);
    } catch (e) {
      setStatus(`export failed: ${e instanceof Error ? e.message : "error"}`);
    }
  }

  return {
    rows,
    cols,
    setGrid,
    slots,
    labels,
    sourceStatuses,
    selected,
    setSelected,
    assign,
    assignToNext,
    clear,
    setSlotLabel,
    setSlotTitle,
    labelFormat,
    setLabelFormat,
    labelPos,
    setLabelPos,
    style,
    setStyle,
    fmt,
    setFmt,
    dpi,
    setDpi,
    windowSources,
    docSources,
    figureSources,
    pageDocument,
    name: draft.name,
    setName,
    everSaved,
    dirty,
    unresolvedSlots,
    save,
    saveAs,
    requestClose,
    preview,
    error,
    busy,
    buildSpec,
    exportNow,
  };
}
