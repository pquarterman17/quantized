// The ONE dataset-removal request path (PR #139 review, round 3): explicit
// ids in, the established confirm/remove/announce flow out. Shared by
// useGlobalShortcuts.ts's window-level Delete (selection-or-active ids) and
// LibraryTree.tsx's focused-row Delete (the focused worksheet, or its
// enclosing multi-selection) so the two can never drift on the
// `confirmRemove` preference, status/toast wording, Trash capture, or
// one-Undo behavior. Imports a component overlay from lib/ the same way
// lib/contextActions.ts already imports ConfirmDialog.

import { askParams } from "../components/overlays/ParamDialog";
import { plural } from "./plural";
import { toast, type ToastKind } from "../store/toasts";
import { useApp } from "../store/useApp";

/** Announce a removal with an Undo (lib/undoToast, loaded on demand to keep it
 *  out of the eager bundle). The history entry is captured NOW, synchronously;
 *  if the chunk fails to load the plain toast still shows. */
export function toastRemoved(msg: string, kind: ToastKind = "info"): void {
  const seq = useApp.getState().history.at(-1)?.seq;
  // The fallback is for the chunk LOAD only; an error inside the toast must not double it.
  void import("./undoToast").then((m) => m.toastWithUndo(msg, kind, seq), () => toast(msg, kind));
}

/** Request removal of exactly `ids` (dead ids dropped; empty = no-op),
 *  honoring Preferences ▸ Interaction ▸ "Confirm before removing data".
 *  Everything downstream is `removeDatasets`: Trash capture, reference
 *  pruning, one history entry. */
export function requestDatasetRemoval(ids: readonly string[]): void {
  const s = useApp.getState();
  const live = ids.filter((id) => s.datasets.some((d) => d.id === id));
  if (live.length === 0) return;
  const n = live.length;
  const doRemove = () => {
    const st = useApp.getState();
    st.removeDatasets(live);
    const msg = `removed ${n} dataset${plural(n)}`;
    st.setStatus(msg);
    toastRemoved(msg);
  };
  if (s.confirmRemove) {
    void askParams(`Remove ${n} dataset${plural(n)}?`, [], { confirmLabel: "Remove" }).then((ok) => {
      if (ok) doRemove();
    });
  } else {
    doRemove();
  }
}
