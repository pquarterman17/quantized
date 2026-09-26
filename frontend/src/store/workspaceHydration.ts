// WORKSPACE HYDRATION, extracted from store/useApp.ts (audit P4.1 —
// "decompose high-risk frontend god-modules, characterization tests first";
// store-size ratchet, MAIN_PLAN #2). Composed into the ONE useApp store
// instance exactly like ./plotViewSettings, ./reportsFigureDocs and
// ./viewAppliers — read store/windows.ts's header first: `useApp` spreads
// `createWorkspaceHydrationSlice(set, get)` into the store, so every
// existing `useApp((s) => ...)` selector and `useApp.getState().loadWorkspace(...)`
// call keeps working. This file is a code boundary, not a second store.
//
// WHAT THIS MODULE OWNS: replacing (or additively joining) the WHOLE library
// from a `.dwk` — `loadWorkspace` (the autosave restore on startup AND an
// explicit File ▸ Open .dwk both run it; a legacy v1 doc's `group` strings
// get promoted to folders (item 6) either way, exactly once) and
// `appendWorkspace` (Origin's "Append Project", MAIN_PLAN #16 — the additive
// opposite: only the flat dataset list + referenced workbooks join the
// CURRENT library; `activeId`, `plotWindows`, every view-state field, and
// the existing datasets are left completely alone).
//
// `appendWorkspace` itself is a ONE-LINE delegate to `runAppendWorkspace`,
// at the bottom of this module. It lived in store/workspaceIO.ts until bundle
// headroom slice 9 made that module (the save half of the same MAIN_PLAN #16
// work) a lazy chunk: `appendWorkspace` is synchronous and keeps its
// synchronous contract, so its body moved here, next to `loadWorkspace` —
// its additive opposite — rather than behind the save chunk's fetch.
//
// WHAT IT DOES NOT OWN, deliberately:
//   - the FIELDS themselves. They stay declared (and initialized) on
//     `AppState` in store/useApp.ts, same shape as every earlier P4.1
//     extraction — this cluster WRITES nearly all of them (a full-library
//     replace has to), but plenty of OTHER actions read and write them too.
//   - `saveWorkspaceToFile`/`saveWorkspace` (the write half of MAIN_PLAN
//     #16/#38) — those stay in useApp.ts, thin delegates to
//     store/workspaceIO.ts (lazily, via store/workspaceIOLazy.ts).
//   - the actual `.dwk` (de)serialize logic (`lib/workspace.ts` and its
//     `workspaceDatasetParse.ts`/`workspaceSerialize.ts`/`workspaceMerge.ts`
//     siblings) and the folder-migration primitive (`lib/foldertree.ts`).
//     This module sequences them onto the store; it decides nothing about
//     what a `.dwk` byte means.
//
// WHAT IT MUST NOT IMPORT: nothing from `../components`, and no React — this
// is store-layer code (architecture.test.ts's "store/ layering guard" enforces
// it; the grandfathered set is three files and only shrinks). Only `lib/`
// pure helpers, sibling store modules, and the `AppState` TYPE from ./useApp
// (type-only, so the runtime import graph stays one-directional:
// useApp -> here).
//
// Characterization tests: store/workspaceHydration.characterization.test.ts
// pins, for both actions and every branch, the exact set of top-level store
// keys each call changes (a poisoned whole-getState() diff), the
// conditionally-PRESENT `toolWindowLayout` key and PlotView-field spread,
// the mapPaintedLimits/mapViews P2.8 reset, and appendWorkspace's undo-entry
// ordering. Written and run GREEN against the pre-extraction code in
// useApp.ts, and passes byte-unchanged against this module.

