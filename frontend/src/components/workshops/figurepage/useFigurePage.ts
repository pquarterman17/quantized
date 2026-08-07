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
// library (store/pageDocuments.ts), and a saved page can be reopened. See
// usePageLifecycle.ts for the save/dirty/reopen mechanics (F3.4 extracted
// this hook's save-lifecycle half out to keep this file from re-growing past
// its pre-F3.4 size — see that module's header for the split rationale).
// panelResolve.ts holds the panel-source resolution + single-panel spec-
// building helpers (`panelFigure`/`panelRenderInputs`), extracted the same
// pass.

import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  exportFigurePage,
  renderFigurePageBlob,
  type FigurePageSpec,
  type PagePanelSpec,
} from "../../../lib/api";
import { docRenderable } from "../../../lib/figuredoc";
import {
  PAGE_MAX_GRID,
  assignSlot,
  clearSlot,
  emptySlots,
  filledCount,
  moveSlot as swapSlots,
  patchSlot,
  resizeSlots,
  resolvePanelSource,
  type PageLabelFormat,
  type PageLabelPosition,
  type PageSlot,
  type PanelSource,
  type PanelSourceStatus,
} from "../../../lib/figurepage";
import { createPageDocument, type PageLayoutSettings } from "../../../lib/pageDocument";
import { displayedWindowTitle } from "../../../lib/plotview";
import { useApp } from "../../../store/useApp";
import { FIGURE_STYLE_DPI } from "../figurebuilder/useFigureBuilder";
import { panelFigure, panelRenderInputs } from "./panelResolve";
import { usePageLifecycle } from "./usePageLifecycle";

// F3.3: a FRESH id per mount (never a shared literal) — this hook has at most
// one page open at a time (mirrors Publication Preview's one-session rule),
// but `savePage` upserts `pages` BY ID, so two DIFFERENT never-saved sessions
// sharing one constant id would make the second session's first Save
// silently overwrite whatever the first session had already saved under it.
// A per-mount counter costs nothing and closes that hole outright.
let _draftSeq = 0;
const nextDraftId = (): string => `figurepage-draft-${Date.now().toString(36)}-${++_draftSeq}`;

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

