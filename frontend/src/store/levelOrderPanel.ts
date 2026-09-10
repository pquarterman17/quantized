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
  /** Cached purely so the panel can show a title immediately, before the
   *  heavy store's lazy chunk finishes loading and seeding. store/
   *  levelOrder.ts re-derives its OWN copy from the live dataset the moment
   *  it seeds — that copy, not this one, is what DEFECT B's identity check
   *  actually resolves against. */
  openLabel: string | null;
  openPanel: (datasetId: string, channel: number, openLabel: string) => void;
  closePanel: () => void;
}

export const useLevelOrderPanel = create<LevelOrderPanelState>((set) => ({
  open: false,
  datasetId: null,
  channel: null,
  openLabel: null,
  openPanel: (datasetId, channel, openLabel) => set({ open: true, datasetId, channel, openLabel }),
  closePanel: () => set({ open: false, datasetId: null, channel: null, openLabel: null }),
}));