import { defaultErrKeys, originHiddenChannels } from "../lib/errorbars";
import { migrateGroupsToFolders } from "../lib/foldertree";
import { sanitizeVisibleDetailsColumns } from "../lib/libraryDetailsColumns";
import { hydrateView } from "../lib/plotview";
import { sanitizeTechniqueViewMemory } from "../lib/techniqueViewMemory";
import { nextStageTab } from "../lib/stagetab";
import type { LoadedWorkspace, WorkspaceState } from "../lib/workspace";
import { sanitizeDocumentBackedPlotWindows } from "../lib/windowDocumentPersistence";
import { workspaceCodecOrReport } from "../lib/workspaceCodecLazy";
import { mergeWorkspace } from "../lib/workspaceMerge";
import { nextDatasetId, nextFolderId } from "./idSeq";
import { loadedMapViews } from "./rois"; // loadedMapViews: P2.8, see store/mapView.ts
import { notifyMigrationWarnings, toast } from "./toasts";
import type { AppState } from "./useApp";
import { focusTransientReset, mainWindow } from "./windows";
import { nextWorkbookId } from "./workbookIds";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export interface WorkspaceHydrationSlice {
  // `skipLayout` (PR E2 "Open without layout…") ignores plotWindows/
  // focusedWindowId/toolWindowLayout, falling through to the same default.
  loadWorkspace: (ws: WorkspaceState, options?: { skipLayout?: boolean }) => void;
  // Append a second .dwk's datasets into the CURRENT library (Origin's
  // "Append Project", MAIN_PLAN #16) — the additive opposite of
  // loadWorkspace: only the flat dataset list joins (collision-free ids +
  // names, see lib/workspace.mergeWorkspace); activeId, plotWindows, every
  // view-state field, and the existing datasets are left completely alone.
  appendWorkspace: (ws: LoadedWorkspace) => void;
}

