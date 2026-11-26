// The Ctrl+Backspace / Ctrl+Shift+Backspace chords (Origin's own "repeat last"
// chord and a free neighbour: nothing else in the app binds Backspace with a
// modifier). Claimed BEFORE useGlobalShortcuts' Delete / Backspace branch, which
// ignores modifiers and would otherwise remove the selected dataset. The actions
// themselves live in lib/repeatActions.ts, loaded on first use.

import { isEditingTarget } from "./editingTarget";
import { onLoadFailure, runLazy } from "./runLazy";

/** Run the repeat (`reopen` false) or reopen action. */
export function runRepeatChord(reopen: boolean): void {
  void runLazy("Loading…", () => import("./repeatActions")).then(
    (m) => (reopen ? m.runReopenLastDialog() : void m.runRepeatLast()),
    onLoadFailure,
  );
}

/** True when `e` was one of the two chords (and has been handled). */
export function handleRepeatKey(e: KeyboardEvent): boolean {
  if (e.key !== "Backspace" || !(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented || e.repeat) return false;
  if (isEditingTarget(e.target)) return false; // the field's own delete-word
  e.preventDefault();
  runRepeatChord(e.shiftKey);
  return true;
}
