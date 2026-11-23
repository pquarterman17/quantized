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
import { close, dock, float, reopen, stackOf } from "./ops";
import { kindOf, toolRef } from "./refs";
import { SLOTS, type WindowLayoutV1, type WindowRef } from "./types";

export interface ResetInput {
  /** The default seed for this screen width (store/windowLayoutRun.ts `seedLayout`). */
  seed: WindowLayoutV1;
  /** The layout on screen now. */
  live: WindowLayoutV1;
  /** The tools whose windows are open (mounted), in the order to place them. */
  openTools: readonly string[];
  /** Plot windows that are minimized: the seed floats them (they sit in the strip), and a reset leaves them so. */
  minimized?: readonly WindowRef[];
  /** Under the D6 small-screen width: a tool window floats instead of docking at the bottom. */
  small: boolean;
}

/** Plot windows the seed leaves floating (it keeps a lone, unmaximized plot where classic had it, so
 *  turning windows mode on does not jump the desk) go to the centre, as a new project's plots do: the
 *  first at the head, the rest tiled beside it in a row, in the order the user's desk shows them
 *  (UX pass 5 M1: a Float all, then Reset, left the plot floating on an empty centre). Not the
 *  narrow screen's seed, where everything floats (D6). */
function plotsToCentre(seed: WindowLayoutV1, live: WindowLayoutV1, minimized: readonly WindowRef[]): WindowLayoutV1 {
  const shown = (r: WindowRef) => seed.placements[r]?.open === true && seed.placements[r]?.slot === null && !minimized.includes(r);
  const order = [...SLOTS.flatMap((s) => stackOf(live, s)), ...live.z, ...(Object.keys(seed.placements) as WindowRef[])];
  let out = seed;
  for (const ref of new Set(order)) if (kindOf(ref) === "plot" && shown(ref)) out = dock(out, ref, "centre");
  return out;
}

export function resetLayout({ seed, live, openTools, small, minimized = [] }: ResetInput): WindowLayoutV1 {
  const mine = untile(live);
  const wasOpen = (ref: "data" | "analysis" | "style") => mine.placements[ref]?.open === true;
  let out = seed;
  if (!small) out = plotsToCentre(out, mine, minimized);
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
