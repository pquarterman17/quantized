// Window commands v1 (MULTI_PLOT_PLAN item 5): New Graph Window / Duplicate
// Window / Close Window / Focus Next / Focus Previous. Published into the
// shared command registry (`store/commands.ts`'s `useCommands`) so BOTH the
// ⌘K palette and the MenuBar's Window menu pick them up (MenuBar merges
// `useCommands().menuCommands` into what it displays — see MenuBar.tsx) —
// with ZERO lines added to App.tsx's pinned curated-actions list (the plan's
// dependency-map rule: "wire through the registry/extracted hooks, never
// inline in App.tsx"). This hook is mounted once from `Stage/Stage.tsx`
// (always-mounted regardless of which Stage tab is showing — window
// management shouldn't disappear just because the Worksheet tab is up),
// NOT from `WindowCanvas` (which only mounts while the Plot tab is active).
//
// Also owns the actual keyboard shortcuts: `Action.shortcut` is cosmetic
// display text everywhere else in the app (App.tsx's global keydown effect
// is the real listener for its own curated actions), so an extracted feature
// that publishes its own commands must also own their key handling.

import { useEffect } from "react";

import { cycleWindow, nextPlotBg, snapshotView, zOrderIds } from "../../lib/plotview";
import { useCommands, type Action } from "../../store/commands";
import { useApp } from "../../store/useApp";

function isEditing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** New Graph Window: clones the focused view onto the focused dataset by
 *  default (the plan's "fast compare workflow"), then focuses it — Origin's
 *  "New Graph" opens on top, ready to interact with immediately. */
function newGraphWindow(): void {
  const s = useApp.getState();
  const id = s.createWindow(s.activeId, snapshotView(s));
  s.focusWindow(id);
}

/** Duplicate Window: clones the FOCUSED window (its live view, since its
 *  record is stale while focused — see `duplicateWindow`'s own doc) and
 *  focuses the copy. */
function duplicateFocusedWindow(): void {
  const s = useApp.getState();
  if (!s.focusedWindowId) return;
  const id = s.duplicateWindow(s.focusedWindowId);
  if (id) s.focusWindow(id);
}

/** Close Window: closes the FOCUSED window (a no-op on the last survivor —
 *  the ≥1-window invariant). */
function closeFocusedWindow(): void {
  const s = useApp.getState();
  if (s.focusedWindowId) s.closeWindow(s.focusedWindowId);
}

/** Focus Next/Previous: z-order-aware cycling (item 6 — supersedes v1's
 *  plain creation-order cycle by feeding `cycleWindow` ids sorted back-to-
 *  front instead of the raw array order; identical to v1 whenever no window
 *  has ever been raised, since `zOrderIds` is a stable sort). */
function cycleFocus(direction: 1 | -1): void {
  const s = useApp.getState();
  const next = cycleWindow(zOrderIds(s.plotWindows), s.focusedWindowId, direction);
  if (next) s.focusWindow(next);
}

/** Tile Windows (item 6): re-lay-out every visible window into an even grid
 *  sized to the Plot tab's current canvas. A no-op with fewer than 2 visible
 *  windows (the store action itself guards this too). */
function tileWindows(): void {
  useApp.getState().tileWindows();
}

/** Cascade Windows (item 6): re-lay-out every visible window in a staggered
 *  cascade (same offset step as placing new windows in turn). */
function cascadeWindows(): void {
  useApp.getState().cascadeWindows();
}

/** Window Background (item 18, owner request 2026-07-09): cycles the
 *  FOCUSED window's background override (theme -> light -> dark -> theme),
 *  the command-registry / ⌘K counterpart to the per-window title-bar toggle
 *  (`PlotWindowFrame`'s ◐ button) — works even for the sole maximized
 *  default window, which has no title bar to click. A no-op if there's
 *  somehow no focused window. */
function cycleWindowBg(): void {
  const s = useApp.getState();
  if (!s.focusedWindowId) return;
  const win = s.plotWindows.find((w) => w.id === s.focusedWindowId);
  if (!win) return;
  s.setWindowBg(win.id, nextPlotBg(win.bg));
}

export function useWindowCommands(): void {
  useEffect(() => {
    const actions: Action[] = [
      { id: "window-new", group: "Window", label: "New Graph Window", shortcut: "⌘⇧N", run: newGraphWindow },
      {
        id: "window-duplicate",
        group: "Window",
        label: "Duplicate Window",
        shortcut: "⌘⇧D",
        run: duplicateFocusedWindow,
      },
      { id: "window-close", group: "Window", label: "Close Window", shortcut: "⌘⇧W", run: closeFocusedWindow },
      { id: "window-tile", group: "Window", label: "Tile Windows", run: tileWindows },
      { id: "window-cascade", group: "Window", label: "Cascade Windows", run: cascadeWindows },
      {
        id: "window-bg-cycle",
        group: "Window",
        label: "Window Background (Theme / Light / Dark)",
        run: cycleWindowBg,
      },
      {
        id: "window-focus-next",
        group: "Window",
        label: "Focus Next Window",
        shortcut: "⌃Tab",
        run: () => cycleFocus(1),
      },
      {
        id: "window-focus-prev",
        group: "Window",
        label: "Focus Previous Window",
        shortcut: "⌃⇧Tab",
        run: () => cycleFocus(-1),
      },
    ];
    useCommands.getState().setMenuCommands(actions);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Tab / Ctrl+Shift+Tab cycles window focus — deliberately Ctrl
      // ONLY (never Cmd, which is the macOS app switcher and must stay
      // untouched) — matches the plan's own "Ctrl+Tab" wording.
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Tab") {
        e.preventDefault();
        cycleFocus(e.shiftKey ? -1 : 1);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || isEditing(e.target)) return;
      switch (e.key.toLowerCase()) {
        case "n":
          e.preventDefault();
          newGraphWindow();
          break;
        case "d":
          e.preventDefault();
          duplicateFocusedWindow();
          break;
        case "w":
          e.preventDefault();
          closeFocusedWindow();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
