// The window layout's polite live region (WORKSPACE_LAYOUT_PLAN, "Keyboard and
// accessibility"): "Curve fit docked right, 2 of 2". `describeChange` turns a
// layout change into one sentence (pure); `announce` and `useAnnouncement`
// carry a sentence to the region. Announcing from the layout DIFF, not from
// each action, means every way a window moves (buttons, drag, move mode, the
// Window menu) is covered by one rule.

import { useSyncExternalStore } from "react";

import { stackOf } from "../../../lib/windowLayout/ops";
import type { Slot, WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";

const WHERE: Record<Slot, string> = { left: "left", right: "right", bottom: "bottom", centre: "centre" };

type Where = Slot | "float" | "closed";

function whereOf(layout: WindowLayoutV1, ref: WindowRef): Where {
  const p = layout.placements[ref];
  return !p?.open ? "closed" : (p.slot ?? "float");
}

/** One sentence for what `next` changed from `prev`, or null when no window
 *  changed slot, floated or closed (a resize or a z change is silent). */
export function describeChange(prev: WindowLayoutV1, next: WindowLayoutV1, titleOf: (ref: WindowRef) => string): string | null {
  const refs = new Set([...Object.keys(prev.placements), ...Object.keys(next.placements)] as WindowRef[]);
  const changed = [...refs].filter((r) => whereOf(prev, r) !== whereOf(next, r));
  if (!changed.length) return null;
  if (changed.length === 1) {
    const ref = changed[0];
    const at = whereOf(next, ref);
    const title = titleOf(ref);
    if (at === "closed") return `${title} closed`;
    if (at === "float") return `${title} floating`;
    const stack = stackOf(next, at);
    return `${title} docked ${WHERE[at]}, ${stack.indexOf(ref) + 1} of ${stack.length}`;
  }
  const states = changed.map((r) => whereOf(next, r));
  if (next.centre === "grid" && prev.centre !== "grid" && states.every((s) => s === "centre")) return `${changed.length} windows tiled in the centre`;
  if (states.every((s) => s === "float")) return `${changed.length} windows floating`;
  if (states.every((s) => s !== "float" && s !== "closed")) return `${changed.length} windows docked`;
  return `${changed.length} windows rearranged`;
}

let current = { n: 0, text: "" };
const listeners = new Set<() => void>();

/** Say `text` in the live region (a repeat of the same text is said again). */
export function announce(text: string): void {
  current = { n: current.n + 1, text };
  listeners.forEach((l) => l());
}

/** The sentence a gesture wants said INSTEAD of the one the layout diff is
 *  about to produce (Escape out of move mode puts the window back: the diff
 *  would say "docked left", the gesture says "cancelled"). Consumed by the next
 *  `takeHeld`; one is always said, never both. */
let held: string | null = null;
export function holdAnnouncement(text: string): void {
  held = text;
}
export function takeHeld(): string | null {
  const text = held;
  held = null;
  return text;
}

export function useAnnouncement(): { n: number; text: string } {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => current,
  );
}
