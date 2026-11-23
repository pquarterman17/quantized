// Pure layout operations (WORKSPACE_LAYOUT_PLAN, "Layout model"). Every one
// is `(layout, ...) -> layout`: no React, no store, no DOM, never a mutation of
// its input. A no-op returns the SAME object, so a store setter can skip a
// write. Lazy-loaded (not in the eager bundle): only the layout host and the
// slice's async actions import it.
//
// Invariants every op keeps (checked by `checkInvariants` in the tests):
// - a slot's OPEN windows have orders 0..n-1 and shares summing to 1;
// - `z` holds exactly the open floating windows, each once (back -> front);
// - a docked window's `lastSlot` is its slot (so float -> Dock returns it).

import { defaultSlotOf, kindOf } from "./refs";
import { SLOTS, type CentreMode, type Placement, type Slot, type WindowLayoutV1, type WindowRef } from "./types";

type Placements = WindowLayoutV1["placements"];

export function emptyLayout(): WindowLayoutV1 {
  return {
    v: 1,
    placements: {},
    z: [],
    edges: { left: 0, right: 0, bottom: 0 },
    centre: "row",
    data: { pinned: null, follow: "plot" },
  };
}

/** Every placement, as typed entries. */
export function placementEntries(layout: WindowLayoutV1): [WindowRef, Placement][] {
  return Object.entries(layout.placements) as [WindowRef, Placement][];
}

/** The open windows docked in `slot`, first to last. Ties (only possible in
 *  hand-built input) break by ref so the result is deterministic. */
export function stackOf(layout: WindowLayoutV1, slot: Slot): WindowRef[] {
  return placementEntries(layout)
    .filter(([, p]) => p.open && p.slot === slot)
    .sort(([ra, a], [rb, b]) => a.order - b.order || (ra < rb ? -1 : ra > rb ? 1 : 0))
    .map(([r]) => r);
}

export function isOpen(layout: WindowLayoutV1, ref: WindowRef): boolean {
  return layout.placements[ref]?.open === true;
}

/** A window that was never placed: closed, remembering its default slot. */
function placementOf(layout: WindowLayoutV1, ref: WindowRef): Placement {
  return layout.placements[ref] ?? { slot: null, order: 0, share: 1, lastSlot: defaultSlotOf(ref), open: false };
}

/** Rewrite `slot`'s stack as `refs` (in order): orders 0..n-1, shares
 *  renormalised to 1. `newcomer` (just inserted) takes 1/n and the others
 *  shrink in proportion; `equal` gives every window 1/n (tiling). */
function restack(placements: Placements, slot: Slot, refs: WindowRef[], opts: { newcomer?: WindowRef; equal?: boolean } = {}): void {
  const n = refs.length;
  if (!n) return;
  const others = refs.filter((r) => r !== opts.newcomer);
  const base = opts.newcomer !== undefined && refs.includes(opts.newcomer) ? 1 / n : 0;
  const shares = others.map((r) => {
    const s = placements[r]?.share ?? 0;
    return Number.isFinite(s) && s > 0 ? s : 0;
  });
  const total = shares.reduce((a, b) => a + b, 0);
  refs.forEach((r, order) => {
    const p = placements[r]!;
    let share: number;
    if (opts.equal) share = 1 / n;
    else if (r === opts.newcomer) share = base;
    else {
      const s = shares[others.indexOf(r)];
      share = total > 0 ? ((1 - base) * s) / total : (1 - base) / others.length;
    }
    placements[r] = { ...p, slot, order, share, open: true };
  });
}

/** Take `ref` out of its current stack (if it is docked and open). */
function unstack(layout: WindowLayoutV1, placements: Placements, ref: WindowRef): void {
  const p = layout.placements[ref];
  if (p?.open && p.slot) restack(placements, p.slot, stackOf(layout, p.slot).filter((r) => r !== ref));
}

