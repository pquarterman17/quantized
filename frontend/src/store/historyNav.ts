// An edit that also moves the X/Y zoom window (the Axis popup's From / To) is
// ONE Ctrl+Z, not two. Zoom/pan normally sits outside the edit undo domain
// (lib/plotview.ts `NAV_VIEW_KEYS`: `restorePatch` keeps the LIVE navigation,
// and Alt+arrows walk the separate view history), because folding a zoom into
// every snapshot made Ctrl+Z revert a zoom the user did AFTER the edit. A
// gesture whose own Apply sets the limits opts in here: it marks the snapshot
// it recorded, along with the navigation the Apply left live. Undo / redo then
// takes the limits from the snapshot, but only while the live navigation is
// still exactly what the Apply left (a zoom performed since is respected, as
// everywhere else). The undo's counterpart snapshot (the redo entry) is
// marked in turn, expecting the navigation the undo restored.
//
// A WeakMap, not a field on `HistorySnapshot`: the snapshot is an inclusion
// allowlist of persistent state, and this is bookkeeping about one entry.

import { navigationView, type NavigationView } from "../lib/plotview";
import type { HistorySnapshot } from "./historySnapshot";
import type { AppState } from "./useApp";

const expected = new WeakMap<HistorySnapshot, NavigationView>();

/** Mark `snap` (the snapshot a gesture just recorded): restoring it also
 *  restores its limits while the live navigation still equals `after`. */
export function markNavUndoable(snap: HistorySnapshot, after: NavigationView): void {
  expected.set(snap, after);
}

/** Carry the mark from the entry being undone/redone (`from`) to its
 *  counterpart (`to`, the snapshot of the state being left). Returns `to`. */
export function mirrorNav(from: HistorySnapshot, to: HistorySnapshot): HistorySnapshot {
  if (expected.has(from)) expected.set(to, navigationView(from.view));
  return to;
}

/** Does restoring `snap` take the limits from it (rather than keep the live ones)? */
export function takesNav(s: AppState, snap: HistorySnapshot): boolean {
  const want = expected.get(snap);
  return !!want && JSON.stringify(want) === JSON.stringify(navigationView(s));
}
