// The windows slice's public state + action contract, moved verbatim out of
// store/windows.ts (store-size ratchet) and re-exported from there as a type,
// so no importer changed. Types only — zero runtime bytes.

import type { TechniqueViewMemoryMap } from "../lib/techniqueViewMemory";
import type { PlotBg, PlotView, PlotWindow } from "../lib/plotview";
import type { FrozenPlotBundle } from "../lib/plotsnapshot";

/** The window-management state + actions composed into `useApp`. */
export interface WindowsSlice {
  // Plot windows (MULTI_PLOT_PLAN item 2) — the "focused-window facade": the
  // PlotView singleton fields in AppState (xKey … waterfall) are the FOCUSED
  // window's LIVE view; `plotWindows[]` holds each window's geometry/
  // z/winState/dataset-binding plus its OWN view snapshot (stale while
  // focused — the live singleton fields win). `focusWindow`/`closeWindow` are
  // the ONLY actions that move a view between "live" and "at rest", via
  // `lib/plotview`'s `snapshotView`/`hydrateView`. Always ≥1 window (the
  // startup/load invariant — see `mainWindow`); `focusedWindowId` is never
  // null while any window exists.
  plotWindows: PlotWindow[];
  focusedWindowId: string | null;
  // Item 5: per-technique last-used view (lib/techniqueViewMemory.ts); `.dwk`-persisted, additive.
  techniqueViewMemory: TechniqueViewMemoryMap;
  // The Plot tab's current on-screen canvas size (item 6 — Tile/Cascade need
  // real pixel bounds to compute a layout; the WindowCanvas ResizeObserver is
  // the sole writer, via `setPlotCanvasBounds`). Null while the Plot tab
  // isn't mounted (Tile/Cascade fall back to a sane default size then).
  plotCanvasBounds: { width: number; height: number } | null;
  // Plot windows (MULTI_PLOT_PLAN item 2). `createWindow`/`duplicateWindow`
  // return the new window's id; neither changes focus (only `focusWindow`
  // does — see the field doc above). `closeWindow` is a no-op on the LAST
  // window (the ≥1-window invariant). `datasetId`/`view` default to the
  // current active dataset / a fresh `defaultPlotView()` when omitted.
  // `title` (item 10) overrides the computed default (dataset name, deduped
  // against what's already showing) — omit it to get that default.
  createWindow: (datasetId?: string | null, view?: PlotView, title?: string) => string;
  // Snapshot-as-window (item 11): freeze the FOCUSED window's current
  // composed display bundle (the caller reads it from the PlotStage seam —
  // lib/plotsnapshot) into a static kind:"snapshot" compare window. Never
  // focusable (focusWindow only raises it), never dataset-bound; its view is
  // a frozen copy of the live singletons at freeze time. Returns the new id,
  // or null when no window is focused.
  createSnapshotWindow: (frozen: FrozenPlotBundle) => string | null;
  // Item 17 (full MDI) — a floating DOCUMENT window hosting the same
  // component the stage tab mounts (WorksheetPane / MapStage), LIVE-bound to
  // `datasetId` (unlike a snapshot: dataset removal nulls the binding, an
  // explicit drop rebinds it). Like every non-plot kind it can never hold
  // the view-facade focus (focusWindow only raises it); its required `view`
  // stays `defaultPlotView()`, unused. Cascade placement, title = dataset
  // name deduped (item 10), created on top. Returns the new id; a dataset id
  // that isn't in the store creates an UNBOUND window (the decision-#4 empty
  // state) rather than a dangling ref.
  createDocumentWindow: (kind: "worksheet" | "map", datasetId: string) => string;
  // Item 14 — drop a Library row onto EMPTY canvas: `createWindow` bound to
  // `datasetId`, then re-placed at the drop point (clamped inside the live
  // canvas bounds via `dropGeometry`). Returns the new id; like
  // createWindow, does NOT move focus (the drop handler focuses explicitly).
  createWindowAt: (datasetId: string, x: number, y: number) => string;
  // Item 14 — the EXPLICIT rebind gesture (drop a Library row onto a frame).
  // Focused target: exactly `setActive`'s semantics (rebind + smart-defaults
  // view reset + transient clear), but WITHOUT the pin pre-step — a
  // deliberate drop rebinds even a pinned window. Background target: rebinds
  // the record + resets its stored view to the same dataset-derived defaults,
  // never touching focus or the live singleton fields. A no-op for an
  // unknown window or dataset id.
  rebindWindow: (windowId: string, datasetId: string) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  duplicateWindow: (id: string) => string | null;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, w: number, h: number) => void;
  setWindowGeometry: (id: string, geometry: Partial<PlotWindow["geometry"]>) => void;
  raiseWindow: (id: string) => void;
  // The Plot tab's live canvas size (item 6) — written by WindowCanvas's own
  // ResizeObserver; read by tileWindows/cascadeWindows so their layout math
  // uses real pixel bounds instead of a guess.
  setPlotCanvasBounds: (bounds: { width: number; height: number } | null) => void;
  // Tile / Cascade (item 6): re-lay-out every NON-minimized window (any that
  // were maximized become "normal" so they actually show side by side/
  // cascaded); minimized windows are untouched (still docked in the strip —
  // item 8). Falls back to a sane default size when the canvas bounds aren't
  // known yet (e.g. called from the palette before the Plot tab ever mounted).
  tileWindows: () => void;
  cascadeWindows: () => void;
  // Minimize / maximize / restore (item 8). Minimizing the FOCUSED window
  // hands focus to the top-z remaining VISIBLE (non-minimized) window — same
  // refocus contract `closeWindow` uses, but the window stays in
  // `plotWindows` (docked in the strip) rather than being removed. Restoring
  // a minimized window un-minimizes it AND focuses it in one step (clicking
  // a strip entry is "bring this back and make it live", matching a taskbar
  // button). `toggleMaximizeWindow` flips normal<->maximized (a no-op on a
  // minimized window); double-clicking a title BAR (not its text — that
  // renames, see `renameWindow`) calls it.
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  toggleMaximizeWindow: (id: string) => void;
  // Rename (item 10): sets the window's explicit title verbatim — never
  // deduped (that's only for computed defaults at creation).
  renameWindow: (id: string, title: string) => void;
  // Per-window background override (item 18, owner request 2026-07-09): a
  // no-op for an unknown id. See `PlotBg`'s doc in `lib/plotview.ts`.
  setWindowBg: (id: string, bg: PlotBg) => void;
  // Cross-window link groups (item 13): cycles one window's `linkGroup`
  // null -> 1 -> 2 -> 3 -> null (the `nextLinkGroup` pure cycle). Same-group
  // windows share a uPlot cursor-sync + x-range sync (`lib/windowsync.ts`).
  // A no-op for an unknown id, mirroring `setWindowBg`.
  cycleWindowLinkGroup: (id: string) => void;
  // Item 14's pin toggle — see `PlotWindow.pinned`'s doc in lib/plotview.ts
  // for the semantics (passive rebinds retarget; explicit drops still land).
  // A no-op for an unknown id.
  toggleWindowPin: (id: string) => void;
  // Item 7 (.dwk + autosave persistence): `plotWindows` as it should be
  // SAVED — the focused window's LIVE view frozen into its record via the
  // same `snapshotView` chokepoint `focusWindow`/`closeWindow` use (the
  // plan's "save is one of the three sanctioned snapshot points"). A pure
  // read (doesn't mutate the store); the Save-workspace command and the
  // autosave effect both call it instead of reading `plotWindows` raw, so
  // neither ever persists a stale view for whichever window is focused.
  windowsForSave: () => PlotWindow[];
}
