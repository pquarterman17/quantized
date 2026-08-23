// Desktop shell: TitleBar / MenuBar / (Library · Stage · Inspector) / StatusBar
// CSS grid (qzk-app). A thin composition root (MAIN_PLAN #1): the curated
// command registry lives in appCommands.ts, the global keymap in
// useGlobalShortcuts.ts, and the overlay/workshop mounts in AppOverlays.tsx.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import AppOverlays from "./AppOverlays";
import Library from "./components/Library/Library";
import MenuBar from "./components/Shell/MenuBar";
import StatusBar from "./components/Shell/StatusBar";
import TitleBar from "./components/Shell/TitleBar";
import Stage from "./components/Stage/Stage";
import CommandPalette, { type Action } from "./components/overlays/CommandPalette";
import { buildAppActions } from "./appCommands";
import { health } from "./lib/api";
import { hasDesktopShell } from "./lib/desktopBridge";
import {
  loadLibraryViewMode,
  saveLibraryViewMode,
  type LibraryViewMode,
} from "./lib/libraryViewPrefs";
import { useProjectLock } from "./store/projectLock";
import { useApp } from "./store/useApp";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useProjectLockHeartbeat } from "./useProjectLockHeartbeat";
import {
  engageBrowserAutosaveLock,
  installBrowserAutosaveReengage,
  useWorkspaceAutosave,
} from "./useWorkspaceAutosave";

const LibraryWorkspace = lazy(() => import("./components/Library/LibraryWorkspace"));
const QuickFigureBuilderWorkspace = lazy(() => import("./components/workshops/quickfigurebuilder/QuickFigureBuilderWorkspace"));
// E-c1 bundle pass: ~45 kB of Inspector cards off the pre-paint parse path.
// The fallback keeps the grid column (same root class) so nothing shifts
// while the chunk loads; the cards fill in immediately after first paint.
const Inspector = lazy(() => import("./components/Inspector/Inspector"));