export function createWorkspaceHydrationSlice(set: SliceSet, get: SliceGet): WorkspaceHydrationSlice {
  return {
    // Replace the whole library with a restored workspace (from a .dwk file).
    // Resets every per-dataset view (channels, styles, axis limits) and drops the
    // overlays/markers tied to the old datasets — same hygiene as setActive.
    // Runs on BOTH triggers that call this action: the autosave restore on
    // startup, and an explicit File ▸ Open .dwk — so a legacy v1 doc's `group`
    // strings get promoted to folders (item 6) either way, exactly once.
    loadWorkspace: (ws, options) => {
      set((s) => {
        const skipLayout = options?.skipLayout ?? false; // PR E2, see AppState doc
        // v1/legacy compat: promote any un-foldered `Dataset.group` into a
        // root-level folder before anything else reads `datasets`/`folders` —
        // idempotent, so reloading an already-migrated workspace is a no-op.
        const migrated = migrateGroupsToFolders(ws.folders ?? [], ws.datasets, nextFolderId);
        const datasets = migrated.datasets;
        // Restore the persisted active/selection (v2); v1 or a stale id falls back
        // to the first dataset. Folders + expansion come straight from the doc
        // (plus any folder the group migration just created, auto-revealed).
        const active =
          ws.activeId && datasets.some((d) => d.id === ws.activeId)
            ? ws.activeId
            : (datasets[0]?.id ?? null);
        const activeDs = active ? (datasets.find((d) => d.id === active) ?? null) : null;
        const selected = (ws.selectedIds ?? []).filter((id) => datasets.some((d) => d.id === id));
        // L0.25: the [active] fallback below is a store-level synthesis with
        // no basis in the doc — a non-null librarySelection wins outright.
        const restoredLibrarySelection = ws.librarySelection ?? null;
        // Plot windows (item 7): restore a persisted layout when the doc has one;
        // the document-aware boundary validates it and clamps dead refs. Otherwise (a v1-v6
        // doc with no `plotWindows`, or a genuinely fresh workspace) collapse
        // back to the ≥1-window invariant's single maximized window, bound to
        // the newly-restored active dataset, with a fresh view — unchanged
        // from before item 7.
        const win = mainWindow(active);
        const dsIds = new Set(datasets.map((d) => d.id));
        const migrationWarnings = [...(ws.migrationWarnings ?? [])];
        // skipLayout: an empty `restored` falls through to the fresh-window path.
        const restored = skipLayout
          ? []
          : sanitizeDocumentBackedPlotWindows(ws.plotWindows, dsIds, migrationWarnings);
        const migrationNotice = migrationWarnings[0] ? ` — ${migrationWarnings[0]}${migrationWarnings.length > 1 ? ` (+${migrationWarnings.length - 1} more)` : ""}` : "";
        // Items 11/17: the ≥1-window invariant is specifically ≥1 PLOT window —
        // non-plot kinds (snapshot / worksheet / map) can't hold focus, so a
        // doc whose surviving windows are all non-plot still gets the fresh
        // maximized main window appended; focus then falls back to the first plot window.
        const restoredHasPlot = restored.some((w) => w.kind === "plot");
        const plotWindows = restoredHasPlot ? restored : [...restored, win];
        const focusedWindowId =
          restoredHasPlot &&
          ws.focusedWindowId &&
          plotWindows.some((w) => w.id === ws.focusedWindowId && w.kind === "plot")
            ? ws.focusedWindowId
            : (plotWindows.find((w) => w.kind === "plot") ?? plotWindows[0]).id;
        // A restored layout carries its own PlotView per window — hydrate the
        // FOCUSED one into the live singleton fields immediately so it renders
        // right away, the same "focused window's live view ≡ singletons"
        // invariant `focusWindow`/`closeWindow` already uphold. Null in the
        // legacy/fresh case, so every singleton field below falls through to
        // EXACTLY today's reset (including the errKeys/hiddenChannels smart
        // defaults derived from the active dataset) — zero behavior change
        // when there's no persisted layout to restore.
        const restoredView = restoredHasPlot
          ? hydrateView(plotWindows.find((w) => w.id === focusedWindowId)!.view)
          : null;
        return {
          datasets,
          folders: migrated.folders,
          // MUST be explicit — `set()` merges a PARTIAL state, so omitting this
          // silently leaves the PREVIOUS project's workbooks in place on the
          // newly opened one (a v1-v3 doc has no `workbooks` field at all, and
          // TypeScript won't catch a missing key in an object literal here).
          workbooks: ws.workbooks ?? [],
          expandedFolders: [...new Set([...(ws.expandedFolders ?? []), ...migrated.createdFolderIds])],
          // L0.25/PR E2: restore what THIS doc carries (parseWorkspace already
          // sanitized it), never the PREVIOUS project's stale value.
          librarySelection: restoredLibrarySelection,
          expandedWorkbookIds: ws.expandedWorkbookIds ?? [],
          workbookLastChild: ws.workbookLastChild ?? {},
          activeId: active,
          // item 15: transient UI (like `stageTab`) — a fresh load falls back to activeId.
          worksheetId: null,
          worksheetSelections: {}, // #14: also transient — never round-trips
          // A restored tree selection wins outright, no [active] synthesis.
          selectedIds: restoredLibrarySelection ? [] : selected.length ? selected : active ? [active] : [],
          originFigures: ws.originFigures ?? [], // restored from the .dwk (v2 persists them)
          originFidelity: ws.originFidelity ?? [],
          smartFolders: ws.smartFolders ?? [], // saved queries (item 9) — .dwk persists them
          reports: ws.reports ?? [], // report sheets (#36) — .dwk v2 persists them
          openReportId: null,
          macroSteps: ws.macroSteps ?? [], // typed pipeline (#6) — .dwk v3
          recalcMode: ws.recalcMode ?? "auto", // recalc engine (#1) — .dwk v3
          figureDocs: ws.figureDocs ?? [], // figure documents (#12) — .dwk v3
          editableFigures: ws.editableFigures ?? [],
          pages: ws.pages ?? [],
          figureDocSeed: null, figurePublicationSession: null, pageDocSeed: null,
          savedPlotSpecs: ws.savedPlotSpecs ?? [], // named graphs (#11) — .dwk v3
          quickPlotTemplates: ws.quickPlotTemplates ?? [], // Quick Plot templates (PR H) — .dwk v4 additive
          savedRois: ws.savedRois ?? [], mapViews: loadedMapViews(ws.mapViews, dsIds), mapPaintedLimits: {}, // named ROIs (RSM_CUTS_PLAN #13) — .dwk v3; and P2.8's per-dataset durable map views — .dwk v4 additive, MUST be explicit for the same cross-project-leak reason `workbooks` above is (their colour limits and slice positions are in the PREVIOUS project's units), and `dsIds` so a hand-built WorkspaceState cannot install an entry for a dataset this load does not have. `mapPaintedLimits` is reset the same way and for the same reason (P2.8 review round 3, finding 2): it is transient per-dataset paint state, and a reopened project's dataset ids can collide with the previous project's, leaving a stale "effective" pair on screen. Packed onto one line, not its own: this module is AT its store-size pin (architecture.test.ts) with zero headroom, which is also why the slice composes through store/rois.ts — see store/mapView.ts's header.
          collections: ws.collections ?? [], // saved-search Collections (PR L, L0.48/L0.49) — .dwk v4 additive
          // P1.3 wave 2 (Lane B/C integration fix): `plotRecipes` was already
          // serialized by the whole-state-spread save path (workspaceIO.ts /
          // useWorkspaceAutosave.ts) but never restored here — a load silently
          // dropped every saved recipe AND, worse, left the PREVIOUS project's
          // live list in place (the same cross-project-leak class `workbooks`
          // above calls out). MUST be explicit, same reasoning.
          plotRecipes: ws.plotRecipes ?? [],
          recipeSourcesComplete: ws.recipeSourcesComplete ?? true, // stale `true` would re-certify what THIS load lost
          fitModelCarry: ws.fitModelCarry ?? [], // P2.7: THIS project's unreadable fit models, never the previous one's
          visibleDetailsColumns: sanitizeVisibleDetailsColumns(ws.visibleDetailsColumns), // PR L slice 2 — .dwk v4 additive
          activePlotSpecId: null, // transient binding — a fresh load never resumes mid-edit
          quickFigureBuilderDatasetId: null, // transient UI (like worksheetId) — never resumes on a fresh load
          separatePreview: null, // PR J transient dialog state — never resumes on a fresh load
          // L0.33: transient staging/report state — never resumes on a fresh
          // load, same class as separatePreview above (a stale row would name
          // a dataset id from the PREVIOUS project).
          reimportAllRows: null,
          reimportAllBusy: false,
          reimportAllCommitted: null,
          // P1.3 wave 2: transient preview/confirm state for a staged recipe
          // apply — never resumes on a fresh load, same as separatePreview/
          // quickFigureBuilderDatasetId above (a stale pending would confirm
          // against whatever dataset happens to share its id in the NEW project).
          pendingRecipeApplication: null,
          staleDatasets: [],
          staleFits: [],
          stageTab: activeDs ? nextStageTab(activeDs, s.stageTab) : s.stageTab,
          xKey: restoredView ? restoredView.xKey : null,
          yKeys: restoredView ? restoredView.yKeys : null,
          groupKey: restoredView ? restoredView.groupKey : null,
          facetKey: restoredView ? restoredView.facetKey : null,
          y2Keys: restoredView ? restoredView.y2Keys : null,
          y2Lim: restoredView ? restoredView.y2Lim : null,
          y2Scale: restoredView ? restoredView.y2Scale : null,
          y2Step: restoredView ? restoredView.y2Step : null,
          y2AxisLabel: restoredView ? restoredView.y2AxisLabel : "",
          seriesStyles: restoredView ? restoredView.seriesStyles : {},
          seriesLabels: restoredView ? restoredView.seriesLabels : {},
          errKeys: restoredView ? restoredView.errKeys : activeDs ? defaultErrKeys(activeDs.data) : {},
          seriesOrder: restoredView ? restoredView.seriesOrder : null,
          hiddenChannels: restoredView
            ? restoredView.hiddenChannels
            : activeDs
              ? originHiddenChannels(activeDs.data)
              : [],
          xLim: restoredView ? restoredView.xLim : null,
          yLim: restoredView ? restoredView.yLim : null,
          xStep: restoredView ? restoredView.xStep : null,
          yStep: restoredView ? restoredView.yStep : null,
          fitOverlay: null,
          peakOverlay: null,
          baselineOverlay: null,
          peakWizardEdit: null,
          // NOT baselineAnchorEdit: the useBaseline hook owns it and re-pushes
          // (with a cleared anchor list) on dataset change — nulling it here
          // would fight that effect's cleanup ordering.
          // `composition` (#54, ephemeral) + rsmPeaks..gadgetCursorResult — the
          // SAME transient-tool clear a dataset/focus switch applies elsewhere
          // (windows.ts's `focusTransientReset`); one field list to maintain.
          ...focusTransientReset(),
          // PLOT_WORKFLOW_PLAN item 5: additive — absent on a pre-item-5 .dwk
          // sanitizes to {} (lib/workspace.ts's own undefined-input path).
          techniqueViewMemory: sanitizeTechniqueViewMemory(ws.techniqueViewMemory),
          plotWindows,
          focusedWindowId,
          // #10 item 3: viewport-clamped by parseWorkspace. skipLayout: OMIT
          // the key so `set()`'s merge leaves the layout untouched.
          ...(skipLayout ? {} : { toolWindowLayout: ws.toolWindowLayout ?? {} }),
          // The rest of the PlotView cluster (item 7) — only touched when
          // restoring an actual persisted layout; the legacy/fresh path never
          // wrote these here before item 7, so they're left alone (whatever the
          // pre-load session had) exactly as before. `restoredView` is exactly
          // the VIEW_KEYS set (hydrateView) and the store is a superset, so this
          // spread writes the identical field set the group above re-lists on the
          // restore path — one place to maintain as PlotView grows, not two.
          ...(restoredView ?? {}),
          status: `loaded workspace — ${datasets.length} dataset${datasets.length === 1 ? "" : "s"}${migrationNotice}`,
        };
      });
      adoptFitModels(ws, set, get);
    },
    appendWorkspace: (ws) => runAppendWorkspace(set, get, ws),
  };
}