/** Dock `ref` into `slot` at `index` (default: the end of the stack). A window
 *  already in that slot is moved, keeping its share; a newcomer takes 1/n. */
export function dock(layout: WindowLayoutV1, ref: WindowRef, slot: Slot, index?: number): WindowLayoutV1 {
  const p = placementOf(layout, ref);
  const already = p.open && p.slot === slot;
  const placements: Placements = { ...layout.placements };
  if (!already) unstack(layout, placements, ref);
  const target = stackOf(layout, slot).filter((r) => r !== ref);
  const at = Math.max(0, Math.min(target.length, Number.isFinite(index) ? Math.trunc(index!) : target.length));
  target.splice(at, 0, ref);
  placements[ref] = { ...p, slot, lastSlot: slot, open: true };
  restack(placements, slot, target, already ? {} : { newcomer: ref });
  return { ...layout, placements, z: layout.z.filter((r) => r !== ref) };
}

/** Float `ref` (opening it if closed), in front of every other floating window. */
export function float(layout: WindowLayoutV1, ref: WindowRef): WindowLayoutV1 {
  const p = placementOf(layout, ref);
  if (p.open && p.slot === null && layout.z.at(-1) === ref) return layout;
  const placements: Placements = { ...layout.placements };
  unstack(layout, placements, ref);
  placements[ref] = { ...p, slot: null, lastSlot: (p.open ? p.slot : null) ?? p.lastSlot, open: true };
  return { ...layout, placements, z: [...layout.z.filter((r) => r !== ref), ref] };
}

/** A title-bar dock button: docks to `slot`, or, when the window is already
 *  docked there (the button shows pressed), floats it (D2). */
export function toggleDock(layout: WindowLayoutV1, ref: WindowRef, slot: Slot): WindowLayoutV1 {
  const p = layout.placements[ref];
  return p?.open && p.slot === slot ? float(layout, ref) : dock(layout, ref, slot);
}

/** Move a docked window to `index` within its own slot. No-op when floating or closed. */
export function move(layout: WindowLayoutV1, ref: WindowRef, index: number): WindowLayoutV1 {
  const p = layout.placements[ref];
  if (!p?.open || p.slot === null) return layout;
  if (stackOf(layout, p.slot).indexOf(ref) === Math.trunc(index)) return layout;
  return dock(layout, ref, p.slot, index);
}

/** Close a window, keeping its placement (slot, order, share) for reopen. */
export function close(layout: WindowLayoutV1, ref: WindowRef): WindowLayoutV1 {
  const p = layout.placements[ref];
  if (!p?.open) return layout;
  const placements: Placements = { ...layout.placements };
  unstack(layout, placements, ref);
  placements[ref] = { ...p, open: false };
  return { ...layout, placements, z: layout.z.filter((r) => r !== ref) };
}

/** Bring a floating window to the front. No-op for a docked or closed one. */
export function focusWindow(layout: WindowLayoutV1, ref: WindowRef): WindowLayoutV1 {
  const p = layout.placements[ref];
  if (!p?.open || p.slot !== null || layout.z.at(-1) === ref) return layout;
  return { ...layout, z: [...layout.z.filter((r) => r !== ref), ref] };
}

/** Open a window where it was: one window per tool (D7), so an OPEN window is
 *  only focused. A closed one returns to its remembered slot and position (or
 *  floats, if it was floating); one never placed docks to its default slot. */
export function reopen(layout: WindowLayoutV1, ref: WindowRef): WindowLayoutV1 {
  const p = layout.placements[ref];
  if (p?.open) return focusWindow(layout, ref);
  if (!p) return dock(layout, ref, defaultSlotOf(ref));
  return p.slot ? dock(layout, ref, p.slot, p.order) : float(layout, ref);
}

/** Put `front` (in this order) at the head of a slot's stack, keep the slot's
 *  other open windows after them, and give every one an equal share. */
