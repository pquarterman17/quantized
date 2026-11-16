// Who armed the plot's region rubber-band (the "region" tool -> the store's
// `regionPicked`). Two panels arm it -- the Baseline workshop's "Fit from
// region" box and Curve Fit's "Fit range: drag on plot" (UX8-D) -- and both
// listen for the pick; without an owner, one drag landed in both. The panel
// that arms it tags it here, and a panel consumes a pick only when the tag is
// its own. Module state, not store state: it is read at the moment a pick
// lands, never rendered.

export type RegionPickOwner = "baseline" | "curvefit";

let owner: RegionPickOwner | null = null;

/** Tag the region tool's next pick as `who`'s. */
export function armRegionPick(who: RegionPickOwner): void {
  owner = who;
}

/** Whose is the pending pick (null: armed by none of the panels). */
export function regionPickOwner(): RegionPickOwner | null {
  return owner;
}

/** The pick was consumed (`taken`) or the arm cancelled by `who`: clear its
 *  tag. A taken pick stays marked, so another panel's effect running in the
 *  same commit (it still sees the pick) does not take it too. */
export function releaseRegionPick(who: RegionPickOwner, taken?: object): void {
  if (owner === who) owner = null;
  if (taken) consumed.add(taken);
}

/** Was this pick already taken by the panel that armed it? */
export const regionPickTaken = (pick: object): boolean => consumed.has(pick);

const consumed = new WeakSet<object>();
