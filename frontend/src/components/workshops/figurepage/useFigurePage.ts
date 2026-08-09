// Figure page composer state hook (GOTO #4). Holds the page grid (rows x
// cols of slots), the panel sources assigned into them (open plot windows
// and/or saved Library figures), and the page-level options (style preset,
// label format/position, export format + DPI). The heavy composition is the
// matplotlib route — this is a thin WYSIWYG layer on it, the figure-builder
// pattern applied to N panels.
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
// pass. F3.6 extracted the debounced preview + export + clipboard-copy half
// (the ONE `buildSpec` derivation and its three consumers) to
// usePagePreviewExport.ts — this hook was already at 483/500, flagged by
// F3.5's log; see that module's header for what moved and why.

import { useMemo, useState } from "react";

import { docRenderable } from "../../../lib/figuredoc";
import {
  PAGE_MAX_GRID,
  assignSlot,
  clearSlot,
  emptySlots,
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
import { usePageLifecycle } from "./usePageLifecycle";
import { usePagePreviewExport } from "./usePagePreviewExport";

// F3.3: a FRESH id per mount (never a shared literal) — this hook has at most
// one page open at a time (mirrors Publication Preview's one-session rule),
// but `savePage` upserts `pages` BY ID, so two DIFFERENT never-saved sessions
// sharing one constant id would make the second session's first Save
// silently overwrite whatever the first session had already saved under it.
// A per-mount counter costs nothing and closes that hole outright.
let _draftSeq = 0;
const nextDraftId = (): string => `figurepage-draft-${Date.now().toString(36)}-${++_draftSeq}`;

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

  const lifecycle = usePageLifecycle(draft, setDraft, slots, setSlots, setSelected);
  // F3.6: the ONE spec-derivation path (buildSpec) plus preview/export/copy —
  // see usePagePreviewExport.ts's header for why this extracted out.
  const pv = usePagePreviewExport(slots, { rows, cols, style, labelFormat, labelPos, layout, fmt, dpi });
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
    preview: pv.preview,
    error: pv.error,
    busy: pv.busy,
    buildSpec: pv.buildSpec,
    exportNow: pv.exportNow,
    copyNow: pv.copyNow,
  };
}