function gather(layout: WindowLayoutV1, slot: Slot, front: WindowRef[], centre?: CentreMode): WindowLayoutV1 {
  const chosen = [...new Set(front)];
  if (!chosen.length) return layout;
  const placements: Placements = { ...layout.placements };
  const moving = new Set(chosen);
  // Every stack the chosen windows leave is re-packed without them.
  for (const s of SLOTS) {
    if (s === slot) continue;
    const stack = stackOf(layout, s);
    if (stack.some((r) => moving.has(r))) restack(placements, s, stack.filter((r) => !moving.has(r)));
  }
  for (const r of chosen) placements[r] = { ...placementOf(layout, r), slot, lastSlot: slot, open: true };
  restack(placements, slot, [...chosen, ...stackOf(layout, slot).filter((r) => !moving.has(r))], { equal: true });
  return { ...layout, placements, z: layout.z.filter((r) => !moving.has(r)), centre: centre ?? layout.centre };
}

/** "Tile all" (D4): the chosen windows share the centre as a grid, equally. */
export function tileAll(layout: WindowLayoutV1, refs: WindowRef[]): WindowLayoutV1 {
  return gather(layout, "centre", refs, "grid");
}

/** "Plot | Data side by side" (D4): the plot then Data at the head of the
 *  centre, in a row. Every other window stays where it is. */
export function plotBesideData(layout: WindowLayoutV1, plot: WindowRef): WindowLayoutV1 {
  if (kindOf(plot) !== "plot") return layout;
  return gather(layout, "centre", [plot, "data"], "row");
}

/** "Dock all" (D4): the focused plot to the centre, Data then Style then
 *  Analysis to the right, every open tool to the bottom. Closed windows stay
 *  closed and other plot windows stay where they are. */
export function dockAll(layout: WindowLayoutV1, focusedPlot: WindowRef | null): WindowLayoutV1 {
  let next = layout;
  if (focusedPlot && kindOf(focusedPlot) === "plot") next = gather(next, "centre", [focusedPlot]);
  const right = (["data", "style", "analysis"] as const).filter((r) => isOpen(layout, r));
  if (right.length) next = gather(next, "right", right);
  const bottom = stackOf(next, "bottom").filter((r) => kindOf(r) === "tool");
  const tools = placementEntries(next)
    .filter(([r, p]) => p.open && kindOf(r) === "tool" && p.slot !== "bottom")
    .map(([r]) => r)
    .sort();
  if (tools.length) next = gather(next, "bottom", [...bottom, ...tools]);
  return next;
}

/** "Float all" (D4): every docked window floats at its saved rect, stacked in
 *  front of the already floating ones in layout reading order. */
export function floatAll(layout: WindowLayoutV1): WindowLayoutV1 {
  const docked = SLOTS.flatMap((s) => stackOf(layout, s));
  if (!docked.length) return layout;
  const placements: Placements = { ...layout.placements };
  for (const r of docked) {
    const p = placements[r]!;
    placements[r] = { ...p, slot: null, lastSlot: p.slot, open: true };
  }
  return { ...layout, placements, z: [...layout.z, ...docked] };
}

/** Forget the windows `keep` rejects (a deleted plot window, for instance). */
export function pruneRefs(layout: WindowLayoutV1, keep: (ref: WindowRef) => boolean): WindowLayoutV1 {
  const gone = placementEntries(layout).filter(([r]) => !keep(r)).map(([r]) => r);
  if (!gone.length) return layout;
  let next = layout;
  for (const r of gone) next = close(next, r);
  const placements: Placements = { ...next.placements };
  for (const r of gone) delete placements[r];
  // A pin of a forgotten window goes with it (plan P4).
  if (!next.pins || !gone.some((r) => next.pins![r] !== undefined)) return { ...next, placements };
  const pins = { ...next.pins };
  for (const r of gone) delete pins[r];
  return { ...next, placements, pins };
}
