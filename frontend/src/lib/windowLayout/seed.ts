// The first layout of a user who turns the window layout on (plan
// "Migration of existing users"): built from what classic mode shows now, so
// the desk does not jump. Pure: the caller reads the store and the tool dock.

import { dock, emptyLayout, float } from "./ops";
import { plotRef, toolRef } from "./refs";
import type { WindowLayoutV1 } from "./types";

/** The parts of classic state the seed reads. */
export interface ClassicSnapshot {
  /** Every plot-family document window (`PlotWindow` subset). */
  plotWindows: ReadonlyArray<{ id: string; z: number; winState?: string }>;
  /** The tool docked in the side column (`toolDockSnapshot().owner`), if any. */
  dockedTool: string | null;
  /** Tools open as floating windows. Optional: a tool window also places itself
   *  when it mounts in windows mode. */
  floatingTools?: readonly string[];
}

/** Below this desk width (px) a first switch seeds everything floating (D6). */
export const SMALL_SCREEN_PX = 1280;

/**
 * - the maximized plot window (if any) docks to the centre; every other plot
 *   window floats, stacked in its classic z order, at its own geometry;
 * - TWO OR MORE visible plot windows all dock to the centre as a grid instead:
 *   a floating window keeps its classic rect, which on the new desk lands on
 *   the docked Style window and covers its title bar and dock buttons;
 * - the Inspector becomes `style` on the right, the docked tool right under it;
 * - floating tools stay floating (at their `toolWindowLayout` rects);
 * - `data` and `analysis` start closed, remembering the right edge.
 * - `small` (a viewport under SMALL_SCREEN_PX): D6 says windows stay floating there, but a floating
 *   plot keeps its classic rect and (maximized, or 480 px wide beside a 380 px Style) covers Style or
 *   hides what opens beside it (UX pass 2, M1), and narrowing it would rewrite classic's own geometry.
 *   So every visible plot docks to the centre instead (Style right, as on a wide desk): a deliberate
 *   deviation from D6, layout-only; classic geometry and maximize are never touched.
 */
export function seedFromClassic(classic: ClassicSnapshot, opts: { small?: boolean } = {}): WindowLayoutV1 {
  let layout = emptyLayout();
  const byZ = [...classic.plotWindows].sort((a, b) => a.z - b.z);
  const maximized = byZ.filter((w) => w.winState === "maximized").at(-1) ?? null;
  const visible = byZ.filter((w) => w.winState !== "minimized");
  const gather = visible.length > 1;
  for (const w of byZ) {
    const centre = gather || (opts.small === true && visible.length > 0) ? visible.includes(w) : w === maximized;
    layout = centre ? dock(layout, plotRef(w.id), "centre") : float(layout, plotRef(w.id));
  }
  if (gather) layout = { ...layout, centre: "grid" };
  layout = dock(layout, "style", "right");
  if (classic.dockedTool) layout = dock(layout, toolRef(classic.dockedTool), "right");
  for (const id of classic.floatingTools ?? []) if (id !== classic.dockedTool) layout = float(layout, toolRef(id));
  for (const ref of ["data", "analysis"] as const) {
    layout = { ...layout, placements: { ...layout.placements, [ref]: { slot: "right", order: 0, share: 1, lastSlot: "right", open: false } } };
  }
  return layout;
}
