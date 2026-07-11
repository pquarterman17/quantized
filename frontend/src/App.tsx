// Desktop shell: TitleBar / MenuBar / (Library · Stage · Inspector) / StatusBar
// CSS grid (qzk-app). A thin composition root (MAIN_PLAN #1): the curated
// command registry lives in appCommands.ts, the global keymap in
// useGlobalShortcuts.ts, and the overlay/workshop mounts in AppOverlays.tsx.

import { useEffect, useMemo } from "react";

import AppOverlays from "./AppOverlays";
import Inspector from "./components/Inspector/Inspector";
import Library from "./components/Library/Library";
import MenuBar from "./components/Shell/MenuBar";
import StatusBar from "./components/Shell/StatusBar";
import TitleBar from "./components/Shell/TitleBar";
import Stage from "./components/Stage/Stage";
import CommandPalette, { type Action } from "./components/overlays/CommandPalette";
import { buildAppActions } from "./appCommands";
import { health } from "./lib/api";
import { useApp } from "./store/useApp";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useWorkspaceAutosave } from "./useWorkspaceAutosave";

export default function App() {
  const leftCollapsed = useApp((s) => s.leftCollapsed);
  const rightCollapsed = useApp((s) => s.rightCollapsed);
  const setStatus = useApp((s) => s.setStatus);
  const setCmdk = useApp((s) => s.setCmdk);

  useEffect(() => {
    health()
      .then(() => setStatus("backend ready"))
      .catch(() => setStatus("offline — demo mode"));
  }, [setStatus]);

  // Restore the autosaved library on startup + debounce-save workspace changes
  // (extracted — component-ceiling ratchet).
  useWorkspaceAutosave();

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
        <Library />
        <Stage />
        <Inspector />
      </div>
      <StatusBar />
      <CommandPalette actions={actions} />
      <AppOverlays />
    </div>
  );
}
