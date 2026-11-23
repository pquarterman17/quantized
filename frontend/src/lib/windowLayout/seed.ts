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

/**
 * - the maximized plot window (if any) docks to the centre; every other plot
 *   window floats, stacked in its classic z order, at its own geometry;
 * - the Inspector becomes `style` on the right, the docked tool right under it;
 * - floating tools stay floating (at their `toolWindowLayout` rects);
 * - `data` and `analysis` start closed, remembering the right edge.
 */
export function seedFromClassic(classic: ClassicSnapshot): WindowLayoutV1 {
  let layout = emptyLayout();
  const byZ = [...classic.plotWindows].sort((a, b) => a.z - b.z);
  const maximized = byZ.filter((w) => w.winState === "maximized").at(-1) ?? null;
  for (const w of byZ) layout = w === maximized ? dock(layout, plotRef(w.id), "centre") : float(layout, plotRef(w.id));
  layout = dock(layout, "style", "right");
  if (classic.dockedTool) layout = dock(layout, toolRef(classic.dockedTool), "right");
  for (const id of classic.floatingTools ?? []) if (id !== classic.dockedTool) layout = float(layout, toolRef(id));
  for (const ref of ["data", "analysis"] as const) {
    layout = { ...layout, placements: { ...layout.placements, [ref]: { slot: "right", order: 0, share: 1, lastSlot: "right", open: false } } };
  }
  return layout;
}
