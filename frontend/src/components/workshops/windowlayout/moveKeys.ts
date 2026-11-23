// The keys of the layout's keyboard move mode (Alt+Shift+M, WORKSPACE_LAYOUT_PLAN
// D13), as a pure table: what a keydown asks of the focused window.

import type { Slot } from "../../../lib/windowLayout/types";

/** Arrow step of a floating window in px (Shift: 1 px), the plan's move-mode step. */
export const MOVE_STEP = 16;
export const MOVE_STEP_SMALL = 1;

export type MoveAction =
  | { type: "move"; dx: number; dy: number }
  | { type: "dock"; slot: Slot }
  | { type: "float" }
  | { type: "commit" };

const DOCK: Record<string, Slot> = { l: "left", r: "right", b: "bottom", c: "centre" };
const ARROW: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** The action a key means in move mode, or null (the key is not ours).
 *  Escape is not here: it cancels through the app's Escape ladder. */
export function moveAction(e: { key: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): MoveAction | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const arrow = ARROW[e.key];
  if (arrow) {
    const step = e.shiftKey ? MOVE_STEP_SMALL : MOVE_STEP;
    return { type: "move", dx: arrow[0] * step, dy: arrow[1] * step };
  }
  if (e.key === "Enter") return { type: "commit" };
  const k = e.key.toLowerCase();
  if (e.shiftKey) return null;
  if (k === "f") return { type: "float" };
  return k in DOCK ? { type: "dock", slot: DOCK[k] } : null;
}
