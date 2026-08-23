// Workspace autosave wiring, extracted from App.tsx (component-ceiling
// ratchet — org plan #10 direction): restore the autosaved library once on
// startup, then debounce-save whenever the persisted workspace slice changes.
// The storage half lives in lib/autosave; this hook is only the store bridge.
//
// BROWSER MULTI-TAB (coordinator review round, M1): the autosave slot itself
// — one shared IndexedDB/localStorage store per browser origin, read on
// every startup and written on every debounced save below — is the actual
// same-browser collision surface for a plain `qz` browser tab: unlike a
// desktop session, a browser tab carries no real project PATH the lock
// machine can key on (a browser-picker open never gets a `native` identity —
// see `lib/openWorkspaceReplace.ts` — and quick-save falls straight to a
// download, `store/workspaceIO.ts`'s `runSaveWorkspace`), so two tabs of the
// same browser silently autosaving into the SAME slot got zero protection
// even after `lib/browserLockProvider.ts` landed as a provider nothing yet
// called. `BROWSER_AUTOSAVE_LOCK_PATH` is a synthetic, stable "project path"
// naming that ONE shared slot — not a real file, but a stable key the
// EXISTING lock state machine (`store/projectLock.ts`) can track exactly
// like a real `.dwk` path, so two tabs restoring/autosaving into it get the
// same read-only / Take Over Editing protection a real file gets. Only ever
// engaged for browser sessions (`App.tsx`'s install effect, gated on
// `!hasDesktopShell()`) — two separate `qz --desktop` processes do not share
// this storage at all, so there is nothing here for them to contend over.
// `engageBrowserAutosaveLock` is the one new state-machine ENTRY POINT this
// wiring adds a caller for (`openProject`, unchanged); the debounced-save
// effect's own gate below reads `canWriteNow()`, also unchanged — no new
// semantics in `store/projectLock.ts`/`lib/lockState.ts` themselves.
//
// SCOPE, STATED HONESTLY: this covers the AUTOSAVE SLOT only. A browser tab
// explicitly opening or saving a NAMED `.dwk` (the file-picker open / the
// blob-download quick-save) still gets no lock protection at all — neither
// carries a stable identity the browser LockProvider could key on the same
// way, and wiring that is a materially larger change (giving a browser-
// picked file a durable identity) this task's scope did not ask for. See
// `store/projectLock.ts`'s own header for the fuller, up-to-date account.

import { useEffect } from "react";

import { autosaveHealth, loadAutosaveGeneration, saveAutosave } from "./lib/autosave";
import { shouldOfferRecoveryChoice, type LastProjectRef } from "./lib/recoveryChoice";
import { installSessionMarker, priorSessionEnd } from "./lib/sessionMarker";
import { captureTechniqueView } from "./lib/techniqueViewMemory";
import { reportAutosaveHealth } from "./store/autosaveStatus";
import { useProjectLock } from "./store/projectLock";
import { useRecentProjects } from "./store/recentProjects";
import { useRecoveryChoice } from "./store/recoveryChoice";
import { toast } from "./store/toasts";
import { useApp, type AppState } from "./store/useApp";
import { stageWorkspaceRestore } from "./store/windowHydration";

/** Synthetic, stable "project path" for the shared browser autosave slot —
 *  see this module's header. Exported so App.tsx's install effect and this
 *  module's own debounced-save gate always agree on the exact same key. */
export const BROWSER_AUTOSAVE_LOCK_PATH = "qz://browser-autosave-session";

/** Engage the lock state machine for the shared browser autosave slot —
 *  called once by App.tsx's install effect, right after the browser
 *  `LockProvider` is set (ordering matters: `openProject` must see the REAL
 *  provider, never the process-local in-memory default it replaces).
 *  `openProject` is the EXISTING entry point (`store/projectLock.ts`) — this
 *  function adds no new one; it only decides WHEN to call it and how to
 *  report a read-only result, mirroring
 *  `lib/openWorkspaceReplace.ts`'s `registerWithLockStateMachine` toast for
 *  a real native open. Exported for direct testing (see
 *  useWorkspaceAutosave.test.ts's "browser autosave lock" tests) — App.tsx
 *  itself has no dedicated test file. */
export async function engageBrowserAutosaveLock(): Promise<void> {
  const result = await useProjectLock.getState().openProject(BROWSER_AUTOSAVE_LOCK_PATH);
  if (!result.readOnly) return;
  const reason =
    result.status === "held-by-other-stale"
      ? "another tab (unresponsive) has this browser session open — Take Over Editing is available"
      : "another tab has this browser session open for editing — opened read-only";
  toast(reason, "info");
}

function lastKnownProject(): LastProjectRef | null {
  const entry = useRecentProjects.getState().recentProjects[0];
  return entry ? { name: entry.name, path: entry.path, at: Date.parse(entry.at) } : null;
}

