// "Reset layout" (WORKSPACE_LAYOUT_PLAN P6): back to the default seed for this
// screen width (lib/windowLayout/seed.ts, the D6 floating seed under 1280 px),
// NOT the per-user template, which is what the user is resetting away from.
// Only the ARRANGEMENT resets. What is content rather than arrangement is kept,
// the same split as the narrow-screen untile (narrowTile.ts): which windows are
// open (Data, Analysis, Style and the tool windows of open tools), the Data,
// Analysis and tool pins, and the Data follow setting. A narrow-screen tile is
// dropped with the rest of the arrangement (the width rule tiles the new desk
// again while it holds). Pure, lazy (layout chunks only).

import { untile } from "./narrowTile";
import { close, float, reopen } from "./ops";
import { kindOf, toolRef } from "./refs";
import type { WindowLayoutV1, WindowRef } from "./types";

export interface ResetInput {
  /** The default seed for this screen width (store/windowLayoutRun.ts `seedLayout`). */
  seed: WindowLayoutV1;
  /** The layout on screen now. */
  live: WindowLayoutV1;
  /** The tools whose windows are open (mounted), in the order to place them. */
  openTools: readonly string[];
  /** Under the D6 small-screen width: a tool window floats instead of docking at the bottom. */
  small: boolean;
}

export function resetLayout({ seed, live, openTools, small }: ResetInput): WindowLayoutV1 {
  const mine = untile(live);
  const wasOpen = (ref: "data" | "analysis" | "style") => mine.placements[ref]?.open === true;
  let out = seed;
  for (const ref of ["data", "analysis"] as const) if (wasOpen(ref)) out = reopen(out, ref);
  if (!wasOpen("style")) out = close(out, "style");
  for (const id of openTools) out = small ? float(out, toolRef(id)) : reopen(out, toolRef(id));
  const kept: WindowLayoutV1 = { ...out, data: { ...mine.data } };
  delete kept.tiled;
  if (!mine.pins) {
    delete kept.pins;
    return kept;
  }
  // A pin needs a window the layout places (the sanitizer's rule). A closed, pinned tool the seed does not
  // place keeps a closed placement at its default (the bottom; floating on a small screen), so its pin is saved.
  const placements = { ...kept.placements };
  for (const ref of Object.keys(mine.pins) as WindowRef[]) {
    if (!placements[ref] && kindOf(ref) === "tool") placements[ref] = { slot: small ? null : "bottom", order: 0, share: 1, lastSlot: "bottom", open: false };
  }
  return { ...kept, placements, pins: { ...mine.pins } };
}
