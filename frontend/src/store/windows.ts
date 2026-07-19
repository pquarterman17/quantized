// The MDI window-management slice (MULTI_PLOT_PLAN items 2–18), extracted
// from store/useApp.ts (MAIN_PLAN #2). Zustand slice composition: useApp
// spreads `createWindowsSlice(set, get)` into the ONE store instance, so
// every existing `useApp((s) => ...)` selector and `useApp.getState()` call
// keeps working — this file is a code boundary, not a second store.
//
// The "focused-window facade" contract (see the WindowsSlice field docs):
// the PlotView singleton fields living in useApp are the FOCUSED window's
// LIVE view; `plotWindows[]` holds each window's geometry/z/winState/
// dataset-binding plus its OWN view snapshot (stale while focused).
// `focusWindow`/`closeWindow` are the only actions that move a view between
// "live" and "at rest", via lib/plotview's `snapshotView`/`hydrateView`.
//
// The shared rebind helpers (`datasetViewDefaults`, `focusedRebindPatch`,
// `retargetPassiveRebind`, `focusTransientReset`, `mainWindow`) live here —
// they are window-shaped — and are exported for useApp's own `setActive`/
// `addDataset`/`loadWorkspace` paths. Only TYPE imports cross back into
// useApp (no runtime cycle).

import { defaultErrKeys, originHiddenChannels } from "../lib/errorbars";
import {
  cascadeGeometry,
  cascadeLayout,
  dedupeWindowTitle,
  defaultPlotView,
  displayedWindowTitle,
  dropGeometry,
  hydrateView,
  nextLinkGroup,
  snapshotView,
  tileLayout,
  type PlotBg,
  type PlotView,
  type PlotWindow,
  type WinState,
} from "../lib/plotview";
import type { FrozenPlotBundle } from "../lib/plotsnapshot";
import { plotIntentStageTab } from "../lib/stagetab";
import type { Dataset } from "../lib/types";
import type { AppState } from "./useApp";
import { dropWorksheetSelection } from "./worksheetSelection";
// Window ids get their own sequence (dataset/folder/report ids keep useApp's)
// — the `win-` prefix + timestamp keeps them collision-free across both.
let _winSeq = 0;
export const nextWindowId = (): string => `win-${Date.now().toString(36)}-${++_winSeq}`;
/** The highest z among a window list (0 if empty) — z-order helper shared by
 *  every action that raises a window (focus/raise/create/duplicate). */
export const maxZ = (windows: readonly PlotWindow[]): number =>
  windows.reduce((m, w) => Math.max(m, w.z), 0);
/** A brand-new sole main window — the ≥1-window invariant's default: one
 *  MAXIMIZED window bound to `datasetId`, with a fresh view (MULTI_PLOT_PLAN
 *  decision #6 — pixel-identical to today's single-plot Stage). Used at store
 *  init and whenever `loadWorkspace` resets the whole view (a fresh workspace
 *  has no windows to restore yet — item 7 wires `.dwk` persistence). */
export function mainWindow(datasetId: string | null): PlotWindow {
  return {
    id: nextWindowId(),
    kind: "plot",
    title: "",
    datasetId,
    geometry: cascadeGeometry(0),
    z: 0,
    winState: "maximized",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
  };
}

/** Transient tool/gadget/overlay singleton state cleared on any FOCUS switch
 *  (an explicit `focusWindow`, or the refocus `closeWindow` does when it
 *  drops the currently-focused window) — MULTI_PLOT_PLAN item 4: "switching
 *  focus clears transient tool state exactly as switching datasets does
 *  today". Deliberately the SAME field list `setActive` clears (not more) —
 *  `fitOverlay`/`peakOverlay`/`baselineOverlay`/`derivOverlay` are NOT here
 *  because `setActive` doesn't clear them either (they carry their own
 *  `datasetId` and self-filter in `composeDisplayPayload`). */
export function focusTransientReset(): Partial<AppState> {
  return {
    composition: null,
    rsmPeaks: null,
    integral: null,
    fwhmResult: null,
    qfitRoi: null,
    qfitResult: null,
    qfitBusy: false,
    qfitError: null,
    gadgetBusy: false,
    gadgetError: null,
    gadgetIntegrateResult: null,
    gadgetStatsResult: null,
    gadgetDerivResult: null,
    gadgetFftPreview: null,
    gadgetCursors: null,
    gadgetCursorResult: null,
  };
}