/** Every store field serialized into a .dwk workspace. Keep this list in one
 * place so autosave cannot silently omit a newly-persisted artifact — its
 * test file's "AutosaveState completeness sweep" cross-checks it against
 * lib/workspace.ts's real WorkspaceDoc shape so this can't drift unnoticed. */
export type AutosaveState = Pick<
  AppState,
  | "datasets"
  | "folders"
  | "activeId"
  | "selectedIds"
  | "expandedFolders"
  | "originFigures"
  // P2-1 (adversarial review, 2026-08-18): `originFidelity` persists
  // (lib/workspace.ts) and mutates independently via
  // store/originImport.ts's `addOriginFidelity` — no other tracked field
  // necessarily changes alongside it.
  | "originFidelity"
  | "smartFolders"
  | "reports"
  | "macroSteps"
  | "recalcMode"
  | "figureDocs"
  | "editableFigures"
  | "pages"
  | "plotWindows"
  | "focusedWindowId"
  // P2-1: persists (lib/workspace.ts) and mutates independently via
  // store/toolwindows.ts's setToolWindowLayout/toggleToolWindowCollapsed/
  // resetToolWindowPositions — dragging or collapsing a tool window
  // previously left the dirty marker false and scheduled no autosave.
  | "toolWindowLayout"
  | "savedPlotSpecs"
  // P2-1: PR H's saved Quick Plot templates — persist, mutate independently
  // (store/quickPlotTemplates.ts), had no trigger here.
  | "quickPlotTemplates"
  // LIBRARY_WORKBOOK_UX_PLAN PR E2: the three Library-panel fields
  // store/libraryPanel.ts's header marks "transient, E2 owns persistence".
  | "librarySelection"
  | "workbookLastChild"
  | "expandedWorkbookIds"
  // Post-merge review fix: two more persisted fields with NO trigger here —
  // renameWorkbook/moveWorkbookToFolder only mutate `workbooks`, and saving/
  // deleting a named ROI only mutates `savedRois`, so either edit could sit
  // unsaved until some unrelated field also changed.
  | "workbooks"
  | "savedRois"
  // P2-1: PR L's saved-search Collections — persist, mutate independently
  // (store/collections.ts), had no trigger here. A Collection rename/save
  // left the title bar showing clean right up to a crash.
  | "collections"
  // PR L slice 2: the Details view's selected metadata columns — persist
  // (lib/workspace.ts), mutate independently (store/libraryDetailsColumns.ts),
  // same completeness-sweep class as collections/quickPlotTemplates above.
  | "visibleDetailsColumns"
  // P1.3 wave 2 integration fix (finding 2): saved Plot Recipes — persist
  // (lib/workspace.ts), mutate independently (store/plotRecipes.ts's
  // save/rename/delete/duplicate CRUD), same completeness-sweep class as
  // collections/quickPlotTemplates above. Was already serialized by the
  // whole-state-spread save path with no trigger here — a recipe CRUD edit
  // left the title bar showing clean right up to a crash.
  | "plotRecipes"
>;

export function shouldAutosave(state: AutosaveState, prev: AutosaveState): boolean {
  return !(
    state.datasets === prev.datasets &&
    state.folders === prev.folders &&
    state.activeId === prev.activeId &&
    state.selectedIds === prev.selectedIds &&
    state.expandedFolders === prev.expandedFolders &&
    state.originFigures === prev.originFigures &&
    state.originFidelity === prev.originFidelity &&
    state.smartFolders === prev.smartFolders &&
    state.reports === prev.reports &&
    state.macroSteps === prev.macroSteps &&
    state.recalcMode === prev.recalcMode &&
    state.figureDocs === prev.figureDocs &&
    state.editableFigures === prev.editableFigures &&
    state.pages === prev.pages &&
    state.plotWindows === prev.plotWindows &&
    state.focusedWindowId === prev.focusedWindowId &&
    state.toolWindowLayout === prev.toolWindowLayout &&
    state.savedPlotSpecs === prev.savedPlotSpecs &&
    state.quickPlotTemplates === prev.quickPlotTemplates &&
    state.librarySelection === prev.librarySelection &&
    state.workbookLastChild === prev.workbookLastChild &&
    state.expandedWorkbookIds === prev.expandedWorkbookIds &&
    state.workbooks === prev.workbooks &&
    state.savedRois === prev.savedRois &&
    state.collections === prev.collections &&
    state.visibleDetailsColumns === prev.visibleDetailsColumns &&
    state.plotRecipes === prev.plotRecipes
  );
}

