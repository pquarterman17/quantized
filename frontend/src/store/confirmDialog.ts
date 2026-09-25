// The confirm dialog's promise handshake -- `askConfirm()` and the tiny store
// behind it. Split out of `components/overlays/ConfirmDialog.tsx` in bundle
// diet slice 8 (plans/BUNDLE_HEADROOM.md), the `store/annotationTextDialog.ts`
// shape: ~20 eager call sites (commands, context actions, reimport, Origin
// apply) must be able to ASK before anything is on screen, but the dialog's
// own render tree (focus trap, Enter/Escape ladder, button row) is only
// needed once somebody has asked. So the ask stays eager here and the body is
// a lazy chunk (`ConfirmDialogBody.tsx`), mounted by the thin gate that
// `ConfirmDialog.tsx` still default-exports.

import { create } from "zustand";

export interface ConfirmState {
  title: string | null;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: ((ok: boolean) => void) | null;
  open: (
    title: string,
    message: string,
    confirmLabel: string,
    danger: boolean,
    resolve: (ok: boolean) => void,
  ) => void;
  close: () => void;
}

export const useConfirm = create<ConfirmState>((set) => ({
  title: null,
  message: "",
  confirmLabel: "OK",
  danger: false,
  resolve: null,
  open: (title, message, confirmLabel, danger, resolve) =>
    set({ title, message, confirmLabel, danger, resolve }),
  close: () => set({ title: null, message: "", confirmLabel: "OK", danger: false, resolve: null }),
}));

/** Open a confirm dialog; resolves true on confirm, false on cancel/backdrop/Esc. */
export function askConfirm(
  title: string,
  message = "",
  confirmLabel = "OK",
  danger = false,
): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().open(title, message, confirmLabel, danger, resolve);
  });
}

/** The dialog's chunk would not load: answer the pending question "no" (the
 *  safe answer -- nothing destructive runs on a dialog nobody saw) and close,
 *  so the caller's `await askConfirm(...)` settles instead of hanging. */
export function cancelPendingConfirm(): void {
  const { resolve, close } = useConfirm.getState();
  resolve?.(false);
  close();
}