/** The dataset-derived "smart defaults" a rebind resets a view to — the ONE
 *  derivation shared by `setActive` (via `focusedRebindPatch`), `addDataset`,
 *  and `rebindWindow`'s background-window path (item 14), so a window
 *  rebound by drop carries exactly the view a Library click would produce.
 *  Channel-keyed state (keys/styles/labels/order/hidden) resets because it
 *  indexes the OLD dataset's columns; axis limits reset to autoscale; errKeys/
 *  hiddenChannels seed from the dataset (Origin Y-error designations + parser
 *  hints — see lib/errorbars). Display config that survives a dataset switch
 *  (log axes, grid, legend, template, title, annotations, …) is deliberately
 *  absent — same as `setActive` has always behaved. */
export function datasetViewDefaults(ds: Dataset | undefined): Partial<PlotView> {
  return {
    xKey: null, // new dataset → x-axis back to .time
    yKeys: null, // new dataset → plot all its channels
    y2Keys: null,
    y2Lim: null,
    y2Scale: null, // and reset the secondary-axis assignment
    y2Step: null,
    y2AxisLabel: "",
    seriesStyles: {}, // styles are keyed by channel index → reset per dataset
    seriesLabels: {}, // legend renames are channel-keyed → reset per dataset
    errKeys: ds ? defaultErrKeys(ds.data) : {}, // Origin Y-error + parser hints
    seriesOrder: null, // draw order is channel-keyed → reset per dataset
    hiddenChannels: ds ? originHiddenChannels(ds.data) : [], // hide Origin error + secondary-X columns
    xLim: null, // and autoscale both axes
    yLim: null,
    xStep: null,
    yStep: null,
  };
}

/** The full state patch for rebinding the FOCUSED window to dataset `id` —
 *  `setActive`'s entire body, hoisted so `rebindWindow`'s focused-target path
 *  (item 14) applies the IDENTICAL semantics without the pin pre-step (an
 *  explicit drop beats the passive pin). See `setActive`'s own doc for the
 *  per-field reasoning that used to live inline here. */
export function focusedRebindPatch(s: AppState, id: string): Partial<AppState> {
  const ds = s.datasets.find((d) => d.id === id);
  return {
    activeId: id,
    // A full plot-intent activation always drops any worksheet-only override
    // (item 15) — the plot it now shows IS `id`, so the Worksheet tab's
    // `worksheetId ?? activeId` fallback already tracks it; a stale override
    // would otherwise strand the worksheet on the PREVIOUS browse target.
    worksheetId: null,
    selectedIds: [id], // plain click collapses the selection to this one row
    // MULTI_PLOT_PLAN item 4: scoped to the FOCUSED window — it rebinds that
    // window's dataset (unfocused windows keep whatever they're pinned to,
    // decision #4).
    plotWindows: s.plotWindows.map((w) =>
      w.id === s.focusedWindowId ? { ...w, datasetId: id } : w,
    ),
    // setActive IS the plot-intent primitive (item 15's DatasetRow "Plot
    // (make active)", every applyOriginFigure branch, a plain Library click
    // on a non-Origin dataset, …) — unlike a fresh import/workspace restore,
    // it always means "show me the plot", so it uses `plotIntentStageTab`
    // (never sticks on a stale Worksheet tab; owner-routing item 1).
    stageTab: ds ? plotIntentStageTab(ds) : s.stageTab,
    ...(s.activeId === id ? {} : datasetViewDefaults(ds)), // #12 slice 4b: a GENUINE dataset switch resets channel-keyed defaults; re-activating the id that's ALREADY active (facetByColumn/breakAtGaps's trailing setActive) must not clobber a selection the caller just made — exportParity2.test.ts 8b
    // A plain click on a different dataset always drops a prior spatial
    // multi-panel arrangement (decode-plan #36) — it was built for a specific
    // figure's layers, not whatever is now active. Same for facet/x-break
    // panels (gap #21 residual) and the rest of the transient tool state —
    // the exact list `focusWindow` clears on a focus switch.
    ...focusTransientReset(),
  };
}

