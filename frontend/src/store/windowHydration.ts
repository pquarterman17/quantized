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
// PURE: the store is read by every importer, so the build keeps it; the annotation only tells it this
// module has no other effect, which is what lets the lazy half in ./windowHydrationStaged.ts stay out of the entry chunk.
export const useWindowHydration = /* @__PURE__ */ create<WindowHydrationState>(() => ({ pending: new Set() }));

/** The pending animation-frame handle of the staged drain, held in an object so the lazy half
 *  (./windowHydrationStaged.ts, which schedules the drain) and `stopDraining` below share it. */
export const drain: { raf: number | null } = { raf: null };

export function stopDraining(): void {
  if (drain.raf == null) return;
  cancelAnimationFrame(drain.raf);
  drain.raf = null;
}

/** Every mutator below (except `beginStagedHydration`, which always follows
 *  up with `scheduleDrain` itself) funnels its new `pending` through here:
 *  commit it, then cancel any outstanding scheduled frame if that emptied
 *  the set — a stray already-scheduled frame would otherwise still fire
 *  (harmlessly, `drainOne` no-ops on an empty set) but needlessly. */
export function updatePending(pending: Set<string>): void {
  useWindowHydration.setState({ pending });
  if (pending.size === 0) stopDraining();
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

// `drainOne`, `scheduleDrain`, `isHydrated`, `beginStagedHydration`, `stageWorkspaceRestore`, `resetWindowHydrationForTests` live in ./windowHydrationStaged.ts: no eager module uses them.
export * from "./windowHydrationStaged";
