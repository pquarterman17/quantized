// A window's share of a docked slot that it newly opens into (UX pass 3, M4). A
// newcomer normally takes 1/n of the slot, which left a docked Analysis window
// (guide + tool list, the tallest content) about 255 px high beside Style and Data.
// Pure: `(layout, ref, share) -> layout`; a no-op returns the same object.

import { stackOf } from "./ops";
import type { WindowLayoutV1, WindowRef } from "./types";

/** The Analysis window's share of a shared slot when it opens into one. */
export const ANALYSIS_SHARE = 0.65;
/** What it keeps when another window then opens beside it. */
export const ANALYSIS_MIN_SHARE = 0.5;

/** Give `ref` the share `share` of its docked slot and scale the other windows in the slot to
 *  fill the rest in proportion (orders are untouched; shares keep summing to 1). */
export function giveShare(layout: WindowLayoutV1, ref: WindowRef, share: number): WindowLayoutV1 {
  const p = layout.placements[ref];
  if (!p?.open || p.slot === null || !(share > 0 && share < 1)) return layout;
  const stack = stackOf(layout, p.slot);
  const others = stack.filter((r) => r !== ref);
  if (!others.length) return layout;
  const rest = others.reduce((sum, r) => sum + layout.placements[r]!.share, 0);
  if (Math.abs(p.share - share) < 1e-9) return layout;
  const placements: WindowLayoutV1["placements"] = { ...layout.placements, [ref]: { ...p, share } };
  for (const r of others) {
    const q = layout.placements[r]!;
    placements[r] = { ...q, share: rest > 0 ? ((1 - share) * q.share) / rest : (1 - share) / others.length };
  }
  return { ...layout, placements };
}
