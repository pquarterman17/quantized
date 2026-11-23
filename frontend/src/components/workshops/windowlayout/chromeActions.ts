// What a layout window's own title-bar buttons do beyond the store actions
// (WORKSPACE_LAYOUT_PLAN, "Keyboard and accessibility"): a refused Close says
// why out loud, and a Close of Style or Data hands focus to the toolbar toggle
// that reopens it (otherwise focus falls to <body> and a keyboard user starts
// again from the top of the page).

import type { WindowRef } from "../../../lib/windowLayout/types";
import { closeRef } from "../../../store/windowLayoutActions";
import { announce } from "./layoutAnnounce";

/** The window whose toolbar toggle should take focus once it has closed. */
let focusAfterClose: WindowRef | null = null;

/** Close `ref` from its own title bar. */
export function closeFromChrome(ref: WindowRef): void {
  const refused = closeRef(ref);
  if (refused) return announce(refused);
  if (ref === "style" || ref === "data") focusAfterClose = ref;
}

/** The toolbar toggle (`data-wl-toggle`) that should now take focus, once; null when none. */
export function takeFocusAfterClose(isOpen: (ref: WindowRef) => boolean): WindowRef | null {
  const ref = focusAfterClose;
  if (!ref || isOpen(ref)) return null;
  focusAfterClose = null;
  return ref;
}
