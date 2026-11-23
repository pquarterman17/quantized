// Small screens, owner decision D6 (WORKSPACE_LAYOUT_PLAN P5). By default the
// windows stay floating on a narrow screen and nothing here runs. With the
// "tile below width" setting on, a viewport narrower than that width shows the
// windows TILED in the centre grid, while the user's own layout is kept
// untouched in `layout.tiled.from`:
// - `tileNarrow` tiles every window on screen the first time, and afterwards
//   only docks the windows that were not on screen before (a window opened
//   while narrow joins the grid; one the user moved while narrow stays put);
// - `untile` gives back the user's layout. The arrangement (slots, order,
//   shares, edges, centre mode, the floating stack) is the saved one; only
//   what is CONTENT rather than arrangement follows the narrow session: which
//   windows exist and are open, and the Data / Analysis / tool pins.
// A save while narrow writes `untile(layout)`, never the tile, so the saved
// layout is never overwritten by the width rule. Pure, lazy (layout chunks only).

import { close, dock, placementEntries, pruneRefs, reopen, tileAll } from "./ops";
import type { WindowLayoutV1, WindowRef } from "./types";

/** Is the width rule in force? `below` is the pref (`qz.prefs` layoutTileBelow: 0 = off, else 600 to
 *  3,840 px, the range store/prefs.ts reads and Preferences ▸ Small screens offers). */
export function isNarrow(below: number, width: number): boolean {
  return below > 0 && Number.isFinite(width) && width < below;
}

/** Tile `shown` (the windows on screen, in reading order) for a narrow
 *  viewport. Returns the SAME object when nothing changes. */
export function tileNarrow(layout: WindowLayoutV1, shown: readonly WindowRef[]): WindowLayoutV1 {
  if (!layout.tiled) {
    if (!shown.length) return layout;
    const base: WindowLayoutV1 = { ...layout };
    return { ...tileAll(base, [...shown]), tiled: { from: base, refs: [...shown] } };
  }
  const fresh = shown.filter((r) => !layout.tiled!.refs.includes(r));
  if (!fresh.length) return layout;
  let next = layout;
  for (const r of fresh) next = dock(next, r, "centre");
  return { ...next, tiled: { from: layout.tiled.from, refs: [...layout.tiled.refs, ...fresh] } };
}

/** The user's own layout back from a narrow tile (header). Identity when not tiled. */
export function untile(layout: WindowLayoutV1): WindowLayoutV1 {
  if (!layout.tiled) return layout;
  const live = layout.placements;
  // Windows that went away while narrow (a closed plot window) go from the saved layout too.
  let out = pruneRefs(layout.tiled.from, (r) => live[r] !== undefined);
  for (const [r, p] of placementEntries(layout)) {
    const saved = out.placements[r];
    if (p.open && !saved?.open) out = reopen(out, r); // opened while narrow: where it was, or its default
    else if (!p.open && saved?.open) out = close(out, r);
  }
  const restored: WindowLayoutV1 = { v: 1, placements: out.placements, z: out.z, edges: out.edges, centre: out.centre, data: layout.data };
  return layout.pins ? { ...restored, pins: layout.pins } : restored;
}
