// The Graph Builder's cross-cutting store state (GUI_INTERACTION_PLAN #11 —
// "Graph Builder → durable artifact"), extracted as its own slice under the
// store-size ratchet (architecture.test.ts's STORE_PINS) exactly like
// store/libraryPanel.ts / store/toolwindows.ts: useApp.ts sits AT its pin
// with zero headroom, so a self-contained feature's new state lives here,
// not inline. This file now owns the WHOLE Graph Builder store surface —
// both the pre-existing open/seed handshake (relocated from useApp.ts
// verbatim, offsetting this slice's own wiring cost in the same commit) and
// the new savedPlotSpecs CRUD.
//
// savedPlotSpecs: a named PlotSpec collection (lib/plotspec.SavedPlotSpec),
// round-tripped through the `.dwk` workspace (lib/workspace.ts, additive-
// optional). `activePlotSpecId` is the id the Graph Builder panel is
// currently bound to — null means "unsaved" (never saved, or unbound after
// Reset/a dataset vanishing/a worksheet-seed handoff). It is deliberately
// NOT persisted (like `revealTarget`/`worksheetSelections` — transient UI,
// reset on workspace load): reopening a project shouldn't silently resume
// mid-edit on a saved graph.
//
// `savePlotSpec`/`saveAsPlotSpec`/`duplicatePlotSpec` all deal in the LIVE
// builder spec the caller passes in — this slice never reads component
// state. useGraphBuilder.ts is the one caller and owns the divergence
// ("dirty") check via lib/plotspec.plotSpecsEqual.

import type { PlotSpec, SavedPlotSpec } from "../lib/plotspec";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

let _specSeq = 0;

export interface GraphBuilderSlice {
  graphBuilderOpen: boolean; // the drag-columns-to-wells plot-spec builder (#51)
  // One-shot spec handed TO the Graph Builder by the worksheet's "Open in
  // Graph Builder" (MAIN_PLAN #4) — consumed + cleared by useGraphBuilder on
  // open, mirroring statStageSeed's shape. null = open empty (the ⌘K path).
  graphBuilderSeed: PlotSpec | null;
  setGraphBuilderOpen: (open: boolean) => void;
  // Open the Graph Builder prefilled with a spec (the worksheet handoff,
  // MAIN_PLAN #4); clearGraphBuilderSeed drops the one-shot seed once read.
  openGraphBuilderSeeded: (spec: PlotSpec) => void;
  clearGraphBuilderSeed: () => void;

  /** Every named saved graph (#11). Round-trips through .dwk. */
  savedPlotSpecs: SavedPlotSpec[];
  /** The saved spec id the Graph Builder panel is currently bound to (null =
   *  unsaved/new — see the header doc). Also what a Stage-facing "which spec
   *  produced this plot" indicator would read. Transient — never persisted. */
  activePlotSpecId: string | null;
  /** Update-in-place under `activePlotSpecId`. Returns null (no-op) when
   *  nothing is active — the caller (useGraphBuilder's `save`) falls back to
   *  prompting a name via `saveAsPlotSpec` in that case. */
  savePlotSpec: (spec: PlotSpec) => string | null;
  /** Always creates a new entry and makes it active. A blank/whitespace name
   *  falls back to "Untitled graph". */
  saveAsPlotSpec: (name: string, spec: PlotSpec) => string;
  /** Copy an existing saved entry's STORED payload under an auto-numbered
   *  "<name> copy" / "<name> copy 2" name, and make the copy active. Returns
   *  null if `id` doesn't resolve. */
  duplicatePlotSpec: (id: string) => string | null;
  renamePlotSpec: (id: string, name: string) => void;
  /** Removes the entry; clears `activePlotSpecId` if it pointed at it. */
  deletePlotSpec: (id: string) => void;
  setActivePlotSpecId: (id: string | null) => void;
}

export function createGraphBuilderSlice(set: SliceSet, get: SliceGet): GraphBuilderSlice {
  return {
    graphBuilderOpen: false,
    graphBuilderSeed: null,
    setGraphBuilderOpen: (graphBuilderOpen) => set({ graphBuilderOpen }),
    openGraphBuilderSeeded: (graphBuilderSeed) => set({ graphBuilderSeed, graphBuilderOpen: true }),
    clearGraphBuilderSeed: () => set({ graphBuilderSeed: null }),

    savedPlotSpecs: [],
    activePlotSpecId: null,
    savePlotSpec: (spec) => {
      const id = get().activePlotSpecId;
      if (!id) return null;
      const now = new Date().toISOString();
      set((s) => ({
        savedPlotSpecs: s.savedPlotSpecs.map((p) => (p.id === id ? { ...p, spec, modifiedAt: now } : p)),
      }));
      return id;
    },
    saveAsPlotSpec: (name, spec) => {
      const id = `pspec-${Date.now().toString(36)}-${++_specSeq}`;
      const now = new Date().toISOString();
      const nm = name.trim() || "Untitled graph";
      set((s) => ({
        savedPlotSpecs: [...s.savedPlotSpecs, { id, name: nm, createdAt: now, modifiedAt: now, spec }],
        activePlotSpecId: id,
      }));
      return id;
    },
    duplicatePlotSpec: (id) => {
      const src = get().savedPlotSpecs.find((p) => p.id === id);
      if (!src) return null;
      const newId = `pspec-${Date.now().toString(36)}-${++_specSeq}`;
      const now = new Date().toISOString();
      const names = new Set(get().savedPlotSpecs.map((p) => p.name));
      let name = `${src.name} copy`;
      let n = 2;
      while (names.has(name)) name = `${src.name} copy ${n++}`;
      set((s) => ({
        savedPlotSpecs: [
          ...s.savedPlotSpecs,
          { id: newId, name, createdAt: now, modifiedAt: now, spec: src.spec },
        ],
        activePlotSpecId: newId,
      }));
      return newId;
    },
    renamePlotSpec: (id, name) => {
      const nm = name.trim();
      if (!nm) return;
      set((s) => ({
        savedPlotSpecs: s.savedPlotSpecs.map((p) => (p.id === id ? { ...p, name: nm } : p)),
      }));
    },
    deletePlotSpec: (id) =>
      set((s) => ({
        savedPlotSpecs: s.savedPlotSpecs.filter((p) => p.id !== id),
        activePlotSpecId: s.activePlotSpecId === id ? null : s.activePlotSpecId,
      })),
    setActivePlotSpecId: (activePlotSpecId) => set({ activePlotSpecId }),
  };
}
