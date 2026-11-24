// Undo History (UX9-J): the visible list behind Edit > Undo history and the
// palette's "Undo history…". The Edit menu's own Undo item only names the NEXT
// step, so eight Ctrl+Z presses walked silently back to "0 datasets"; this
// lists the last UNDO_HISTORY_LIMIT labels, newest first, and jumps to any of
// them.
//
// A jump is N plain `undo()` calls, nothing else: every popped entry lands on
// the redo stack exactly as a manual Ctrl+Z would leave it, so Edit > Redo (or
// Ctrl+Shift+Z) walks back to where the user was. No second history mechanism.
//
// Row semantics: a row names an EDIT, and clicking it restores the state right
// AFTER that edit. The newest row is therefore the current state (marked), and
// row k undoes k steps. Lazy-only — imported by the lazy menu model and by the
// palette command's dynamic import, never by the eager graph.

import type { HistoryEntry } from "../store/history";
import { namedHistoryLabel } from "./historyLabel";
import { askParams } from "../store/paramDialog";
import { toast } from "../store/toasts";
import type { AppState } from "../store/useApp";

export const UNDO_HISTORY_LIMIT = 20;

export interface UndoHistoryRow {
  label: string;
  /** How many undos land on the state right after this edit (0 = current). */
  stepsBack: number;
  current: boolean;
  /** The entry's identity: a jump re-resolves it, so a stack that changed while
   *  the menu was open can never land on a different state than the one clicked. */
  seq: number;
}

/** The last `limit` history labels, newest first. */
export function undoHistoryRows(
  history: readonly HistoryEntry[],
  limit = UNDO_HISTORY_LIMIT,
  live: readonly { id: string; name: string }[] = [],
): UndoHistoryRow[] {
  const start = Math.max(0, history.length - limit);
  return history
    .slice(start)
    .map((entry, i) => ({ entry, label: namedHistoryLabel(history, start + i, live) }))
    .reverse()
    .map(({ entry, label }, stepsBack) => ({ label, stepsBack, current: stepsBack === 0, seq: entry.seq }));
}

const stepsText = (n: number): string => `${n} step${n === 1 ? "" : "s"}`;

/** Undo `stepsBack` times in one synchronous run (React renders once).
 *  Clamped to the stack. Returns the steps undone. */
export function jumpBackInHistory(get: () => AppState, stepsBack: number, seq?: number): number {
  if (seq !== undefined) {
    const h = get().history;
    const at = h.findIndex((e) => e.seq === seq);
    if (at < 0) {
      toast("history changed — reopen Undo history");
      return 0;
    }
    stepsBack = h.length - 1 - at;
  }
  const n = Math.min(Math.max(0, Math.floor(stepsBack)), get().history.length);
  if (n === 0) return 0;
  for (let i = 0; i < n; i++) get().undo();
  const stateAfter = get().history[get().history.length - 1]?.label;
  const msg = `jumped back ${stepsText(n)}${stateAfter ? ` to: ${stateAfter}` : " to the start"} — Redo returns`;
  get().setStatus(msg);
  toast(msg);
  return n;
}

/** The palette's entry point: a picker over the same rows, jumping on confirm. */
export async function openUndoHistory(get: () => AppState): Promise<void> {
  const rows = undoHistoryRows(get().history, UNDO_HISTORY_LIMIT, get().datasets);
  if (rows.length === 0) {
    toast("nothing to undo");
    return;
  }
  const options = rows.map((r) => String(r.stepsBack));
  const optionLabels: Record<string, string> = {};
  for (const r of rows) {
    optionLabels[String(r.stepsBack)] = r.current ? `● ${r.label} (current)` : `${stepsText(r.stepsBack)} back: ${r.label}`;
  }
  const values = await askParams(
    "Undo history",
    [{ key: "to", label: "State after", type: "select", default: rows[1] ? "1" : "0", options, optionLabels }],
    { confirmLabel: "Jump back", message: "Newest first. Jumping back keeps Redo, so you can return." },
  );
  if (!values) return;
  const row = rows.find((r) => String(r.stepsBack) === values.to);
  if (row) jumpBackInHistory(get, row.stepsBack, row.seq);
}