/** P2.7 follow-up: merge a loaded/appended project's saved fit models into
 *  the local library — lib/fitModelsProject.ts's `adoptProjectFitModels` has
 *  the rule and the one toast. Called AFTER the caller's own `set()` has put
 *  the carry in place (synchronously, so a crash or a second open in between
 *  cannot lose or misplace it); `get().fitModelCarry` is passed so the async
 *  merge writes to that carry only if no other load replaced it. Reached
 *  through the `.dwk` codec, so none of it costs eager bytes; usually already
 *  loaded, except after the browser picker's Worker parse, when this is its
 *  first fetch (a failure is toasted by the loader). */
function adoptFitModels(ws: WorkspaceState, set: SliceSet, get: SliceGet): void {
  const expected = get().fitModelCarry;
  if (ws.customFitModels?.length)
    void workspaceCodecOrReport("Adding the project's fit models", noop).then((c) =>
      c?.adoptProjectFitModels(ws, set, expected),
    );
}
const noop = (): void => {};

/** Append Project (MAIN_PLAN #16, workbook transfer LIBRARY_WORKBOOK_UX_PLAN
 *  PR A4): join a freshly-parsed .dwk's flat dataset list AND its referenced
 *  workbooks into the currently loaded library. See
 *  lib/workspaceMerge.mergeWorkspace for the full reference-field matrix of
 *  what is (and deliberately isn't) merged in. `recordHistory` runs BEFORE
 *  the mutation, and `workbooks` is already part of `HistorySnapshot`
 *  (history.ts), so undo restores the pre-append workbook list for free —
 *  same as it already does for `datasets`. */
