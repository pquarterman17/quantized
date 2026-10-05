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
// they are window-shaped — and are exported for `setActive` (./datasetSelection),
// `addDataset` (./useApp) and `loadWorkspace`. Only TYPE imports cross back into
// useApp (no runtime cycle).

import { captureTechniqueView } from "../lib/techniqueViewMemory";
import {
  cascadeLayout,
  defaultPlotView,
  displayedWindowTitle,
  dropGeometry,
  nextLinkGroup,
  snapshotView,
  tileLayout,
  type PlotWindow,
  type WinState,
} from "../lib/plotview";
import { fitNewWindowGeometry, newWindowGeometry } from "../lib/plotWindows";
import { toast } from "./toasts";
import type { AppState } from "./useApp";
import { createPlotWindowDocument, plotWindowDatasetId, plotWindowView, syncPlotWindow } from "./windowDocuments";
import { datasetViewDefaults } from "./windowDefaults";
import { _focusHandoff, _relayoutVisible, dedupeAgainstDisplayed, focusedRebindPatch, mainWindow, maxZ, nextWindowId } from "./windowFocus";
import type { WindowsSlice } from "./windowsSliceTypes";
import { dropWorksheetSelection } from "./worksheetSelection";

// Moved-out helpers + the slice contract (store-size ratchet), re-exported so no importer changed.
export { datasetViewDefaults, focusedRebindPatch, focusTransientReset, mainWindow, maxZ, nextWindowId, retargetPassiveRebind } from "./windowFocus";
export type { WindowsSlice } from "./windowsSliceTypes";

// The store-facing handles the slice builds against — the exact subset of
// Zustand's initializer arguments the window actions use (partial patches +
// functional patches; never `replace`). `useApp`'s own `set`/`get` satisfy
// these, so composition is `...createWindowsSlice(set, get)`.
type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** Append a window without hiding it behind the full-bleed starter plot.
 * The first transition from one maximized window to two visible windows is
 * the teachable moment for MDI: reveal both side by side once, then leave all
 * later positioning entirely manual unless the user chooses Tile/Cascade. */
