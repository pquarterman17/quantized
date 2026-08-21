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
import { useWorkspaceAutosave } from "./useWorkspaceAutosave";

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

  // Restore the autosaved library on startup + debounce-save workspace changes
  // (extracted — component-ceiling ratchet).
  useWorkspaceAutosave();
  useProjectLockHeartbeat();

  // PR I2 (P0-3/P1-1): swap in the real cross-process filesystem lock
  // provider the moment a desktop shell is present — a plain synchronous
  // check, same convention `runSaveWorkspace`/every other desktop-detection
  // call site in this codebase already uses (`window.pywebview.api` is
  // injected before this component's effects run). A browser tab (no
  // `window.pywebview`) keeps the in-memory default — see
  // store/projectLock.ts's header for why that split is correct, not a gap.
  // Dynamic import keeps the lock wire+adapter out of the eager bundle —
  // browser tabs never need it, and in desktop mode the module resolves in
  // milliseconds at startup, long before any user gesture can reach an
  // open/save path that consults the provider.
  useEffect(() => {
    if (hasDesktopShell()) {
      void import("./lib/desktopLockProvider").then((m) => {
        useProjectLock.getState().setProvider(m.createDesktopLockProvider());
      });
    }
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
