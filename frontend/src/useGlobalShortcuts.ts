// Global keyboard shortcuts (Cmd/Ctrl + key), plus Delete to remove datasets
// and the single-key tool / nav layer — extracted verbatim from App.tsx
// (MAIN_PLAN #1, component-ceiling ratchet). Mounted once from App; the
// shortcut glyphs shown in menus/dialogs live in lib/shortcuts and must stay
// in sync with the handlers here.

import { useEffect } from "react";

import { askParams } from "./components/overlays/ParamDialog";
import { cancelActiveGesture } from "./lib/gestureCancel";
import { openFilePicker } from "./lib/openFilePicker";
import { toolForKey } from "./lib/plotToolKeys";
import { loadInteractionPrefs } from "./store/prefs";
import { toast } from "./store/toasts";
import { useApp } from "./store/useApp";

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const isEditing = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      // Delete / Backspace removes the selected dataset(s) — but never while the
      // user is typing in a field (rename, tag, filter, formula, dialog input).
      if ((e.key === "Delete" || e.key === "Backspace") && !isEditing(e.target)) {
        const s = useApp.getState();
        if (s.datasets.length === 0) return;
        e.preventDefault();
        const n = s.selectedIds.length || (s.activeId ? 1 : 0);
        const doRemove = () => {
          s.removeSelected();
          const msg = `removed ${n} dataset${n === 1 ? "" : "s"}`;
          s.setStatus(msg);
          toast(msg);
        };
        // Preferences ▸ Interaction ▸ Confirm before removing data.
        if (s.confirmRemove) {
          void askParams(`Remove ${n} dataset${n === 1 ? "" : "s"}?`, []).then((ok) => {
            if (ok) doRemove();
          });
        } else {
          doRemove();
        }
        return;
      }
      // Esc: universal plot-tool cancel (GUI_INTERACTION #9). A capture-phase
      // dialog (ConfirmDialog/PreferencesDialog/…) or a bubble-phase menu
      // (ContextMenu) that stopPropagation()s on Escape already wins over
      // this — it's a plain window-level bubble listener, the same
      // composition priority as every other Esc consumer in components/Stage.
      // A live drag (integrate/FWHM/measure/stats/pan/quick-fit ROI/gadget
      // cursors) wins next — cancelActiveGesture() tears down its listeners
      // and discards the gesture WITHOUT committing, and the tool stays
      // armed so the user can immediately retry. With nothing mid-drag: an
      // idle-but-armed qfit gadget (a committed roi/cursors sitting with no
      // drag in progress) clears the same way its own chip dismiss does.
      // Only then — tool not already Pointer, not typing in a field, and
      // Preferences ▸ Interaction ▸ "Persistent plot tool" not set — does
      // Esc revert the active tool to Pointer.
      if (e.key === "Escape") {
        if (cancelActiveGesture()) {
          e.preventDefault();
          return;
        }
        const s = useApp.getState();
        if (s.qfitRoi || s.gadgetCursors) {
          e.preventDefault();
          s.clearQfit();
          return;
        }
        if (!isEditing(e.target) && s.plotTool !== "pointer" && !loadInteractionPrefs().persistentTool) {
          e.preventDefault();
          s.setPlotTool("pointer");
        }
        return;
      }
      // "?" (Shift+/ on US layouts) opens the keyboard-shortcuts sheet.
      if (e.key === "?" && !isEditing(e.target)) {
        e.preventDefault();
        useApp.getState().setShortcutsOpen(true);
        return;
      }
      // Single-key tool / nav shortcuts (design interaction layer) — only with no
      // modifier held and not while typing in a field.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !isEditing(e.target)) {
        const s = useApp.getState();
        switch (e.key) {
          case "a":
          case "A": // autoscale / reset the plot view
            if (!s.xLim && !s.yLim) return; // nothing to reset
            e.preventDefault();
            s.setXLim(null);
            s.setYLim(null);
            s.setStatus("view reset");
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
          if (!isEditing(e.target)) {
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