function runAppendWorkspace(set: SliceSet, get: SliceGet, ws: LoadedWorkspace): void {
  const n = ws.datasets.length;
  if (n === 0) {
    toast("workspace has no datasets to append", "danger");
    return;
  }
  get().recordHistory("append workspace");
  const currentWorkbookIds = new Set(get().workbooks.map((w) => w.id));
  const { datasets, renamed, workbooks } = mergeWorkspace(
    get().datasets,
    ws,
    nextDatasetId,
    currentWorkbookIds,
    nextWorkbookId,
  );
  const wbNote =
    workbooks.length > 0
      ? ` — ${workbooks.length} workbook${workbooks.length === 1 ? "" : "s"} landed at Library root`
      : "";
  const msg = `appended ${n} dataset${n === 1 ? "" : "s"} (${renamed} renamed)${wbNote}`;
  // P2.7: the appended file's unaccepted fit models JOIN the carry (and so
  // un-certify the Recipe Library) in the same set() as its datasets.
  const carry = ws.fitModelCarry ?? [];
  set({
    datasets,
    workbooks: [...get().workbooks, ...workbooks],
    status: msg,
    ...(carry.length ? { fitModelCarry: [...get().fitModelCarry, ...carry], recipeSourcesComplete: false } : {}),
  });
  toast(msg, "ok");
  adoptFitModels(ws, set, get);
  // BUG-010: `ws.migrationWarnings` (produced when the appended .dwk was
  // parsed) has no status-line fold here at all — this never routes through
  // loadWorkspace — so the toast is its only surface.
  notifyMigrationWarnings(ws.migrationWarnings);
}
