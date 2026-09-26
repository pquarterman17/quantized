// The Reshape & combine preview workshop's open/closed handshake (audit
// P2.5, "previewed append, keyed join, reshape"). Same shape as
// `store/resampleDialog.ts` (see that header): pure UI-open state, zero lines
// in useApp.ts; `AppOverlays.tsx` reads the flag to mount the LAZY workshop.
//
// `op` is the operation the workshop opens on (the user can switch it);
// `seed` the dataset ids it opens with (the Library selection, else the
// active dataset). `opened` counts openings, so running a command again while
// the workshop is open re-seeds it instead of keeping the old pick.

import { create } from "zustand";

export type PreviewOp = "merge" | "join" | "stack" | "unstack" | "transpose";

interface TransformPreviewState {
  /** Non-null while the workshop is open. */
  op: PreviewOp | null;
  seed: string[];
  opened: number;
  close: () => void;
}

export const useTransformPreviewDialog = create<TransformPreviewState>((set) => ({
  op: null,
  seed: [],
  opened: 0,
  close: () => set({ op: null }),
}));

/** Open the workshop on `op` with `ids` (in order; the first is the primary). */
export function openTransformPreview(op: PreviewOp, ids: readonly string[]): void {
  useTransformPreviewDialog.setState((s) => ({ op, seed: [...ids], opened: s.opened + 1 }));
}
