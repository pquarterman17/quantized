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
 * - `data` and `analysis` start closed, remembering the right edge (floating when `small`).
 * - `small` (a viewport under SMALL_SCREEN_PX, owner decision D6): nothing docks. Plot windows keep
 *   their classic rects and Style floats; docking would squeeze the plot to a sliver on a screen this
 *   narrow. Classic's PlotWindow geometry and maximize are never written. Known issue (documented for
 *   the owner): a full-desk floating plot can sit under Style.
 */
export function seedFromClassic(classic: ClassicSnapshot, opts: { small?: boolean } = {}): WindowLayoutV1 {
  let layout = emptyLayout();
  const byZ = [...classic.plotWindows].sort((a, b) => a.z - b.z);
  const maximized = byZ.filter((w) => w.winState === "maximized").at(-1) ?? null;
  const visible = byZ.filter((w) => w.winState !== "minimized");
  const gather = !opts.small && visible.length > 1;
  for (const w of byZ) {
    const centre = !opts.small && (gather ? visible.includes(w) : w === maximized);
    layout = centre ? dock(layout, plotRef(w.id), "centre") : float(layout, plotRef(w.id));
  }
  if (gather) layout = { ...layout, centre: "grid" };
  layout = opts.small ? float(layout, "style") : dock(layout, "style", "right");
  if (classic.dockedTool) layout = opts.small ? float(layout, toolRef(classic.dockedTool)) : dock(layout, toolRef(classic.dockedTool), "right");
  for (const id of classic.floatingTools ?? []) if (id !== classic.dockedTool) layout = float(layout, toolRef(id));
  // Closed, remembering the right edge. Small desk: the placement is "floating", so opening Data (or Analysis)
  // puts it above the floating plots instead of docking it under them.
  for (const ref of ["data", "analysis"] as const) {
    layout = { ...layout, placements: { ...layout.placements, [ref]: { slot: opts.small ? null : "right", order: 0, share: 1, lastSlot: "right", open: false } } };
  }
  return layout;
}
