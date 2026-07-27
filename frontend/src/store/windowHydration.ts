// Staged plot-window hydration on workspace restore (P3.4 slice 4,
// docs/performance_envelope.md finding 10). A standalone store — like
// store/pendingOps and store/autosaveStatus — rather than a field on useApp,
// for the same reason pendingOps gives: useApp.ts is at its size-ratchet
// ceiling (architecture.test.ts's STORE_PINS, zero headroom) and this is pure
// runtime/session bookkeeping — never persisted, never part of a `.dwk`, and
// a stale value restored from one would be actively misleading.
//
// The problem this fixes: WindowCanvas.tsx mounts every VISIBLE
// `plotWindows[]` entry in one React commit; each plot/snapshot/panel
// window's content eventually reaches PlotViewport, whose create effect
// calls `new uPlot(...)` synchronously — a real layout + canvas paint, not
// just a cheap component mount. Reopening an 11-window `.dwk` therefore does
// 11 uPlot creates in a single commit: slice 3's instrumentation proved only
// ~0.4-0.6 s of the reopen's ~6 s freeze is the (now off-main-thread) JSON
// parse — the other ~5-6 s is this render/mount storm.
//
// The fix: `stageWorkspaceRestore` (called immediately after `loadWorkspace`/
// `appendWorkspace` returns — see the call sites) marks every restored window
// except the active one, and any window already carrying a cross-window link
// group, as "pending". WindowCanvas.tsx renders a lightweight placeholder
// body for a pending window instead of mounting its real content; the rAF
// chain below drains `pending` one window per animation frame (in its
// insertion order — a `Set` iterates in the order values were added, so no
// separate queue array is needed), so the one giant blocking commit becomes
// ~N small ones and the tab stays responsive throughout. A window mounted
// through any ordinary interactive path (createWindow/duplicateWindow/
// tileWindows/cascadeWindows/…) is NEVER staged — `pending` starts (and
// mostly stays) empty, so a fresh or small session renders exactly as it
// always has, with no count threshold and no heuristic: staging only ever
// happens via an explicit `stageWorkspaceRestore` call on the bulk-restore
// paths.
//
// `forceHydrate` is the escape hatch for "this window must show real content
// RIGHT NOW, not on its drain turn": WindowCanvas calls it whenever
// `focusedWindowId` changes (a click/keyboard focus lands on a placeholder),
// and the cross-window link-group toggle (WindowTitleButtons' ⧟ button,
// windowMenu.ts's matching context-menu entry) calls it before cycling —
// a linked window with no live uPlot instance can't register with
// lib/windowsync's sync group (`registerSyncPlot` only runs from
// PlotViewport's create effect). Hydration is STICKY: once forced (or once a
// window's drain turn comes up), it never reverts to a placeholder — nothing
// in this module ever re-adds an id to `pending`.

import { create } from "zustand";

import type { PlotWindow } from "../lib/plotview";

interface WindowHydrationState {
  /** Window ids still waiting for their real content to mount, in drain
   *  order (a `Set`'s iteration order is insertion order). Anything NOT in
   *  this set reads as hydrated — see `isHydrated`. */
  pending: Set<string>;
}

/** The zustand hook itself, exported directly — same convention as
 *  store/pendingOps's `usePendingOps`/store/autosaveStatus's
 *  `useAutosaveStatus` (a raw store hook, not a single-purpose wrapper).
 *  WindowCanvas reads `.pending` ONCE per render (`useWindowHydration((s) =>
 *  s.pending)`) rather than a per-window hook, so a window's own real-vs-
 *  placeholder check is a plain `.has(win.id)` inline in its render map —
 *  no second component whose only job would be satisfying the rules-of-
 *  hooks (a hook can't be called conditionally inside `.map()`, but reading
 *  a value obtained from one top-level hook call is just a property read). */
export const useWindowHydration = create<WindowHydrationState>(() => ({ pending: new Set() }));

let rafHandle: number | null = null;

function stopDraining(): void {
  if (rafHandle == null) return;
  cancelAnimationFrame(rafHandle);
  rafHandle = null;
}

/** Every mutator below (except `beginStagedHydration`, which always follows
 *  up with `scheduleDrain` itself) funnels its new `pending` through here:
 *  commit it, then cancel any outstanding scheduled frame if that emptied
 *  the set — a stray already-scheduled frame would otherwise still fire
 *  (harmlessly, `drainOne` no-ops on an empty set) but needlessly. */
function updatePending(pending: Set<string>): void {
  useWindowHydration.setState({ pending });
  if (pending.size === 0) stopDraining();
}

/** Hydrate the OLDEST still-pending id and reschedule itself while more
 *  remain. The entire "one window per frame" policy is this one recursive
 *  rAF chain — no per-component timers anywhere else. */
function drainOne(): void {
  rafHandle = null;
  const pending = new Set(useWindowHydration.getState().pending);
  const id = pending.values().next().value;
  if (id === undefined) return; // emptied by a forceHydrate/prune since scheduling
  pending.delete(id);
  updatePending(pending);
  scheduleDrain();
}

function scheduleDrain(): void {
  if (rafHandle != null) return; // a drain is already scheduled
  if (useWindowHydration.getState().pending.size === 0) return;
  rafHandle = requestAnimationFrame(drainOne);
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

/** Force `id` hydrated immediately, dequeuing it if it was still waiting.
 *  Sticky (see the module doc) and safe to call on an id that was never
 *  staged — a plain no-op, so every call site can call this unconditionally
 *  rather than checking `isHydrated` first. */
export function forceHydrate(id: string): void {
  const pending = useWindowHydration.getState().pending;
  if (!pending.has(id)) return;
  const next = new Set(pending);
  next.delete(id);
  updatePending(next);
}

/** Drop every pending id NOT in `liveIds` — WindowCanvas calls this on every
 *  `plotWindows` change so a window closed mid-stage doesn't waste a future
 *  drain frame on an id nothing renders anymore. Purely bookkeeping: the
 *  closed window's placeholder is already gone from the DOM either way. */
export function pruneHydration(liveIds: ReadonlySet<string>): void {
  const pending = useWindowHydration.getState().pending;
  if (pending.size === 0) return;
  const next = new Set([...pending].filter((id) => liveIds.has(id)));
  if (next.size !== pending.size) updatePending(next);
}

/** Test-only reset: clears all staging state and cancels any in-flight
 *  drain, so one test's scheduling can't leak into the next. */
export function resetWindowHydrationForTests(): void {
  stopDraining();
  useWindowHydration.setState({ pending: new Set() });
}
