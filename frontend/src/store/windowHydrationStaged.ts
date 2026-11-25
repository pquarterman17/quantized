// The lazy-only half of windowHydration.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the staged-restore drain: its animation-frame chain, the restore entry point and the hydrated test. Only the lazy restore flows and the test seam call them; the eager window canvas keeps force/prune.
// The code moved here verbatim and windowHydration.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import type { PlotWindow } from "../lib/plotview";
import { drain, stopDraining, updatePending, useWindowHydration } from "./windowHydration";

/** Hydrate the OLDEST still-pending id and reschedule itself while more
 *  remain. The entire "one window per frame" policy is this one recursive
 *  rAF chain — no per-component timers anywhere else. */
function drainOne(): void {
  drain.raf = null;
  const pending = new Set(useWindowHydration.getState().pending);
  const id = pending.values().next().value;
  if (id === undefined) return; // emptied by a forceHydrate/prune since scheduling
  pending.delete(id);
  updatePending(pending);
  scheduleDrain();
}

function scheduleDrain(): void {
  if (drain.raf != null) return; // a drain is already scheduled
  if (useWindowHydration.getState().pending.size === 0) return;
  drain.raf = requestAnimationFrame(drainOne);
}

/** True once `id`'s real content is allowed to mount. */
export function isHydrated(id: string): boolean {
  return !useWindowHydration.getState().pending.has(id);
}

/** Stage `ids` for progressive hydration, in the given order (the caller
 *  decides priority — see `stageWorkspaceRestore` below). Replaces whatever
 *  staging was already in flight: a second restore mid-drain supersedes the
 *  first outright, since nothing from a superseded session is worth
 *  finishing. An empty `ids` array is a deliberate no-op (costs nothing) —
 *  this is what keeps a small/fresh session's render path identical to
 *  before this module existed. */
export function beginStagedHydration(ids: readonly string[]): void {
  stopDraining();
  useWindowHydration.setState({ pending: new Set(ids) });
  scheduleDrain();
}

/** The workspace-restore entry point. Stages every restored window EXCEPT
 *  the active one and any window already carrying a cross-window link group
 *  (`linkGroup != null`) — a linked window must be able to join
 *  `lib/windowsync`'s sync registry immediately on restore, not wait for a
 *  drain turn, or it would silently sit out of the group it was persisted
 *  into until then. Ordered z DESCENDING: topmost/most-recently-raised
 *  first, on the theory that a restored session's user is more likely to
 *  look at whatever was on top than something buried underneath.
 *
 *  Call this in the SAME synchronous tick as the `loadWorkspace`/
 *  `appendWorkspace` call it follows (see the call sites) — Zustand's `set`
 *  updates the store synchronously but never forces a React render inline,
 *  so this always finishes seeding `pending` before WindowCanvas's next
 *  render ever queries the freshly-restored window ids. */
export function stageWorkspaceRestore(
  windows: readonly PlotWindow[],
  activeId: string | null,
): void {
  beginStagedHydration(
    windows
      .filter((w) => w.id !== activeId && !w.linkGroup)
      .sort((a, b) => b.z - a.z)
      .map((w) => w.id),
  );
}

/** Test-only reset: clears all staging state and cancels any in-flight
 *  drain, so one test's scheduling can't leak into the next. */
export function resetWindowHydrationForTests(): void {
  stopDraining();
  useWindowHydration.setState({ pending: new Set() });
}
