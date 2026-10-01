// The Relink panel's OPEN FLAG and close hook, split out of the heavy
// store/relink.ts (bundle headroom slice 14, plans/BUNDLE_HEADROOM.md) — the
// store/recodePanel.ts shape: dependency-free (zustand only), so AppOverlays
// can gate the lazy RelinkPanel and lib/openWorkspaceReplace.ts can close it
// without either importing store/relink.ts, which was eager for those two
// uses alone.
//
// A MIRROR, not the source of truth: store/relink.ts still owns `open`, copies
// it here from a subscription, and registers its own `closePanel` as the
// closer, both when that module evaluates. Only store/relink.ts can make
// `open` true or mint the directory grant `closePanel` revokes, and it has to
// be loaded to do either, so before it loads the panel is closed and there is
// nothing to revoke — `closeRelinkPanel()` doing nothing then is exactly what
// `closePanel` would have achieved.

import { create } from "zustand";

export const useRelinkPanel = create<{ open: boolean }>(() => ({ open: false }));

let closer: (() => void) | null = null;

/** store/relink.ts registers its `closePanel` here when it evaluates. */
export function registerRelinkCloser(fn: () => void): void {
  closer = fn;
}

/** Close the Relink panel and revoke its grant — a no-op until the relink
 *  store has loaded (see the module doc for why that is equivalent). */
export function closeRelinkPanel(): void {
  closer?.();
}