/** Item 14's pin opt-out, shared by `setActive` and `addDataset` (the two
 *  PASSIVE rebind entry points): when the FOCUSED window is pinned, hand
 *  focus to the top-z unpinned VISIBLE plot window first — the caller's
 *  normal focused-window rebind then lands there. With no candidate (every
 *  other window pinned/minimized, or none), create + focus a fresh window
 *  (cascade placement) bound to `datasetId` instead. `titleBase` covers the
 *  import case, where the dataset isn't in the store yet so `createWindow`
 *  couldn't compute its name-derived default title (still deduped here, item
 *  10). A no-op when the focused window isn't pinned. `rebindWindow` (the
 *  EXPLICIT gesture) deliberately never calls this. */
export function retargetPassiveRebind(s: AppState, datasetId: string, titleBase?: string): void {
  const focused = s.plotWindows.find((w) => w.id === s.focusedWindowId);
  if (!focused?.pinned) return;
  // Only plot windows are retarget candidates — future window kinds (item
  // 17's worksheets/maps, item 11's snapshots) never absorb a plot intent.
  const candidates = s.plotWindows.filter(
    (w) => w.kind === "plot" && w.id !== focused.id && !w.pinned && w.winState !== "minimized",
  );
  if (candidates.length > 0) {
    s.focusWindow(candidates.reduce((a, b) => (b.z > a.z ? b : a)).id);
    return;
  }
  const title =
    titleBase !== undefined
      ? dedupeWindowTitle(
          titleBase,
          s.plotWindows.map((w) => displayedWindowTitle(w, s.datasets)),
        )
      : undefined;
  s.focusWindow(s.createWindow(datasetId, undefined, title));
}

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

// The store-facing handles the slice builds against — the exact subset of
// Zustand's initializer arguments the window actions use (partial patches +
// functional patches; never `replace`). `useApp`'s own `set`/`get` satisfy
// these, so composition is `...createWindowsSlice(set, get)`.
type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

// The ≥1-window invariant's startup value (MULTI_PLOT_PLAN item 2): a single
// maximized main window bound to no dataset yet (activeId starts null).
const _mainWindow = mainWindow(null);