export default function App() {
  const leftCollapsed = useApp((s) => s.leftCollapsed);
  const rightCollapsed = useApp((s) => s.rightCollapsed);
  const setStatus = useApp((s) => s.setStatus);
  const setCmdk = useApp((s) => s.setCmdk);
  const quickFigureBuilderDatasetId = useApp((s) => s.quickFigureBuilderDatasetId);
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>(loadLibraryViewMode);
  const previousBrowseMode = useRef<Exclude<LibraryViewMode, "tiles">>(
    libraryViewMode === "details" ? "details" : "tree",
  );

  const changeLibraryViewMode = (next: LibraryViewMode): void => {
    if (next !== "tiles") previousBrowseMode.current = next;
    saveLibraryViewMode(next);
    setLibraryViewMode(next);
  };

  const closeLibraryWorkspace = (): void => {
    // Returning to the plot is also a renderer transition back to the last
    // compact browse mode; scientific/plot state is untouched.
    changeLibraryViewMode(previousBrowseMode.current);
  };

  useEffect(() => {
    health()
      .then(() => setStatus("backend ready"))
      .catch(() => setStatus("offline — demo mode"));
  }, [setStatus]);

  // P1.3 wave 3, Lane D: load the GLOBAL-scope Plot Recipe cache once at
  // boot (store/globalPlotRecipes.ts) -- a separate, non-project store, so
  // this is its own tiny effect rather than folded into
  // useWorkspaceAutosave's project-workspace restore above. Dynamic import
  // (the `hasDesktopShell()` lock-provider effect above is the SAME shape in
  // this file), MEASURED against a plain static import (bundle-size budget,
  // MAIN_PLAN #29): the dynamic form came out smaller. (When first measured,
  // `lib/plotRecipe.ts` was still eager via `lib/workspace.ts`'s synchronous
  // `parseWorkspace`; the R8 schema split -- `lib/plotRecipeSchema.ts` --
  // has since made capture lazy, so this boundary is worth re-measuring in
  // the next bundle-diet pass.) Every variant tried in the original wave was
  // measured rather than assumed; this was the smallest found.
  useEffect(() => {
    void import("./store/globalPlotRecipes").then((m) => m.useGlobalPlotRecipes.getState().hydrate());
  }, []);

  // Restore the autosaved library on startup + debounce-save workspace changes
  // (extracted — component-ceiling ratchet).
  useWorkspaceAutosave();
  useProjectLockHeartbeat();

  // PR I2 (P0-3/P1-1): swap in the real cross-process filesystem lock
  // provider the moment a desktop shell is present — a plain synchronous
  // check, same convention `runSaveWorkspace`/every other desktop-detection
  // call site in this codebase already uses (`window.pywebview.api` is
  // injected before this component's effects run). Dynamic import keeps the
  // lock wire+adapter out of the eager bundle — browser tabs never need it,
  // and in desktop mode the module resolves in milliseconds at startup, long
  // before any user gesture can reach an open/save path that consults the
  // provider.
  useEffect(() => {
    if (hasDesktopShell()) {
      void import("./lib/desktopLockProvider").then((m) => {
        useProjectLock.getState().setProvider(m.createDesktopLockProvider());
      });
    }
  }, []);

  // Non-desktop branch (a plain `qz` browser tab, M4 update — this USED TO
  // say "keeps the in-memory default... not a gap"; it no longer does):
  // swap in the localStorage-backed cross-tab provider (dynamic import, same
  // eager-bundle reasoning as the desktop branch above), then ENGAGE the
  // lock state machine for the shared browser autosave slot the moment the
  // real provider is live (M1 — see useWorkspaceAutosave.ts's header for why
  // that slot, not an explicit project path, is the actual same-browser
  // collision surface here). `engageBrowserAutosaveLock` must run strictly
  // AFTER `setProvider` — both inside this SAME `.then()`, never split
  // across two effects — or it would race the in-memory default still being
  // live and lock nothing meaningful. Closes the "browser multi-tab" defer
  // named in `plans/RELEASE_BLOCKERS.md`'s I2 entry for that ONE slot; see
  // `lib/browserLockProvider.ts`'s header for the primitive-level honest
  // scope (same browser/origin only) and `store/projectLock.ts`'s header for
  // what is STILL uncovered (an explicit named-file browser open/save).
  //
  // N2/N5 (coordinator review round 3): `installBrowserAutosaveReengage()`
  // registers the event-driven recovery triggers (a `pageshow` bfcache
  // restore, a `visibilitychange`-to-visible, and a definite-loss store
  // watcher) that keep a read-only/demoted tab from staying autosave-dead
  // forever once the slot frees — see useWorkspaceAutosave.ts's own header
  // for the full account (that module owns the actual trigger logic; this
  // effect only registers/tears it down at the same install site M1 already
  // uses). Registered BEFORE the dynamic import resolves (not gated on it)
  // so an instant back-navigation before the module even loads still can't
  // leave this tab without recourse.
  //
  // M6: cleanup — `cancelled` stops a stale `.then()` from installing after
  // this effect was torn down (a React StrictMode double-mount, or a real
  // unmount); `provider.dispose()` removes the `pagehide` listener
  // `createBrowserLockProvider` registered, and `teardownReengage()` removes
  // the N2 listeners/subscription — a remount can never leak a second
  // permanent one of either (mirrors `lib/sessionMarker.ts`'s
  // `installSessionMarker()` returning its own teardown).
  useEffect(() => {
    if (hasDesktopShell()) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    const teardownReengage = installBrowserAutosaveReengage();
    void import("./lib/browserLockProvider").then((m) => {
      if (cancelled) return;
      const lock = useProjectLock.getState();
      const provider = m.createBrowserLockProvider(lock.instanceId);
      dispose = provider.dispose;
      lock.setProvider(provider);
      void engageBrowserAutosaveLock();
    });
    return () => {
      cancelled = true;
      teardownReengage();
      dispose?.();
    };
  }, []);

  // ── trap browser back/forward (mouse back button, ⌫ in old browsers) ──
  // The app is a single-page view with no in-app navigation, so a "back"
  // gesture unloads / "reloads" it (losing transient UI state). Push a
  // sentinel history entry and re-push on every popstate so back/forward
  // can't leave the app. Harmless in the desktop (pywebview) shell.
  // Ported from fermiviewer 9ec93a0.
  useEffect(() => {
    history.pushState(null, "", location.href);
    const onPop = () => history.pushState(null, "", location.href);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Global keyboard shortcuts (Cmd/Ctrl + key), Delete-to-remove, single-key
  // tools — extracted to useGlobalShortcuts (MAIN_PLAN #1).
  useGlobalShortcuts();

  // Curated palette actions — store setters are stable, so build once.
  const actions = useMemo<Action[]>(() => buildAppActions(useApp.getState), []);

  const mainCls = `qzk-main${leftCollapsed ? " lc" : ""}${rightCollapsed ? " rc" : ""}`;

  return (
    <div className="qzk-app">
      <TitleBar />
      <MenuBar actions={actions} onOpenPalette={() => setCmdk(true)} />
      <div className={mainCls}>
        <Library viewMode={libraryViewMode} onViewModeChange={changeLibraryViewMode} />
        {quickFigureBuilderDatasetId ? (
          <Suspense fallback={<section className="qzk-quick-builder" aria-label="Quick Figure Builder" />}>
            <QuickFigureBuilderWorkspace />
          </Suspense>
        ) : libraryViewMode === "tiles" ? (
          <Suspense fallback={<section className="qzk-library-workspace" aria-label="Library workspace" />}>
            <LibraryWorkspace onClose={closeLibraryWorkspace} />
          </Suspense>
        ) : (
          <Stage />
        )}
        <Suspense fallback={<aside className="qzk-inspector" />}>
          <Inspector />
        </Suspense>
      </div>
      <StatusBar />
      <CommandPalette actions={actions} />
      <AppOverlays />
    </div>
  );
}
