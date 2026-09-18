// Global keyboard shortcuts (Cmd/Ctrl + key), plus Delete to remove datasets
// and the single-key tool / nav layer — extracted verbatim from App.tsx
// (MAIN_PLAN #1, component-ceiling ratchet). Mounted once from App; the
// shortcut glyphs shown in menus/dialogs live in lib/shortcuts and must stay
// in sync with the handlers here.

import { useEffect } from "react";

import { cancelActiveGesture } from "./lib/gestureCancel";
import { useEscapeSurface } from "./lib/escapeStack";
import { isEditingTarget } from "./lib/editingTarget";
import { requestDatasetRemoval } from "./lib/datasetRemoval";
import { openFilePicker } from "./lib/openFilePicker";
import { toolForKey } from "./lib/plotToolKeys";
import { loadInteractionPrefs } from "./store/prefs";
import { useApp } from "./store/useApp";

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Delete / Backspace removes the selected dataset(s) — but never while the
      // user is typing in a field (rename, tag, filter, formula, dialog input),
      // and never when a closer handler already consumed the keystroke.
      //
      // `defaultPrevented` is load-bearing, not defensive. This is a WINDOW
      // listener, so it fires on the way out of every element handler; React
      // attaches its own at the root container, which is still inside window.
      // `preventDefault()` does not stop propagation, so a component that
      // deletes its OWN focused object — the map's ROI box and cut ruler, the
      // worksheet's selected block, a Figure Page slot, all four of which
      // preventDefault — used to have that same keystroke continue on to here
      // and silently remove the DATASET as well. Reported from a real session:
      // "trouble hitting delete of the box and I ended up deleting the
      // dataset". With `confirmRemove` defaulting to false there was no prompt
      // to catch it, and `mapRoi` is excluded from undo, so nothing to undo
      // either. Any future component that handles Delete for its own selection
      // gets this protection by calling preventDefault(), which it must do
      // anyway to stop the browser's Back navigation on Backspace.
      if ((e.key === "Delete" || e.key === "Backspace") && !e.defaultPrevented && !isEditingTarget(e.target)) {
        const s = useApp.getState();
        if (s.datasets.length === 0) return;
        e.preventDefault();
        // PR #139 round 3: the confirm/remove/announce flow moved to the
        // shared lib/datasetRemoval.ts helper so LibraryTree's focused-row
        // Delete and this selection-based fallback can never drift.
        requestDatasetRemoval(s.selectedIds.length ? s.selectedIds : s.activeId ? [s.activeId] : []);
        return;
      }
      // Esc is not handled in this listener at all any more (P3.3 round 4).
      // All three of its tiers — cancel the live drag, clear the idle-armed
      // quick-fit gadget, revert the armed tool to Pointer — are surfaces on
      // the shared ordered registry at the bottom of this file, so that
      // "the innermost open surface claims Escape" is one walk rather than a
      // race between listener phases. Round 3 moved only the third tier and
      // left the other two claiming inline with `preventDefault()`, ahead of
      // every registered surface; measured consequence, with Tiles open over a
      // committed ROI: Escape destroyed the ROI and left Tiles open.
      // Returning here keeps Escape out of the single-key tool branch below.
      if (e.key === "Escape") return;
      // "?" (Shift+/ on US layouts) opens the keyboard-shortcuts sheet.
      if (e.key === "?" && !isEditingTarget(e.target)) {
        e.preventDefault();
        useApp.getState().setShortcutsOpen(true);
        return;
      }
      if (e.altKey && !e.metaKey && !e.ctrlKey && !isEditingTarget(e.target)) {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const s = useApp.getState();
          if (e.key === "ArrowLeft") s.backView();
          else s.forwardView();
          return;
        }
      }
      // Single-key tool / nav shortcuts (design interaction layer) — only with no
      // modifier held and not while typing in a field. `!e.defaultPrevented`
      // extends the Delete branch's documented protocol (above) to this
      // branch too (PR #139 review): LibraryTree's roving focus preventDefaults
      // the arrows it handles, and without this gate the SAME keystroke also
      // stepped the global prev/next-dataset navigation — two handlers, one
      // key press.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.defaultPrevented && !isEditingTarget(e.target)) {
        const s = useApp.getState();
        switch (e.key) {
          case "a":
          case "A": // autoscale / reset the plot view
            if (!s.xLim && !s.yLim) return; // nothing to reset
            e.preventDefault();
            s.recordView({ xLim: s.xLim, yLim: s.yLim }, { xLim: null, yLim: null });
            return;
          case "f":
          case "F": // curve-fit workshop
            e.preventDefault();
            s.setCurveFitOpen(true);
            return;
          case "y":
          case "Y": // hysteresis workshop
            e.preventDefault();
            s.setHysteresisOpen(true);
            return;
          case "ArrowUp":
          case "ArrowDown": {
            // Previous / next dataset (wraps); plain click semantics — routes
            // through `activateFromLibrary` (WORKSHEET_PLAN item 15), same as
            // a Library row click, so stepping onto an Origin book opens its
            // Worksheet rather than rebinding the plot. Steps from whatever's
            // currently browsed (`worksheetId ?? activeId`), not just the
            // plotted dataset, so repeated arrow presses walk the list in
            // order even while a worksheet-intent override is in play.
            if (s.datasets.length < 2) return;
            e.preventDefault();
            const n = s.datasets.length;
            const cur = s.datasets.findIndex((d) => d.id === (s.worksheetId ?? s.activeId));
            const base = cur < 0 ? 0 : cur;
            const delta = e.key === "ArrowDown" ? 1 : -1;
            s.activateFromLibrary(s.datasets[(((base + delta) % n) + n) % n].id);
            return;
          }
          case "p":
          case "P": // pick peak → the Peaks workshop
            e.preventDefault();
            s.setPeaksOpen(true);
            return;
        }
        // H/Z/D/M/I/W select a plot tool.
        const t = toolForKey(e.key);
        if (t) {
          e.preventDefault();
          s.setPlotTool(t);
          return;
        }
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const s = useApp.getState();
      switch (e.key.toLowerCase()) {
        case "k":
          e.preventDefault();
          s.setCmdk(true);
          break;
        case "o":
          e.preventDefault();
          openFilePicker((files) => void s.importFiles(files));
          break;
        case "v":
          // Only claim ⌘/Ctrl+V as "paste a dataset" when the user isn't typing
          // into a field (rename, tag, formula, dialog input) — those keep the
          // browser's native paste. Command palette / Edit menu always work.
          if (!isEditingTarget(e.target)) {
            e.preventDefault();
            void s.pasteDataFromClipboard();
          }
          break;
        case "[":
          e.preventDefault();
          s.toggleLeft();
          break;
        case "]":
          e.preventDefault();
          s.toggleRight();
          break;
        case "l":
          // ⌘⇧L toggles the theme (plain ⌘L is the browser address bar).
          if (e.shiftKey) {
            e.preventDefault();
            s.setTheme(s.theme === "dark" ? "light" : "dark");
          }
          break;
        case ",":
          e.preventDefault();
          s.setPrefsOpen(true);
          break;
        case "s":
          // P1.2 box 1: Ctrl/Cmd+S — write to the known project path with no
          // dialog; falls back to Save As (prompts / downloads) when there is
          // no known project yet. ⇧ is reserved (a future explicit Save As
          // shortcut), so this branch only claims the plain combo.
          if (!e.shiftKey) {
            e.preventDefault();
            void s.saveWorkspace();
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── The three plot-tool tiers of the Escape ladder (GUI_INTERACTION #9) ──
  // All three are registry surfaces as of round 4. Each DECLINES when it has
  // nothing to do, so an Escape nothing wanted still falls all the way
  // through. The editing-target / command-palette / open-menu guards live in
  // the dispatcher, one copy for the whole app.

  // TOP of the whole ladder: a drag that is happening right now. The user's
  // hand is on it, so it outranks every surface — including the window focus
  // happens to be sitting in. `cancelActiveGesture()` tears the drag's
  // listeners down and discards it WITHOUT committing, and the tool stays
  // armed for an immediate retry; it returns false when nothing is mid-drag,
  // which is exactly the decline this layer needs.
  useEscapeSurface("gesture", () => cancelActiveGesture());

  // An idle-but-armed quick-fit gadget (a committed roi/cursors sitting with
  // NO drag in progress) clears the same way its own chip dismiss does. Round
  // 3 left this inline, claiming ahead of everything; measured, that cleared a
  // committed ROI out from under a focused workshop while the window stayed
  // open (review finding 3). It is a Stage SELECTION, so it belongs below any
  // open surface. Registered only while there IS something to dismiss — the
  // same "listen while it matters" shape the four Stage deselect hooks use,
  // which also makes the most recently armed selection the one Escape clears.
  // The boolean selector is deliberate: `qfitRoi` changes on every mousemove
  // of a live drag, but this value only flips at its edges.
  const hasIdleGadget = useApp((s) => s.qfitRoi !== null || s.gadgetCursors !== null);
  useEscapeSurface(
    "selection",
    () => {
      useApp.getState().clearQfit();
      return true;
    },
    hasIdleGadget,
  );

  // The LAST tier: revert the armed plot tool to Pointer. With Tiles or a
  // workshop open, Escape dismisses that surface and leaves the tool armed,
  // and the NEXT Escape (nothing left to dismiss) reverts the tool.
  useEscapeSurface("app", () => {
    const s = useApp.getState();
    if (s.plotTool === "pointer" || loadInteractionPrefs().persistentTool) return false;
    s.setPlotTool("pointer");
    return true;
  });
}