function appendWindow(s: AppState, win: PlotWindow): PlotWindow[] {
  const plotWindows = [...s.plotWindows, win];
  const visible = s.plotWindows.filter((item) => item.winState !== "minimized");
  if (visible.length !== 1 || visible[0].winState !== "maximized") return plotWindows;
  const bounds = s.plotCanvasBounds ?? { width: 1200, height: 800 };
  return (
    _relayoutVisible({ ...s, plotWindows }, tileLayout(2, bounds)).plotWindows ??
    plotWindows
  );
}

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
    techniqueViewMemory: {},
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
          dedupeAgainstDisplayed(
            s,
            boundId ? (s.datasets.find((d) => d.id === boundId)?.name ?? "Untitled graph") : "Untitled graph",
          );
        const seedView = view ?? defaultPlotView();
        const dataset = boundId ? s.datasets.find((d) => d.id === boundId) : undefined;
        const win: PlotWindow = {
          id,
          kind: "plot",
          title: resolvedTitle,
          datasetId: boundId,
          geometry: newWindowGeometry(s),
          z: maxZ(s.plotWindows) + 1,
          winState: "normal",
          view: seedView,
          document: createPlotWindowDocument(id, resolvedTitle, boundId, seedView, {
            errors: dataset?.errorRoles,
          }),
          bg: "theme",
          linkGroup: null,
          pinned: false,
        };
        return { plotWindows: appendWindow(s, win) };
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
      const title = dedupeAgainstDisplayed(s, `Snapshot — ${displayedWindowTitle(src, s.datasets)}`);
      const win: PlotWindow = {
        id,
        kind: "snapshot",
        title,
        datasetId: null,
        geometry: newWindowGeometry(s),
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
      set((state) => ({ plotWindows: appendWindow(state, win) }));
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
      const title = dedupeAgainstDisplayed(s, ds?.name ?? "Untitled");
      const win: PlotWindow = {
        id,
        kind,
        title,
        datasetId: ds ? ds.id : null,
        geometry: newWindowGeometry(s),
        z: maxZ(s.plotWindows) + 1,
        winState: "normal",
        // Required by the model, unused by a document window (the mounted
        // WorksheetPane/MapStage never read a PlotView) — see WindowKind's doc.
        view: defaultPlotView(),
        bg: "theme", // no ◐ toggle on document kinds — they draw their own surfaces
        linkGroup: null, // cursor/x-range sync (item 13) is XY-plot-only
        pinned: false, // never a passive-retarget candidate anyway (kind-guarded)
      };
      set((state) => ({ plotWindows: appendWindow(state, win) }));
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
            ? { ...w, geometry: fitNewWindowGeometry(dropGeometry(x, y, s.plotCanvasBounds ?? { width: 1200, height: 800 }), s.plotCanvasBounds) }
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
        // it to the same/memory-derived defaults, leaving focus untouched.
        const ds = s.datasets.find((d) => d.id === datasetId);
        const priorDs = s.datasets.find((d) => d.id === win.datasetId);
        const currentView = plotWindowView(win);
        const memory = captureTechniqueView(priorDs, currentView, s.techniqueViewMemory); // item 5
        const reboundView = { ...currentView, ...datasetViewDefaults(ds, priorDs, memory, { outgoing: currentView }) };
        set((st) => ({
          plotWindows: st.plotWindows.map((w) =>
            w.id === windowId
              ? syncPlotWindow(w, reboundView, { datasetId, errors: ds?.errorRoles, resetErrors: true, resetAxisBreaks: true }) // this branch always applies datasetViewDefaults wholesale, so review F4's reset is unconditional
              : w,
          ),
          techniqueViewMemory: memory,
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
        if (target.kind === "plot" && s.plotWindows.filter((w) => w.kind === "plot").length <= 1) return {};
        const remaining = s.plotWindows.filter((w) => w.id !== id);
        const worksheetSelections = dropWorksheetSelection(s.worksheetSelections, id), sessionPatch = s.figurePublicationSession?.target === "window" && s.figurePublicationSession.windowId === id ? (toast("Publication Preview closed — its plot window was closed", "danger"), { figurePublicationSession: null, figureBuilderOpen: false }) : {}; // #14: no leak; item 3a: a window-target session can't outlive its target window closing
        if (s.focusedWindowId !== id) return { plotWindows: remaining, worksheetSelections, ...sessionPatch };
        const next = remaining.filter((w) => w.kind === "plot").reduce((a, b) => (b.z > a.z ? b : a));
        return _focusHandoff(
          { plotWindows: remaining, worksheetSelections, ...sessionPatch },
          next.id,
          plotWindowDatasetId(next),
          plotWindowView(next),
        );
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
          if (w.id === s.focusedWindowId) return syncPlotWindow(w, snapshotView(s));
          if (w.id === id) return { ...w, z: raised };
          return w;
        });
        return _focusHandoff({ plotWindows }, id, plotWindowDatasetId(target), plotWindowView(target));
      }),
    duplicateWindow: (id) => {
      const s = get();
      const src = s.plotWindows.find((w) => w.id === id);
      if (!src) return null;
      get().recordHistory("duplicate window");
      const newId = nextWindowId();
      // Duplicating the FOCUSED window: its record is stale (the live view
      // lives in the singleton fields), so snapshot those instead of `src.view`.
      const view = src.id === s.focusedWindowId ? snapshotView(s) : plotWindowView(src);
      // Item 10: try the source's OWN displayed title first, deduped against
      // every window's current display — "Comparison" duplicated once becomes
      // "Comparison (2)", not an indistinguishable second "Comparison".
      const title = dedupeAgainstDisplayed(s, displayedWindowTitle(src, s.datasets));
      const dup: PlotWindow = {
        id: newId,
        // Item 11: duplicating a snapshot window yields another snapshot
        // (kind + frozen bundle carried over) — never a live plot window
        // conjured from frozen data.
        kind: src.kind,
        title,
        datasetId: plotWindowDatasetId(src),
        geometry: newWindowGeometry(s),
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
      if (dup.kind === "plot") {
        const sourceDocument = src.document;
        dup.document = createPlotWindowDocument(newId, title, plotWindowDatasetId(src), view, {
          previous: sourceDocument,
          freshIdentity: true, // else Save on the copy overwrites the ORIGINAL saved figure
        });
      }
      set((state) => ({ plotWindows: appendWindow(state, dup) }));
      return newId;
    },
    setWindowGeometry: (id, geometry) => set((s) => ({
      plotWindows: s.plotWindows.map((win) => win.id === id ? {
        ...win, geometry: {
          ...win.geometry, ...geometry,
          w: Math.max(1, geometry.w ?? win.geometry.w), h: Math.max(1, geometry.h ?? win.geometry.h),
        },
      } : win),
    })),
    moveWindow: (id, x, y) => get().setWindowGeometry(id, { x, y }),
    resizeWindow: (id, w, h) => get().setWindowGeometry(id, { w, h }),
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
        return _relayoutVisible(s, tileLayout(visible.length, bounds));
      })),
    cascadeWindows: () => (get().recordHistory("cascade windows"),
      set((s) => {
        const visible = s.plotWindows.filter((w) => w.winState !== "minimized");
        if (visible.length < 2) return {};
        return _relayoutVisible(s, cascadeLayout(visible.length));
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
            ? {
                ...(id === s.focusedWindowId ? syncPlotWindow(w, snapshotView(s)) : w),
                winState: "minimized" as WinState,
              }
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
        return _focusHandoff(
          { plotWindows },
          next.id,
          plotWindowDatasetId(next),
          plotWindowView(next),
        );
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
          if (w.id === s.focusedWindowId) return syncPlotWindow(w, snapshotView(s));
          return w;
        });
        return _focusHandoff({ plotWindows }, id, plotWindowDatasetId(target), plotWindowView(target));
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
        plotWindows: s.plotWindows.map((w) =>
          w.id === id
            ? w.kind === "plot"
              ? syncPlotWindow(w, w.id === s.focusedWindowId ? snapshotView(s) : plotWindowView(w), { title })
              : { ...w, title }
            : w,
        ),
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
      return s.plotWindows.map((w) =>
        w.id === s.focusedWindowId ? syncPlotWindow(w, snapshotView(s)) : w,
      );
    },
  };
}