export function useFigurePage() {
  const plotWindows = useApp((s) => s.plotWindows);
  const datasets = useApp((s) => s.datasets);
  const figureDocs = useApp((s) => s.figureDocs);
  const editableFigures = useApp((s) => s.editableFigures);
  const setStatus = useApp((s) => s.setStatus);

  // F3.1: the grid geometry + output settings live in ONE PageDocument draft
  // (lib/pageDocument.ts) instead of loose parallel useStates — rows/cols/
  // style/fmt/dpi/label format+position are all `draft` fields now; `panels`
  // is resolved separately (see usePageLifecycle's `pageDocument`) since a
  // session source can reference a still-unsaved window, which a persisted
  // document can't.
  const [draft, setDraft] = useState(() => createPageDocument({ id: nextDraftId(), name: "Untitled page" }));
  const rows = draft.rows;
  const cols = draft.cols;
  const labelFormat = draft.output.labelFormat;
  const labelPos = draft.output.labelPos;
  const style = draft.output.stylePreset;
  const fmt = draft.output.format;
  const dpi = draft.output.dpi;
  const layout = draft.layout; // F3.5: gap/link/align/resize-mode controls

  const [slots, setSlots] = useState<PageSlot[]>(() => emptySlots(2, 2));
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lifecycle = usePageLifecycle(draft, setDraft, slots, setSlots, setSelected);
  const { labels } = lifecycle;

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
  // panels are named once hydrated. Only renderable ones are offered,
  // mirroring docSources' docRenderable filter (the same "ok" test
  // resolvePanelSource applies once assigned).
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

  /** F3.5: one patch setter for every layout field (gap/link/align/resize
   *  mode) rather than six near-identical setters — keeps this hook's own
   *  growth minimal (it sits near its size habit; see the module header). */
  function setLayout(patch: Partial<PageLayoutSettings>): void {
    setDraft((prev) => ({ ...prev, layout: { ...prev.layout, ...patch } }));
  }

  function assign(i: number, source: PanelSource): void {
    setSlots((prev) => assignSlot(prev, i, source));
    setSelected(i);
  }

  /** F3.5 manual rearrangement: swap the panel (source + label/title
   *  caption, as one unit — see lib/figurepage.ts's `moveSlot` doc for why)
   *  at `i` with whatever occupies `j`, then follow selection to its new
   *  position. Used by both SlotGrid's drag-a-filled-tile handler and its
   *  Shift+Arrow keyboard equivalent. */
  function moveSlot(i: number, j: number): void {
    setSlots((prev) => swapSlots(prev, i, j));
    setSelected(j);
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

  /** F3.4 "unify panel editing": open the referenced figure for editing
   *  (figure kind), or focus/restore its window (window kind). Not called
   *  for a figdoc slot (see `promoteSlot`) or a missing source — SlotGrid
   *  gates the call via `panelMenu.ts`'s `primaryPanelAction`. */
  function editSlot(i: number): void {
    const slot = slots[i];
    if (!slot.source) return;
    const s = useApp.getState();
    if (slot.source.kind === "figure") {
      s.openEditableFigure(slot.source.id);
      return;
    }
    if (slot.source.kind === "window") {
      const win = s.plotWindows.find((w) => w.id === slot.source?.id);
      if (!win) return;
      if (win.winState === "minimized") s.restoreWindow(win.id);
      else s.focusWindow(win.id);
    }
  }

  /** F3.4: a window-kind panel's "Save as editable figure" — the SAME action
   *  its title-bar Save button runs (`saveFigure`), reachable directly from
   *  the panel so resolving F3.3's unresolved-slot Save block doesn't
   *  require leaving the workshop to find the window. Once saved, the slot
   *  automatically resolves to the new `editableFigures` entry on its next
   *  read (`resolveSlotFigureId` already checks `editableFigures` — no local
   *  reassignment needed, unlike `promoteSlot`/`duplicateForPage` below). */
  function saveSlotAsFigure(i: number): void {
    const slot = slots[i];
    if (!slot.source || slot.source.kind !== "window") return;
    useApp.getState().saveFigure(slot.source.id);
  }

  /** F3.4: a figdoc-kind panel's "Create editable copy" — the existing
   *  promotion (`promoteLegacyFigureDoc`, F2.1c) plus repointing THIS slot at
   *  the new copy in one step, so the panel converts straight from
   *  non-durable ("figdoc") to durable ("figure") without a second manual
   *  reassignment. The Library's own "Editable" button performs the same
   *  promotion with no slot to repoint. */
  function promoteSlot(i: number): void {
    const slot = slots[i];
    if (!slot.source || slot.source.kind !== "figdoc") return;
    const s = useApp.getState();
    const newId = s.promoteLegacyFigureDoc(slot.source.id);
    if (!newId) return;
    const created = useApp.getState().editableFigures.find((f) => f.id === newId);
    assign(i, { kind: "figure", id: newId, name: created?.name ?? `${slot.source.name} (editable copy)` });
  }

  /** F3.4 "duplicate for this page" / unlink: only meaningful for a
   *  `figure`-kind panel — the only kind with a real duplicable identity (a
   *  window has no saved copy to duplicate; a figdoc's "copy" IS what
   *  `promoteSlot` above performs). Duplicates the referenced figure (one
   *  undoable store mutation, `duplicateEditableFigure`) and repoints THIS
   *  panel at the copy — editing the copy afterward no longer touches the
   *  original or any OTHER page still referencing it. */
  function duplicateForPage(i: number): void {
    const slot = slots[i];
    if (!slot.source || slot.source.kind !== "figure") return;
    const s = useApp.getState();
    const newId = s.duplicateEditableFigure(slot.source.id);
    if (!newId) return;
    const created = useApp.getState().editableFigures.find((f) => f.id === newId);
    assign(i, { kind: "figure", id: newId, name: created?.name ?? `${slot.source.name} copy` });
    setStatus(`duplicated "${slot.source.name}" for this page; editing the copy no longer affects the original`);
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
    return {
      rows,
      cols,
      panels,
      style,
      label_format: labelFormat,
      label_pos: labelPos,
      row_gap: layout.rowGap,
      col_gap: layout.colGap,
      link_x: layout.linkX,
      link_y: layout.linkY,
      align_labels: layout.alignLabels,
      resize_mode: layout.resizeMode,
    };
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
    // buildSpec reads slots/rows/cols/style/labels/layout from local state
    // plus the panels' windows/datasets/docs THROUGH the store — renderInputs
    // is the fingerprint of exactly those store reads (#8g); the 400 ms
    // debounce absorbs any churn while they settle. F3.5: `layout` joins the
    // dep list so a gap/link/align/resize-mode change refreshes the preview
    // the same way a style/label change already does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, rows, cols, style, labelFormat, labelPos, layout, renderInputs]);

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
    moveSlot,
    clear,
    setSlotLabel,
    setSlotTitle,
    editSlot,
    saveSlotAsFigure,
    promoteSlot,
    duplicateForPage,
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
    layout,
    setLayout,
    windowSources,
    docSources,
    figureSources,
    pageDocument: lifecycle.pageDocument,
    name: draft.name,
    setName,
    everSaved: lifecycle.everSaved,
    dirty: lifecycle.dirty,
    unresolvedSlots: lifecycle.unresolvedSlots,
    save: lifecycle.save,
    saveAs: lifecycle.saveAs,
    requestClose: lifecycle.requestClose,
    preview,
    error,
    busy,
    buildSpec,
    exportNow,
  };
}
