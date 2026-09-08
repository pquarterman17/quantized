// Pack Project panel open flag — a standalone Zustand store (the
// store/recoveryChoice.ts precedent), NOT composed into useApp.ts: this is
// transient UI state (never serialized into a `.dwk`), and useApp.ts's size
// ratchet (architecture.test.ts's STORE_PINS) has no room for it anyway.
//
// Replaces the earlier `globalThis.qP` runtime-owned callback (a global
// escape hatch to dodge an eager import of store/packProject.ts from
// AppOverlays.tsx). A tiny store does the same job — AppOverlays subscribes
// only to this flag, never to store/packProject itself — without reaching
// outside the module system to do it.

import { create } from "zustand";

interface PackProjectPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const usePackProjectPanel = create<PackProjectPanelState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
