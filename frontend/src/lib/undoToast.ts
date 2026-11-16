// A toast with a real "Undo" (UX-C): the destructive action has already run
// and recorded its ONE history entry, so Undo is the app's own `undo()` — which
// restores everything the snapshot carries (datasets, selection, figures,
// plot windows, fit specs/results; the Curve Fit overlay follows through
// store/curveFitRemove's subscription) exactly as Edit ▸ Undo would.
//
// The one thing a toast adds is staleness: its button outlives the moment it
// was shown for. If anything else has been recorded since, `undo()` would
// revert THAT edit instead of the removal the toast names, so the button
// refuses (by entry `seq`, which survives rewrites and reflects eviction)
// and points at Edit ▸ Undo / the Trash rather than guessing.

import { TOAST_ACTION_TTL, toast, type ToastKind } from "../store/toasts";
import { useApp } from "../store/useApp";

/** Show `msg` with an Undo action for the history entry now on top of the
 *  stack (`topSeq`, defaulting to it now). Call AFTER the destructive action
 *  has recorded its entry; a caller that loads this module lazily captures
 *  `topSeq` first, synchronously. */
export function toastWithUndo(msg: string, kind: ToastKind = "info", topSeq = useApp.getState().history.at(-1)?.seq): void {
  if (topSeq === undefined) {
    toast(msg, kind); // nothing recorded, so nothing an Undo could restore
    return;
  }
  toast(msg, kind, {
    ttlMs: TOAST_ACTION_TTL,
    action: {
      label: "Undo",
      onClick: () => {
        const s = useApp.getState();
        if (s.history.at(-1)?.seq !== topSeq) {
          toast("Can't undo that here — other edits came after it. Use Edit ▸ Undo or the Trash.", "info");
          return;
        }
        s.undo();
      },
    },
  });
}
