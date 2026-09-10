// Group O-2b reorder panel — the OPEN FLAG plus the column identity the
// lazy panel needs to seed itself, split out of the heavy store/
// levelOrder.ts (which pulls in lib/recode.ts's `resolveRecodeChannel` and
// the commit/permutation logic) per the bundle-size ratchet's documented
// process (scripts/check-bundle-size.mjs's "THE ALLOWED REVIEW PROCESS":
// try a lazy split before ever raising the pin) and its 2026-09-07 history
// entry's `store/packProjectPanel.ts` precedent, which this file mirrors
// exactly: a ~10-line dependency-free store (zustand only) so AppOverlays.tsx
// and WorksheetPane.tsx's "Reorder levels…" menu entry never import
// store/levelOrder.ts eagerly — only the lazy-loaded LevelOrderPanel.tsx
// does, so the heavy module (and its `lib/recode.ts` edge) now loads for
// the first time inside that already-lazy chunk instead of the entry chunk.
//
// Review round LOW 5: this store deliberately does NOT cache the column's
// LABEL. An earlier draft did, "so the panel can show a title immediately" —
// but the panel renders nothing until the heavy store has seeded, so nothing
// ever read it. Dead state whose comment promised behaviour that did not
// exist, and eager bytes buying nothing. The label identity that DEFECT B
// actually resolves against lives on the heavy store, derived from the live
// dataset at seed time.
//
// WorksheetPane.tsx already runs the `isCategoricalChannel` guard at the
// menu-build site before this entry is even offered, so it sets this flag
// directly rather than calling into the heavy store's own (duplicate)
// refusal check — that check still runs, belt-and-braces, for any OTHER
// caller, the moment LevelOrderPanel.tsx mounts and seeds store/
// levelOrder.ts from this store's identity (see that component's header).

import { create } from "zustand";

interface LevelOrderPanelState {
  open: boolean;
  datasetId: string | null;
  channel: number | null;
  openPanel: (datasetId: string, channel: number) => void;
  closePanel: () => void;
}

export const useLevelOrderPanel = create<LevelOrderPanelState>((set) => ({
  open: false,
  datasetId: null,
  channel: null,
  openPanel: (datasetId, channel) => set({ open: true, datasetId, channel }),
  closePanel: () => set({ open: false, datasetId: null, channel: null }),
}));
