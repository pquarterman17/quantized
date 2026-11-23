// Where focus goes when the window layout comes back (UX pass 3, M3). A few actions started from a
// layout window (the Analysis guide's Plot step with no saved figure) open a full-workspace view, the
// Quick Figure Builder, which REPLACES the layout host until it closes; the window that started it is
// gone by then, so focus would fall to <body>. The action names the window; the host, when it mounts
// again, takes it and focuses that window's title bar. Session state only. Lazy (the layout host's side).

import type { WindowRef } from "../lib/windowLayout/types";

let pending: WindowRef | null = null;

/** The window focus should return to once the layout is back. */
export function markLayoutReturn(ref: WindowRef | null): void {
  pending = ref;
}

/** Take (and clear) the pending return, or null. */
export function takeLayoutReturn(): WindowRef | null {
  const ref = pending;
  pending = null;
  return ref;
}

/** Is a return pending? (Look without taking: an effect that may run twice, as under StrictMode, takes it
 *  only when its frame fires.) */
export const hasLayoutReturn = (): boolean => pending !== null;
