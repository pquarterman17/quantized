// Window-slice helpers shared across the store (ids/z-order, focus handoff,
// rebind patches, the main-window factory), moved verbatim out of
// store/windows.ts (store-size ratchet) and re-exported from there, so no
// importer changed. Only TYPE imports cross back into useApp (no runtime cycle).

import { captureTechniqueView } from "../lib/techniqueViewMemory";
import { dedupeWindowTitle, displayedWindowTitle, hydrateView, snapshotView, type PlotView, type PlotWindow, type WinState, type WindowGeometry } from "../lib/plotview";
import { plotIntentStageTab } from "../lib/stagetab";
import { workbookDisclosurePatch } from "./libraryPanel";
import type { AppState } from "./useApp";
import { syncPlotWindow } from "./windowDocuments";
import { datasetViewDefaults, mainWindow as createMainWindow } from "./windowDefaults";
// Window ids get their own sequence (dataset/folder/report ids keep useApp's)
// — the `win-` prefix + timestamp keeps them collision-free across both.
let _winSeq = 0;
export const nextWindowId = (): string => `win-${Date.now().toString(36)}-${++_winSeq}`;

/** The highest z among a window list (0 if empty) — z-order helper shared by
 *  every action that raises a window (focus/raise/create/duplicate). */
export const maxZ = (windows: readonly PlotWindow[]): number =>
  windows.reduce((m, w) => Math.max(m, w.z), 0);
/** `dedupeWindowTitle(base, ...)` against every window's CURRENTLY DISPLAYED title (item 10). */
export function dedupeAgainstDisplayed(s: AppState, base: string): string {
  return dedupeWindowTitle(base, s.plotWindows.map((w) => displayedWindowTitle(w, s.datasets)));
}
/** Tile/Cascade's shared body (item 6): place every VISIBLE window into
 *  `geoms` in z-order, un-maximizing it; minimized windows pass through. */
export function _relayoutVisible(s: AppState, geoms: readonly WindowGeometry[]): Partial<AppState> {
  let i = 0;
  return {
    plotWindows: s.plotWindows.map((w) => {
      if (w.winState === "minimized") return w;
      const placed = { ...w, winState: "normal" as WinState, geometry: geoms[i], z: i + 1 };
      i++;
      return placed;
    }),
  };
}
/** Shared "make `id` the live focus" tail for closeWindow/focusWindow/
 *  minimizeWindow/restoreWindow: hydrate `view` onto the singleton fields
 *  and clear transient tool state (item 4), over the caller's `extra`. */
export function _focusHandoff(extra: Partial<AppState>, id: string, datasetId: string | null, view: PlotView): Partial<AppState> {
  return {
    ...extra,
    focusedWindowId: id,
    activeId: datasetId,
    selectedIds: datasetId ? [datasetId] : [],
    // L0.25 (audit fix): focus onto a BOUND dataset is an activation and
    // clears the tree selection; an unbound window leaves it (import target).
    ...(datasetId ? { librarySelection: null } : {}),
    ...hydrateView(view),
    ...focusTransientReset(),
  };
}
/** A brand-new sole main window — the ≥1-window invariant's default: one
 *  MAXIMIZED window bound to `datasetId`, with a fresh view (MULTI_PLOT_PLAN
 *  decision #6 — pixel-identical to today's single-plot Stage). Used at store
 *  init and whenever `loadWorkspace` resets the whole view (a fresh workspace
 *  has no windows to restore yet — item 7 wires `.dwk` persistence). */
export const mainWindow = (datasetId: string | null): PlotWindow =>
  createMainWindow(datasetId, nextWindowId());

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
 *  hints — see lib/errorbars); with `outgoing`, data-tied marks and tick
 *  formats too. Window style (grid, legend, template, title, …) is absent —
 *  same as `setActive` has always behaved, EXCEPT axis scale (item 2):
 *  `prevDs` gates the technique-defaults table to a genuine technique change
 *  (`lib/techniqueDefaults.isTechniqueChange`), so log axes still survive a
 *  same-technique switch; an omitted `prevDs` (import/split/reimport) always
 *  counts as a change — there's no prior view worth preserving. */
export { datasetViewDefaults } from "./windowDefaults";

/** The full state patch for rebinding the FOCUSED window to dataset `id` —
 *  `setActive`'s entire body, hoisted so `rebindWindow`'s focused-target path
 *  (item 14) applies the IDENTICAL semantics without the pin pre-step (an
 *  explicit drop beats the passive pin). See `setActive`'s own doc for the
 *  per-field reasoning that used to live inline here. */
export function focusedRebindPatch(s: AppState, id: string): Partial<AppState> {
  const ds = s.datasets.find((d) => d.id === id);
  // Item 5: capture the OUTGOING view into its technique's memory slot
  // before computing the incoming patch (unused on the no-op path below).
  const prevDs = s.datasets.find((d) => d.id === s.activeId);
  const memory = captureTechniqueView(prevDs, s, s.techniqueViewMemory);
  const viewPatch = s.activeId === id ? {} : datasetViewDefaults(ds, prevDs, memory, { outgoing: s });
  const nextView = { ...snapshotView(s), ...viewPatch };
  return {
    activeId: id,
    ...workbookDisclosurePatch(s, ds), // PR C: activation discloses the sheet's workbook
    // A full plot-intent activation always drops any worksheet-only override
    // (item 15) — the plot it now shows IS `id`, so the Worksheet tab's
    // `worksheetId ?? activeId` fallback already tracks it; a stale override
    // would otherwise strand the worksheet on the PREVIOUS browse target.
    worksheetId: null,
    selectedIds: [id], librarySelection: null, // L0.25: setActive exits folder/workbook selection too
    // MULTI_PLOT_PLAN item 4: scoped to the FOCUSED window — it rebinds that
    // window's dataset (unfocused windows keep whatever they're pinned to,
    // decision #4).
    plotWindows: s.plotWindows.map((w) =>
      w.id === s.focusedWindowId
        ? syncPlotWindow(w, nextView, { datasetId: id, errors: ds?.errorRoles, resetErrors: true, resetAxisBreaks: s.activeId !== id }) // resetAxisBreaks (review F4, windowDocuments.ts): same genuine-switch test `viewPatch` uses
        : w,
    ),
    // setActive IS the plot-intent primitive (item 15's DatasetRow "Plot
    // (make active)", every applyOriginFigure branch, a plain Library click
    // on a non-Origin dataset, …) — unlike a fresh import/workspace restore,
    // it always means "show me the plot", so it uses `plotIntentStageTab`
    // (never sticks on a stale Worksheet tab; owner-routing item 1).
    stageTab: ds ? plotIntentStageTab(ds) : s.stageTab,
    ...(s.activeId === id ? {} : { ...viewPatch, techniqueViewMemory: memory }), // #12 slice 4b + item 5: a GENUINE dataset switch resets channel-keyed defaults (or applies technique memory) AND commits the capture above; re-activating the id that's ALREADY active (facetByColumn/breakAtGaps's trailing setActive) must not clobber a selection the caller just made — exportParity2.test.ts 8b
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
  const title = titleBase !== undefined ? dedupeAgainstDisplayed(s, titleBase) : undefined;
  s.focusWindow(s.createWindow(datasetId, undefined, title));
}
