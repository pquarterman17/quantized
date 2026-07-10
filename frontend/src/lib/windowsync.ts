// Cross-window link groups (MULTI_PLOT_PLAN item 13): windows assigned the
// same non-null `linkGroup` share a uPlot cursor-sync group (the crosshair
// tracks across them) and an x-zoom/pan sync, so comparable-x windows can be
// compared point-by-point. This is the MultiPanelStage sync idiom
// (`opts.cursor = { ...opts.cursor, sync: { key } }` plus a `setScale` hook
// that pushes an x-range onto the sibling instances), lifted across window
// boundaries. Y-scales deliberately stay per-window — only cursor + x-range
// sync, exactly what the multipanel idiom gives its panels.
//
// Cursor sync rides uPlot's own built-in sync registry (keyed by the string
// from `windowSyncKey` — uPlot subscribes an instance on create and
// unsubscribes on destroy; no bookkeeping needed here). The x-range sync,
// however, must call `setScale` on the OTHER live instances of the group,
// which uPlot's sync doesn't expose — hence the tiny module-level registry
// below: `PlotViewport` registers its instance after create and unregisters
// on destroy. Unlike `multipanel.xZoomSyncHook` (whose ONE closure — and so
// one re-entrancy flag — is shared by every panel of a single stage), each
// window builds its own hook instance, so the guard lives PER GROUP: a
// per-instance flag would let A→B propagation re-trigger B's own hook and
// bounce back to A forever.

import type uPlot from "uplot";

/** The uPlot cursor-sync key for link group `n` (`qz-win-link-<n>`);
 *  undefined for an unlinked window (null/undefined group) — callers thread
 *  the result straight into `PlotViewport`'s optional `syncKey` prop. */
export function windowSyncKey(linkGroup: number | null | undefined): string | undefined {
  return linkGroup == null ? undefined : `qz-win-link-${linkGroup}`;
}

interface SyncGroup {
  plots: Set<uPlot>;
  /** Re-entrancy guard for the whole group (see the module doc): true while
   *  one member is mid-propagation, so the `setScale` calls it makes on its
   *  siblings never re-propagate. */
  syncing: boolean;
}

const groups = new Map<string, SyncGroup>();

/** Join `u` to `key`'s x-range sync group. Returns the matching unregister
 *  (call it right before destroying the instance); an emptied group is
 *  dropped from the map entirely, so link groups never leak instances. */
export function registerSyncPlot(key: string, u: uPlot): () => void {
  let g = groups.get(key);
  if (!g) {
    g = { plots: new Set(), syncing: false };
    groups.set(key, g);
  }
  g.plots.add(u);
  return () => {
    g.plots.delete(u);
    if (g.plots.size === 0) groups.delete(key);
  };
}

/** A uPlot `hooks.setScale` callback propagating an x-zoom/pan on one window
 *  to every other registered member of `key`'s group — the cross-window
 *  counterpart of `multipanel.xZoomSyncHook` (same x-only contract, same
 *  null-range guard), with the group-level re-entrancy guard described in
 *  the module doc. */
export function windowXSyncHook(key: string): (self: uPlot, scaleKey: string) => void {
  return (u, scaleKey) => {
    if (scaleKey !== "x") return;
    const g = groups.get(key);
    if (!g || g.syncing) return;
    const { min, max } = u.scales.x;
    if (min == null || max == null) return;
    g.syncing = true;
    try {
      for (const other of g.plots) {
        if (other !== u) other.setScale("x", { min, max });
      }
    } finally {
      g.syncing = false;
    }
  };
}
