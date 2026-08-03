// Calc-only shell (MAIN_PLAN #22 — the standalone DiraCulator launcher).
// Mounted instead of App when the URL carries ?view=calc (main.tsx reads
// isCalcOnlyView() once at startup — no router). Renders JUST the
// calculators content full-window: no Library/Stage/Inspector/menubar. The
// theme/accent/density data-* attrs on <html> still apply — that sync is a
// module-level side effect of importing store/useApp (syncPrefs runs at
// import time), which every component here pulls in transitively.
//
// 2026-08-02 standalone-DiraCulator audit: ConfirmDialog is mounted HERE
// (not just in the full app's AppOverlays) because HistoryTab's "Clear
// history" flow calls the promise-based askConfirm() API — that promise only
// ever resolves against a live <ConfirmDialog/>, so without one here the
// button was silently dead in this shell. The three effects below replace
// the equivalent bits of App.tsx/useGlobalShortcuts.ts/AppOverlays.tsx that
// this shell never mounts: document.title, the Ctrl/Cmd+Shift+L theme
// shortcut, and the back-gesture guard.

import { useEffect } from "react";

import CalcTitleBar from "./components/Shell/CalcTitleBar";
import ConfirmDialog from "./components/overlays/ConfirmDialog";
import Toaster from "./components/overlays/Toaster";
import CalculatorsContent from "./components/workshops/calculators/CalculatorsContent";
import { useApp } from "./store/useApp";

export default function CalcOnlyApp() {
  useEffect(() => {
    document.title = "DiraCulator";
  }, []);

  // Ctrl/Cmd+Shift+L toggles the theme — the exact combo + behavior as the
  // full app's useGlobalShortcuts (App.tsx: `case "l": if (e.shiftKey) ...`
  // under `if (!(e.metaKey || e.ctrlKey)) return;`), read directly rather
  // than importing that hook wholesale — it drags in Library/Stage-only deps
  // (ParamDialog, gestureCancel, openFilePicker, plotToolKeys) this shell
  // has no use for.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "l" && e.shiftKey) {
        e.preventDefault();
        const s = useApp.getState();
        s.setTheme(s.theme === "dark" ? "light" : "dark");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── trap browser back/forward (mouse back button, ⌫ in old browsers) ──
  // Ported from App.tsx (44-49): this is a single-page view with no in-app
  // navigation, so a "back" gesture unloads / "reloads" it (losing transient
  // UI state, e.g. the active calculator tab). Push a sentinel history entry
  // and re-push on every popstate so back/forward can't leave the app.
  // Harmless in the desktop (pywebview) shell.
  useEffect(() => {
    history.pushState(null, "", location.href);
    const onPop = () => history.pushState(null, "", location.href);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="qzk-calc-app">
      <CalcTitleBar />
      <main className="qzk-calc-body">
        <CalculatorsContent />
      </main>
      <ConfirmDialog />
      <Toaster />
    </div>
  );
}