export function useWorkspaceAutosave(): void {
  const setStatus = useApp((s) => s.setStatus);

  // Restore the autosaved library once on startup (before any new import).
  useEffect(() => {
    // Async since #32 (IndexedDB has no sync mode). `cancelled` guards the
    // StrictMode double-invoke and an unmount mid-read — restoring into a
    // torn-down store would clobber whatever the user did in between.
    let cancelled = false;
    // Read how the PREVIOUS session ended before marking this one active —
    // installSessionMarker overwrites the flag.
    const priorEnd = priorSessionEnd();
    const teardown = installSessionMarker();
    void loadAutosaveGeneration().then((picked) => {
      if (cancelled || !picked?.workspace.datasets.length) return;
      const { workspace: restored, at: autosaveAt } = picked;
      // P1.2 box 5: only when there IS a named last project AND the
      // candidate is actually newer does silent auto-restore stop being
      // safe — see lib/recoveryChoice.ts's header for the full reasoning.
      const lastProject = lastKnownProject();
      if (shouldOfferRecoveryChoice(autosaveAt, lastProject)) {
        useRecoveryChoice.getState().offerRecovery({
          workspace: restored,
          autosaveAt,
          datasetCount: restored.datasets.length,
          lastProject: lastProject as LastProjectRef,
        });
        return;
      }
      useApp.getState().loadWorkspace(restored);
      stageWorkspaceRestore(useApp.getState().plotWindows, useApp.getState().focusedWindowId);
      const n = restored.datasets.length;
      const what = `${n} dataset${n === 1 ? "" : "s"}`;
      if (priorEnd === "unclean") {
        setStatus(`recovered ${what} after an unexpected close`);
        toast(`Recovered ${what} after an unexpected close — check your latest edits`, "info");
      } else {
        setStatus(`restored ${what} from autosave`);
      }
    });
    return () => {
      cancelled = true;
      teardown();
    };
  }, [setStatus]);

  // Debounced autosave whenever the library changes (identity comparisons).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useApp.subscribe((state, prev) => {
      // Persist on any change to the workspace slice — datasets OR the folder
      // tree / expansion / active / selection (all part of .dwk v2) / the
      // saved smart-folder queries (org #9) / the plot window layout
      // (MULTI_PLOT_PLAN item 7 — geometry/z/winState/dataset-binding changes
      // bump the `plotWindows` array reference; a focus switch bumps
      // `focusedWindowId`). A live-view-only edit on the focused window
      // WITHOUT any of those structural changes doesn't reset this debounce
      // by itself — same pre-existing tradeoff `figureDocs`/`reports`/
      // `macroSteps` already have here (this hook watches a curated subset,
      // not every persisted field); an explicit File ▸ Save always captures
      // the live view regardless, via `windowsForSave()` below.
      // The helper compares the complete serialized workspace slice, including
      // reports, figure docs, macro steps, Origin figures, and recalc mode.
      if (!shouldAutosave(state, prev)) return;
      // P1.2 box 1: the SAME comparison that decides "worth autosaving"
      // also decides "the project no longer matches disk" — reusing it here
      // is what keeps the title bar's dirty marker from ever disagreeing
      // with what autosave itself just captured. A load/open resets this
      // right back to false in the SAME synchronous tick via its own
      // setCurrentProject call, which runs after this subscriber fires (see
      // store/project.ts's header on why ordering there is safe).
      useApp.getState().markProjectDirty();
      clearTimeout(timer);
      timer = setTimeout(() => {
        // M1 (coordinator review): re-check FRESH, right before the actual
        // write — same discipline `store/workspaceIO.ts`'s `runSaveWorkspace`
        // uses for its own quick-save gate. Only ever fires when the lock IS
        // tracking the exact browser autosave path (a desktop session, or a
        // browser tab whose install effect hasn't resolved yet, has
        // `lock.path !== BROWSER_AUTOSAVE_LOCK_PATH` and is UNAFFECTED — this
        // can only ever make a write MORE cautious, never invent a refusal
        // the lock state itself doesn't support, mirroring
        // `runSaveWorkspace`'s own comment on the identical shape).
        const lock = useProjectLock.getState();
        if (lock.path === BROWSER_AUTOSAVE_LOCK_PATH && !lock.canWriteNow()) {
          return;
        }
        const s = useApp.getState();
        // `windowsForSave()` freezes the FOCUSED window's live view into its
        // record first (the plan's "save is one of the three sanctioned
        // snapshot points") — never persist `s.plotWindows` raw. Item 5's
        // `captureTechniqueView` does the same freshening for the technique
        // memory map (workspaceIO.ts's explicit Save uses the identical call).
        const techniqueViewMemory = captureTechniqueView(
          s.datasets.find((d) => d.id === s.activeId),
          s,
          s.techniqueViewMemory,
        );
        void saveAutosave({ ...s, plotWindows: s.windowsForSave(), techniqueViewMemory }).then((ok) => {
          // #32: report through the store so the warning PERSISTS until the
          // next successful save, instead of a status line that scrolls away.
          reportAutosaveHealth(autosaveHealth());
          if (!ok) {
            useApp.getState().setStatus("autosave failed (storage full or unavailable)");
          }
        });
      }, 800);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);
}