// Geometry/z/winState render via `components/windows/` (MULTI_PLOT_PLAN item
// 3): `WindowCanvas`/`PlotWindowFrame` read `plotWindows` directly and drive
// these same actions from pointer drag/resize/focus gestures.
export function createWindowsSlice(set: SliceSet, get: SliceGet): WindowsSlice {
  return {
    plotWindows: [_mainWindow],
    focusedWindowId: _mainWindow.id,
    plotCanvasBounds: null,
    createWindow: (datasetId, view, title) => {
      const id = nextWindowId();
      get().recordHistory("create window");
      set((s) => {
        const boundId = datasetId !== undefined ? datasetId : s.activeId;
        // Item 10: a computed default title (the bound dataset's name, or
        // "Untitled graph") deduped against every window's CURRENT displayed
        // title, so a second window on the same dataset reads "Foo (2)"
        // instead of an indistinguishable second "Foo". An explicit `title`
        // (e.g. from applyOriginFigure's newWindow path, keyed off the
        // figure's own label) skips this computation entirely.
        const resolvedTitle =
          title ??
          dedupeWindowTitle(
            boundId ? (s.datasets.find((d) => d.id === boundId)?.name ?? "Untitled graph") : "Untitled graph",
            s.plotWindows.map((w) => displayedWindowTitle(w, s.datasets)),
          );
        const win: PlotWindow = {
          id,
          kind: "plot",
          title: resolvedTitle,
          datasetId: boundId,
          geometry: cascadeGeometry(s.plotWindows.length),
          z: maxZ(s.plotWindows) + 1,
          winState: "normal",
          view: view ?? defaultPlotView(),
          bg: "theme",
          linkGroup: null,
          pinned: false,
        };
        return { plotWindows: [...s.plotWindows, win] };
      });
      return id;
    },
    // Snapshot-as-window (item 11): a static compare window carrying the
    // focused plot's frozen display bundle. Titled "Snapshot — <source's
    // displayed title>" (deduped like every other computed default — item 10),
    // placed on top like a new window, inheriting the source's bg override.
    // The view is snapshotted from the LIVE singleton fields (the focused
    // window's record is stale while focused) — a frozen copy, never swapped.
    createSnapshotWindow: (frozen) => {
      const s = get();
      const src = s.plotWindows.find((w) => w.id === s.focusedWindowId);
      if (!src) return null;
      get().recordHistory("create snapshot window");
      const id = nextWindowId();
      const title = dedupeWindowTitle(
        `Snapshot — ${displayedWindowTitle(src, s.datasets)}`,
        s.plotWindows.map((w) => displayedWindowTitle(w, s.datasets)),
      );
      const win: PlotWindow = {
        id,
        kind: "snapshot",
        title,
        datasetId: null,
        geometry: cascadeGeometry(s.plotWindows.length),
        z: maxZ(s.plotWindows) + 1,
        winState: "normal",
        view: snapshotView(s),
        bg: src.bg,
        // Always unlinked (item 13): a snapshot viewport is never wired into
        // the sync registry, and the ⧟ toggle is hidden on snapshot frames
        // (WindowTitleButtons) — there is no opt-in path, by design.
        linkGroup: null,
        // Never dataset-bound, so the pin (item 14) is meaningless on it —
        // false forever (retarget candidates are kind-guarded anyway).
        pinned: false,
        snapshot: frozen,
      };
      set({ plotWindows: [...s.plotWindows, win] });
      return id;
    },
    // Worksheet/map document windows (item 17). The bound dataset is validated
    // here (an unknown id → unbound, never a dangling ref the next sanitize
    // pass would silently null anyway); the #38 lazy-book fetch is covered by
    // WindowCanvas's per-window effect (and WorksheetPane's own), not here.
    createDocumentWindow: (kind, datasetId) => {
      const s = get();
      const ds = s.datasets.find((d) => d.id === datasetId) ?? null;
      const id = nextWindowId();
      get().recordHistory(`create ${kind} window`);
      const title = dedupeWindowTitle(
        ds?.name ?? "Untitled",
        s.plotWindows.map((w) => displayedWindowTitle(w, s.datasets)),
      );
      const win: PlotWindow = {
        id,
        kind,
        title,
        datasetId: ds ? ds.id : null,
        geometry: cascadeGeometry(s.plotWindows.length),
        z: maxZ(s.plotWindows) + 1,
        winState: "normal",
        // Required by the model, unused by a document window (the mounted
        // WorksheetPane/MapStage never read a PlotView) — see WindowKind's doc.
        view: defaultPlotView(),
        bg: "theme", // no ◐ toggle on document kinds — they draw their own surfaces
        linkGroup: null, // cursor/x-range sync (item 13) is XY-plot-only
        pinned: false, // never a passive-retarget candidate anyway (kind-guarded)
      };
      set({ plotWindows: [...s.plotWindows, win] });
      return id;
    },
    createWindowAt: (datasetId, x, y) => {
      // Reuses createWindow wholesale (title dedupe, z, defaults) and only
      // re-places the result at the drop point — clamped against the live
      // canvas bounds (same fallback size tileWindows uses when the Plot tab
      // hasn't reported real bounds yet).
      const id = get().createWindow(datasetId);
      set((s) => ({
        plotWindows: s.plotWindows.map((w) =>
          w.id === id
            ? { ...w, geometry: dropGeometry(x, y, s.plotCanvasBounds ?? { width: 1200, height: 800 }) }
            : w,
        ),
      }));
      return id;
    },
    rebindWindow: (windowId, datasetId) => {
      const s = get();
      const win = s.plotWindows.find((w) => w.id === windowId);
      if (!win || !s.datasets.some((d) => d.id === datasetId)) return;
      // Neither a snapshot ("frozen means frozen") nor a panel window (item
      // 19's binding is `panel.datasetIds`, not this field) rebinds on drop.
      if (win.kind === "snapshot" || win.kind === "panel") return;
      get().recordHistory("rebind window");
      if (win.kind === "worksheet" || win.kind === "map") {
        // Item 17: a document window has no PlotView to reset — the explicit
        // drop just retargets which dataset the mounted WorksheetPane/MapStage
        // shows. It's also never the focus target, so focus/activeId/the live
        // singleton fields are all untouched.
        set((st) => ({
          plotWindows: st.plotWindows.map((w) => (w.id === windowId ? { ...w, datasetId } : w)),
        }));
        get().ensureBookData(datasetId); // #38 — same activation-shaped fetch as below
        return;
      }
      if (windowId === s.focusedWindowId) {
        // The focused window's live view IS the singleton fields — apply the
        // exact setActive patch (shared helper), deliberately skipping the
        // pin pre-step: an explicit drop rebinds even a pinned window.
        set((st) => focusedRebindPatch(st, datasetId));
      } else {
        // A background window's view is at rest in its record: rebind + reset
        // it to the same dataset-derived defaults, leaving focus, activeId,
        // and the live singleton fields untouched.
        const ds = s.datasets.find((d) => d.id === datasetId);
        set((st) => ({
          plotWindows: st.plotWindows.map((w) =>
            w.id === windowId ? { ...w, datasetId, view: { ...w.view, ...datasetViewDefaults(ds) } } : w,
          ),
        }));
      }
      // #38: a drop is an activation-shaped gesture — cover the lazy-book
      // fetch for a background target too (single-flight, harmless if live).
      get().ensureBookData(datasetId);
    },
    // Never drops below one PLOT window (item 11 refines the ≥1-window
    // invariant: the last kind:"plot" window can't close even when snapshot
    // windows remain — a snapshot can never hold focus, so it can't be the
    // survivor; snapshot windows themselves always close freely). Closing the
    // FOCUSED window refocuses the top-z surviving PLOT window, hydrating its
    // stored view into the live singleton fields (one of only two hydrateView
    // call sites — the other is focusWindow) and following the same "focus
    // switch" contract focusWindow does below (activeId/selectedIds track the
    // new focus's dataset; transient tool state clears — item 4).
    closeWindow: (id) => (get().recordHistory("close window"),
      set((s) => {
        const target = s.plotWindows.find((w) => w.id === id);
        if (!target) return {}; // id not found
        if (target.kind === "plot" && s.plotWindows.filter((w) => w.kind === "plot").length <= 1)
          return {};
        const remaining = s.plotWindows.filter((w) => w.id !== id);
        const worksheetSelections = dropWorksheetSelection(s.worksheetSelections, id); // #14: no leak
        if (s.focusedWindowId !== id) return { plotWindows: remaining, worksheetSelections };
        const next = remaining.filter((w) => w.kind === "plot").reduce((a, b) => (b.z > a.z ? b : a));
        return {
          plotWindows: remaining,
          worksheetSelections,
          focusedWindowId: next.id,
          activeId: next.datasetId,
          selectedIds: next.datasetId ? [next.datasetId] : [],
          ...hydrateView(next.view),
          ...focusTransientReset(),
        };
      })),
    // The ONLY snapshot+hydrate caller besides closeWindow: freeze the
    // currently-focused window's LIVE view into its record, then hydrate the
    // target window's stored view onto the live singleton fields. A no-op when
    // `id` is already focused, or doesn't exist. Item 4: the window follows the
    // Library (decision #4) — activeId/selectedIds track the newly-focused
    // window's dataset binding (null → the "select a dataset" empty state) —
    // and transient tool/gadget/overlay state clears exactly as a dataset
    // switch does today (`focusTransientReset`, decision #2).
    focusWindow: (id) =>
      set((s) => {
        if (id === s.focusedWindowId) return {};
        const target = s.plotWindows.find((w) => w.id === id);
        if (!target) return {};
        // A non-plot window — snapshot (item 11) or worksheet/map document
        // (item 17) — is never the view-facade focus target: a focus request
        // (e.g. PlotWindowFrame's pointerdown-capture) only raises its z.
        // focusedWindowId stays on the current plot window, the live singleton
        // fields are untouched, and activeId/selectedIds never retarget.
        if (target.kind !== "plot") {
          const top = maxZ(s.plotWindows) + 1;
          return { plotWindows: s.plotWindows.map((w) => (w.id === id ? { ...w, z: top } : w)) };
        }
        const raised = maxZ(s.plotWindows) + 1;
        const plotWindows = s.plotWindows.map((w) => {
          if (w.id === s.focusedWindowId) return { ...w, view: snapshotView(s) };
          if (w.id === id) return { ...w, z: raised };
          return w;
        });
        return {
          plotWindows,
          focusedWindowId: id,
          activeId: target.datasetId,
          selectedIds: target.datasetId ? [target.datasetId] : [],
          ...hydrateView(target.view),
          ...focusTransientReset(),
        };
      }),
    duplicateWindow: (id) => {
      const s = get();
      const src = s.plotWindows.find((w) => w.id === id);
      if (!src) return null;
      get().recordHistory("duplicate window");
      const newId = nextWindowId();
      // Duplicating the FOCUSED window: its record is stale (the live view
      // lives in the singleton fields), so snapshot those instead of `src.view`.
      const view = src.id === s.focusedWindowId ? snapshotView(s) : src.view;
      // Item 10: try the source's OWN displayed title first, deduped against
      // every window's current display — "Comparison" duplicated once becomes
      // "Comparison (2)", not an indistinguishable second "Comparison".
      const title = dedupeWindowTitle(
        displayedWindowTitle(src, s.datasets),
        s.plotWindows.map((w) => displayedWindowTitle(w, s.datasets)),
      );
      const dup: PlotWindow = {
        id: newId,
        // Item 11: duplicating a snapshot window yields another snapshot
        // (kind + frozen bundle carried over) — never a live plot window
        // conjured from frozen data.
        kind: src.kind,
        title,
        datasetId: src.datasetId,
        geometry: cascadeGeometry(s.plotWindows.length),
        z: maxZ(s.plotWindows) + 1,
        winState: "normal",
        view,
        bg: src.bg,
        // Item 13: a duplicate joins the source's link group (matching how it
        // inherits `bg` — "clone this window" includes its comparison links).
        linkGroup: src.linkGroup,
        // A duplicate starts UNPINNED (item 14): pin is per-window protection
        // intent, not display config — inheriting it would silently grow an
        // all-pinned set where every Library click spawns a new window.
        pinned: false,
        ...(src.snapshot ? { snapshot: src.snapshot } : src.panel ? { panel: src.panel } : {}),
      };
      set({ plotWindows: [...s.plotWindows, dup] });
      return newId;
    },
    moveWindow: (id, x, y) =>
      set((s) => ({
        plotWindows: s.plotWindows.map((w) => (w.id === id ? { ...w, geometry: { ...w.geometry, x, y } } : w)),
      })),
    resizeWindow: (id, w, h) =>
      set((s) => ({
        plotWindows: s.plotWindows.map((win) =>
          win.id === id
            ? { ...win, geometry: { ...win.geometry, w: Math.max(1, w), h: Math.max(1, h) } }
            : win,
        ),
      })),
    raiseWindow: (id) =>
      set((s) => ({
        plotWindows: s.plotWindows.map((w) => (w.id === id ? { ...w, z: maxZ(s.plotWindows) + 1 } : w)),
      })),
    setPlotCanvasBounds: (plotCanvasBounds) => set({ plotCanvasBounds }),
    // Tile / Cascade (item 6): only re-lay-out VISIBLE (non-minimized)
    // windows — any that were maximized become "normal" so they actually show
    // side by side/cascaded; minimized windows stay minimized (docked in the
    // strip — item 8). Falls back to a default canvas size when the real
    // bounds aren't known yet (e.g. invoked from the palette before the Plot
    // tab ever mounted). A no-op with fewer than 2 visible windows (nothing to
    // arrange).
    tileWindows: () => (get().recordHistory("tile windows"),
      set((s) => {
        const visible = s.plotWindows.filter((w) => w.winState !== "minimized");
        if (visible.length < 2) return {};
        const bounds = s.plotCanvasBounds ?? { width: 1200, height: 800 };
        const geoms = tileLayout(visible.length, bounds);
        let i = 0;
        return {
          plotWindows: s.plotWindows.map((w) => {
            if (w.winState === "minimized") return w;
            const placed = { ...w, winState: "normal" as WinState, geometry: geoms[i], z: i + 1 };
            i++;
            return placed;
          }),
        };
      })),
    cascadeWindows: () => (get().recordHistory("cascade windows"),
      set((s) => {
        const visible = s.plotWindows.filter((w) => w.winState !== "minimized");
        if (visible.length < 2) return {};
        const geoms = cascadeLayout(visible.length);
        let i = 0;
        return {
          plotWindows: s.plotWindows.map((w) => {
            if (w.winState === "minimized") return w;
            const placed = { ...w, winState: "normal" as WinState, geometry: geoms[i], z: i + 1 };
            i++;
            return placed;
          }),
        };
      })),
    // Minimizing the FOCUSED window hands focus to the top-z remaining VISIBLE
    // window — `closeWindow`'s exact refocus formula, but the window stays IN
    // `plotWindows` (docked in the strip) rather than being removed. A no-op
    // if there's no other visible window to hand focus to (focus just stays
    // put on the now-hidden window — the ≥1-window invariant is about array
    // length, not visibility, so this is a valid, if unusual, state).
    minimizeWindow: (id) => (get().recordHistory("minimize window"),
      set((s) => {
        const target = s.plotWindows.find((w) => w.id === id);
        if (!target || target.winState === "minimized") return {};
        const plotWindows = s.plotWindows.map((w) =>
          w.id === id
            ? { ...w, winState: "minimized" as WinState, view: id === s.focusedWindowId ? snapshotView(s) : w.view }
            : w,
        );
        if (s.focusedWindowId !== id) return { plotWindows };
        // Item 11: only a PLOT window can receive the handed-off focus — a
        // visible snapshot window is skipped (focus stays put if nothing else).
        const candidates = plotWindows.filter(
          (w) => w.id !== id && w.winState !== "minimized" && w.kind === "plot",
        );
        if (candidates.length === 0) return { plotWindows };
        const next = candidates.reduce((a, b) => (b.z > a.z ? b : a));
        return {
          plotWindows,
          focusedWindowId: next.id,
          activeId: next.datasetId,
          selectedIds: next.datasetId ? [next.datasetId] : [],
          ...hydrateView(next.view),
          ...focusTransientReset(),
        };
      })),
    // Restore + focus a minimized window in one step — clicking a strip entry
    // is "bring this back and make it live" (a taskbar button, not just an
    // inert un-minimize), the same snapshot-outgoing/hydrate-incoming contract
    // `focusWindow` uses, plus the winState flip.
    restoreWindow: (id) => (get().recordHistory("restore window"),
      set((s) => {
        const target = s.plotWindows.find((w) => w.id === id);
        if (!target || target.winState !== "minimized") return {};
        // Items 11/17: restoring a non-plot window (snapshot / worksheet /
        // map) un-minimizes + raises it but never focuses it (only plot
        // windows can hold focus — no snapshot/hydrate, no activeId/
        // selectedIds retarget).
        if (target.kind !== "plot") {
          const top = maxZ(s.plotWindows) + 1;
          return {
            plotWindows: s.plotWindows.map((w) =>
              w.id === id ? { ...w, winState: "normal" as WinState, z: top } : w,
            ),
          };
        }
        const raised = maxZ(s.plotWindows) + 1;
        const plotWindows = s.plotWindows.map((w) => {
          if (w.id === id) return { ...w, winState: "normal" as WinState, z: raised };
          if (w.id === s.focusedWindowId) return { ...w, view: snapshotView(s) };
          return w;
        });
        return {
          plotWindows,
          focusedWindowId: id,
          activeId: target.datasetId,
          selectedIds: target.datasetId ? [target.datasetId] : [],
          ...hydrateView(target.view),
          ...focusTransientReset(),
        };
      })),
    // Origin habit: double-clicking a window's title BAR (not its editable
    // title text — that renames, see `renameWindow`) toggles normal<->
    // maximized. A no-op on a minimized window (it has no on-canvas frame to
    // toggle).
    toggleMaximizeWindow: (id) => (get().recordHistory("resize window"),
      set((s) => {
        const target = s.plotWindows.find((w) => w.id === id);
        if (!target || target.winState === "minimized") return {};
        const winState: WinState = target.winState === "maximized" ? "normal" : "maximized";
        return { plotWindows: s.plotWindows.map((w) => (w.id === id ? { ...w, winState } : w)) };
      })),
    renameWindow: (id, title) => (get().recordHistory("rename window"),
      set((s) => ({
        plotWindows: s.plotWindows.map((w) => (w.id === id ? { ...w, title } : w)),
      }))),
    setWindowBg: (id, bg) => (get().recordHistory("change window background"),
      set((s) => ({
        plotWindows: s.plotWindows.map((w) => (w.id === id ? { ...w, bg } : w)),
      }))),
    cycleWindowLinkGroup: (id) => (get().recordHistory("change window link"),
      set((s) => ({
        plotWindows: s.plotWindows.map((w) =>
          w.id === id ? { ...w, linkGroup: nextLinkGroup(w.linkGroup) } : w,
        ),
      }))),
    toggleWindowPin: (id) => (get().recordHistory("toggle window pin"),
      set((s) => ({
        plotWindows: s.plotWindows.map((w) => (w.id === id ? { ...w, pinned: !w.pinned } : w)),
      }))),
    windowsForSave: () => {
      const s = get();
      if (s.focusedWindowId === null) return s.plotWindows;
      return s.plotWindows.map((w) => (w.id === s.focusedWindowId ? { ...w, view: snapshotView(s) } : w));
    },
  };
}
