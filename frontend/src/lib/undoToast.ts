// A toast with a real "Undo" (UX-C): the destructive action has already run
// and recorded its ONE history entry, so Undo is the app's own `undo()` — which
// restores everything the snapshot carries (datasets, selection, figures,
// plot windows, fit specs/results; the Curve Fit overlay and Remove all's
// project follow through their own store subscriptions) exactly as
// Edit ▸ Undo would.
//
// The one thing a toast adds is staleness: its button outlives the moment it
// was shown for. If anything else has been recorded since, `undo()` would
// revert THAT edit instead of the removal the toast names, so the button
// refuses (by entry `seq`, which survives rewrites and reflects eviction) —
// and says which case it is: already undone (Edit ▸ Undo got there first), or
// newer edits (point at Edit ▸ Undo / the Trash rather than guessing).

import { TOAST_ACTION_TTL, toast, type ToastKind } from "../store/toasts";
import { scrubDatasetsFromTrash } from "../store/removeDatasets";
import { useApp } from "../store/useApp";
import { formatShortcut, isMacPlatform } from "./shortcutFormat";

/** The history entry on top of the stack, with enough to recognise it later. */
export interface HistoryTop {
  seq: number;
  label: string;
  depth: number;
}

/** Capture right after the destructive action recorded its entry, and pass it
 *  to `toastWithUndo`. */
export function historyTop(): HistoryTop | undefined {
  const h = useApp.getState().history;
  const top = h.at(-1);
  return top ? { seq: top.seq, label: top.label, depth: h.length } : undefined;
}

/** Show `msg` with an Undo action for the history entry `top` (an EXPLICIT
 *  argument, never re-read here: a caller that loads this module lazily must
 *  have captured it synchronously; `undefined` means nothing was recorded, so
 *  no Undo is offered). `block` is asked BEFORE anything is restored and may
 *  refuse with a reason. The toast stays long enough to read and decide. */
export function toastWithUndo(msg: string, kind: ToastKind, top: HistoryTop | undefined, block?: () => string | null): void {
  if (top === undefined) {
    toast(msg, kind); // nothing recorded, so nothing an Undo could restore
    return;
  }
  toast(`${msg} — Undo, or ${formatShortcut("⌘Z", isMacPlatform())}`, kind, {
    ttlMs: TOAST_ACTION_TTL * 2,
    action: {
      label: "Undo",
      onClick: () => {
        const s = useApp.getState();
        if (s.history.at(-1)?.seq !== top.seq) {
          const undone = s.future.at(-1)?.label === top.label && s.history.length === top.depth - 1;
          toast(
            undone ? "Already undone." : "Can't undo that here — other edits came after it. Use Edit ▸ Undo or the Trash.",
            "info",
          );
          return;
        }
        const why = block?.();
        if (why) {
          toast(`Can't undo — ${why}.`, "info");
          return;
        }
        const before = new Set(s.datasets.map((d) => d.id));
        s.undo();
        // Trash sits outside history: the removal sent a copy there, and the
        // datasets this Undo brought back are live again — leave no second
        // copy to "Restore" later (a Redo removes them again, recoverable by
        // Undo, not via Trash).
        useApp.setState((st) => scrubDatasetsFromTrash(st, st.datasets.map((d) => d.id).filter((id) => !before.has(id))));
      },
    },
  });
}
