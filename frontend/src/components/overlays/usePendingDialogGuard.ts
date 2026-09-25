// While a lazily-loaded promise dialog is ASKED but its body chunk is still
// in flight (bundle diet slice 8), nothing on screen is modal yet -- so keys
// would reach the page behind: an Escape closed the surface under the dialog
// and the dialog then opened anyway, and a second Enter on the triggering
// button asked again. This guard stands in for the dialog during that window
// (the first ask of a session, one localhost fetch):
//   - Escape: a `modal` surface on the ordered registry that cancels the
//     pending ask, exactly as the dialog's own Escape would;
//   - Enter / Space: swallowed in the capture phase (keydown AND keyup --
//     a button activates on Space's keyup), so nothing behind activates.
// The body mounts with its own handlers the moment `active` turns false.

import { useLayoutEffect } from "react";

import { useEscapeSurface } from "../../lib/escapeStack";

function swallowActivation(e: KeyboardEvent): void {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  e.stopPropagation();
}

export function usePendingDialogGuard(active: boolean, cancel: () => void): void {
  useEscapeSurface(
    "modal",
    () => {
      cancel();
      return true;
    },
    active,
  );
  // Layout effect: installed in the same commit that opened the ask, before
  // the browser can deliver the next key.
  useLayoutEffect(() => {
    if (!active) return;
    window.addEventListener("keydown", swallowActivation, true);
    window.addEventListener("keyup", swallowActivation, true);
    return () => {
      window.removeEventListener("keydown", swallowActivation, true);
      window.removeEventListener("keyup", swallowActivation, true);
    };
  }, [active]);
}
