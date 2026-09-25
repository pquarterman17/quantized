// The parameter dialog's promise handshake -- `askParams()` and the tiny store
// behind it. Split out of `components/overlays/ParamDialog.tsx` in bundle diet
// slice 8 (plans/BUNDLE_HEADROOM.md), same shape as `store/confirmDialog.ts`:
// the ask stays eager (Library row menus, palette context actions, the Plot
// commands call it), the dialog body (`ParamDialogBody.tsx` + its field rows
// and focus hook) is a lazy chunk mounted only once somebody has asked.

import { create } from "zustand";

import type { ParamField, ParamValues } from "../lib/params";

export interface ParamDialogState {
  title: string | null;
  fields: ParamField[];
  resolve: ((v: ParamValues | null) => void) | null;
  open: (
    title: string,
    fields: ParamField[],
    resolve: (v: ParamValues | null) => void,
  ) => void;
  close: () => void;
}

export const useParamDialog = create<ParamDialogState>((set, get) => ({
  title: null,
  fields: [],
  resolve: null,
  open: (title, fields, resolve) => {
    // A new request REPLACES a pending one; settle the old one as a cancel
    // (`null`) first so its caller never awaits forever (slice 8 review).
    get().resolve?.(null);
    set({ title, fields, resolve });
  },
  close: () => set({ title: null, fields: [], resolve: null }),
}));

/** Open the dialog; resolves with the values or null on cancel. */
export function askParams(
  title: string,
  fields: ParamField[],
): Promise<ParamValues | null> {
  return new Promise((resolve) => {
    useParamDialog.getState().open(title, fields, resolve);
  });
}

/** The dialog's chunk would not load: resolve the pending request as a
 *  cancel (`null`, the contract every caller already handles) and close. */
export function cancelPendingParams(): void {
  const { resolve, close } = useParamDialog.getState();
  resolve?.(null);
  close();
}
