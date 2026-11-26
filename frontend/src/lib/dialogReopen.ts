// "Reopen last dialog" for dialogs that no command opens (plan item 37). A
// menu-opened dialog registers here when it opens; Ctrl+Shift+Backspace then
// reopens it ONLY when its target is provably the same one.
//
// SAFE (they register): the worksheet's column-targeted parameter dialogs and
// Set row count. They only ask: nothing changes until the user confirms, and
// what they act on is a sheet plus column indices, so reopening checks that the
// sheet is still open and still the active one, and that every column still
// carries the label it had.
//
// LEFT OUT, on purpose (they never register, so the chord skips them):
// - Edit header, Text to columns, Color/mark by column: they act on one named
//   or text column, which this check does not cover.
// - Layer Contents and the curve Change X / Y / Worksheet entries: bound to one
//   curve of one graph; a plot can change under the menu.
// - Library, figure and project dialogs (rename, move, delete, save as): bound
//   to one entry by name; reopening could land on the wrong one.
// - Confirmations (anything destructive): never reopened by a key.

import type { Dataset } from "./types";
import { rememberDialog } from "./lastAction";
import { useApp } from "../store/useApp";

/** Register a dialog opened on `cols` of `ds` (none: it acts on the whole
 *  sheet). `open` is the same function that was just called. */
export function noteDialog(label: string, ds: Dataset, cols: readonly number[], open: (ds: Dataset, cols: readonly number[]) => Promise<void>): void {
  const labels = [...ds.data.labels];
  rememberDialog({
    label,
    reopen: () => {
      const s = useApp.getState();
      const live = s.datasets.find((d) => d.id === ds.id);
      if (!live) return `“${ds.name}” is no longer open`;
      if (s.activeId !== ds.id) return `it was opened on “${ds.name}”: select that sheet first`;
      const moved = cols.some((c) => c < -1 || c >= live.data.labels.length || (c >= 0 && live.data.labels[c] !== labels[c]));
      if (moved) return "the columns it was opened on have changed";
      void open(live, cols);
    },
  });
}
