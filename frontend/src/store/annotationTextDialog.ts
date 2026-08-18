// The annotation-text editor's open/closed handshake (MAIN #25
// discoverability). A tiny, standalone zustand store -- same shape as
// `store/quickPlotWithDialog.ts` -- kept OUT of the dialog component file
// deliberately: `components/Stage/useShapeDraw.ts` (part of the always-eager
// Stage tree) calls `askAnnotationText()` on the pointer-tool double-click-
// to-edit path, so that function must be reachable without dragging in the
// dialog's own render tree (RichLabelInput -> SymbolPalette, the Omega
// symbol grid). Split into its own tiny module so `AppOverlays.tsx` can read
// the open flag to decide whether to mount the LAZY dialog chunk without
// importing the chunk itself -- bundle-size pass 2026-08-18.

import { create } from "zustand";

interface AnnotationTextDialogState {
  title: string | null;
  initial: string;
  resolve: ((v: string | null) => void) | null;
  open: (title: string, initial: string, resolve: (v: string | null) => void) => void;
  close: () => void;
}

export const useAnnotationTextDialog = create<AnnotationTextDialogState>((set) => ({
  title: null,
  initial: "",
  resolve: null,
  open: (title, initial, resolve) => set({ title, initial, resolve }),
  close: () => set({ title: null, initial: "", resolve: null }),
}));

/** Open the annotation text editor; resolves the committed text, or null on
 *  cancel/backdrop/Escape (matches askParams/askConfirm's promise contract —
 *  callers do `if (v != null) updateAnnotation(id, { text: v })`). */
export function askAnnotationText(title: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    useAnnotationTextDialog.getState().open(title, initial, resolve);
  });
}
