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

import { freezePlotSnapshot, readLivePlotSnapshot } from "../../lib/plotsnapshot";
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

/** Snapshot to New Window (item 11): freeze the focused window's CURRENT
 *  composed display payload — read from the PlotStage seam
 *  (lib/plotsnapshot) — into a static kind:"snapshot" compare window. A
 *  no-op when no live XY payload is showing (no dataset, an alternate render
 *  mode, or the Plot tab isn't mounted). Exported so PlotToolbar's ⊞ button
 *  (next to the existing ⎘ raster snapshot) can trigger the same action. */
export function snapshotToNewWindow(): void {
  const live = readLivePlotSnapshot();
  if (!live) return;
  useApp.getState().createSnapshotWindow(freezePlotSnapshot(live));
}

/** Open Worksheet in Window / Open Map in Window (item 17 — full MDI): float
 *  the ACTIVE dataset's worksheet / 2-D map as a document window — the same
 *  component the stage tab mounts, live-bound to the dataset. A no-op without
 *  an active dataset. The new window is created on top and "focused" (=
 *  raised — document windows are never the view-facade focus target), and
 *  the stage switches to the Plot tab: the window canvas only renders there,
 *  so opening a floating window anywhere else would look like a silent
 *  failure. The Map/Worksheet stage tabs themselves STAY (the plan's pinned
 *  decision — removing them is a later owner call). */
function openDocumentWindow(kind: "worksheet" | "map"): void {
  const s = useApp.getState();
  if (!s.activeId) return;
  const id = s.createDocumentWindow(kind, s.activeId);
  s.focusWindow(id); // raise-only for a non-plot kind
  s.setStageTab("plot");
}

/** Focus Next/Previous: z-order-aware cycling (item 6 — supersedes v1's
 *  plain creation-order cycle by feeding `cycleWindow` ids sorted back-to-
 *  front instead of the raw array order; identical to v1 whenever no window
 *  has ever been raised, since `zOrderIds` is a stable sort). Snapshot
 *  windows (item 11) are skipped — they can never hold focus. */
function cycleFocus(direction: 1 | -1): void {
  const s = useApp.getState();
  const next = cycleWindow(
    zOrderIds(s.plotWindows.filter((w) => w.kind === "plot")),
    s.focusedWindowId,
    direction,
  );
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

/** Link Window Group (item 13): cycles the FOCUSED window's cross-window
 *  link group (off -> 1 -> 2 -> 3 -> off) — the registry/⌘K counterpart to
 *  the per-window title-bar ⧟ toggle, needed for exactly the same reason
 *  item 18's Window Background command exists: the sole maximized default
 *  window has no title bar to click. A no-op with no focused window. */
function cycleFocusedWindowLinkGroup(): void {
  const s = useApp.getState();
  if (!s.focusedWindowId) return;
  s.cycleWindowLinkGroup(s.focusedWindowId);
}

/** Pin Window (item 14): toggles the FOCUSED window's pin — the command-
 *  registry counterpart to the title-bar ⚲ button, needed for the sole-
 *  maximized-window case (no title bar to click). While pinned, Library
 *  clicks/imports retarget another window instead of rebinding this one;
 *  an explicit drop still rebinds. A no-op with no focused window. */
function togglePinFocusedWindow(): void {
  const s = useApp.getState();
  if (s.focusedWindowId) s.toggleWindowPin(s.focusedWindowId);
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
      {
        id: "window-snapshot",
        group: "Window",
        label: "Snapshot to New Window",
        run: snapshotToNewWindow,
      },
      {
        id: "window-worksheet",
        group: "Window",
        label: "Open Worksheet in Window",
        run: () => openDocumentWindow("worksheet"),
      },
      {
        id: "window-map",
        group: "Window",
        label: "Open Map in Window",
        run: () => openDocumentWindow("map"),
      },
      { id: "window-tile", group: "Window", label: "Tile Windows", run: tileWindows },
      { id: "window-cascade", group: "Window", label: "Cascade Windows", run: cascadeWindows },
      {
        id: "window-bg-cycle",
        group: "Window",
        label: "Window Background (Theme / Light / Dark)",
        run: cycleWindowBg,
      },
      {
        id: "window-link-cycle",
        group: "Window",
        label: "Link Window Group (1 / 2 / 3 / Off)",
        run: cycleFocusedWindowLinkGroup,
      },
      {
        id: "window-pin",
        group: "Window",
        label: "Pin Window (toggle)",
        run: togglePinFocusedWindow,
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
    useCommands.getState().setMenuCommands("windows", actions);
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
