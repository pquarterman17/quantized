// "Reveal this row in the worksheet" — a one-slot, consume-once request any
// caller can file (Find in project's cell hits today; stats/outlier lists
// tomorrow) and the worksheet grid it targets acts on. Same shape as the
// Library's `requestReveal`: the request is STATE, not a callback, so it works
// when the target worksheet mounts after it was filed — the usual case, since
// the caller switches to the Worksheet tab in the same gesture.
//
// Its own tiny store (zustand only) rather than a field on store/useApp.ts:
// the reader is one hook (components/Stage/worksheet/useRowReveal.ts), and a
// worksheet window never needs anything else from here.

import { create } from "zustand";

export interface RowRevealRequest {
  datasetId: string;
  /** DATASET row index (0-based) — the worksheet maps it to its sorted view. */
  row: number;
  /** Optional column to bring into view: a channel index (-1 = the pinned x
   *  column) or a text column's short name. */
  column?: number | string;
  /** The MDI worksheet window to reveal in; omitted = the Stage Worksheet tab. */
  windowId?: string;
  /** Select (highlight) the row too. Default true. */
  select?: boolean;
  /** Identifies this request, so a newer one is never consumed by mistake. */
  nonce: number;
}

interface WorksheetRevealState {
  rowReveal: RowRevealRequest | null;
  requestRowReveal: (req: Omit<RowRevealRequest, "nonce">) => void;
  /** Clear the request — only if it is still the one with this nonce. */
  consumeRowReveal: (nonce: number) => void;
}

let seq = 0;

export const useWorksheetReveal = create<WorksheetRevealState>((set) => ({
  rowReveal: null,
  requestRowReveal: (req) => set({ rowReveal: { ...req, nonce: ++seq } }),
  consumeRowReveal: (nonce) => set((s) => (s.rowReveal?.nonce === nonce ? { rowReveal: null } : s)),
}));
