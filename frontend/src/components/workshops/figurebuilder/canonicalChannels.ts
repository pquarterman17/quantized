// Channel-membership helpers for the canonical Publication Preview draft
// (F2.3g): which column is X, and which are plotted Y / Y2 / not at all.
// Same "pure list helpers, no React/store import" shape as canonicalErrors.ts.
//
// Vocabulary and guardrails deliberately match Inspector/ChannelsCard.tsx --
// the Stage-side editor of the same PlotView fields (xKey/yKeys/y2Keys):
//  - unchecking a channel is a no-op if it would leave nothing plotted
//    besides X (ChannelsCard's `toggle` guard)
//  - a channel can only ride Y2 once it is already plotted on Y, and doing
//    so is a no-op if it would leave no OTHER channel on the primary axis
//    (ChannelsCard's `toggleAxis` guard)
//  - dropping a channel from Y also drops it from Y2 (a hidden channel can't
//    ride the secondary axis)
// ChannelsCard's channel ROLE (data/label/ignore), modeling-type Select, and
// inline "± error" picker are DATASET-scoped fields (Dataset.channelRoles /
// the live errKeys singleton), not FigureDocument.bindings -- out of scope
// here. Error bindings already have their own canonical panel (F2.3f).

export interface ChannelMembership {
  xKey: number | null;
  yKeys: number[] | null;
  y2Keys: number[] | null;
}

/** The resolved Y (plotted) set: `yKeys`, or `fallback` (the caller's
 *  dense-channel default) when null -- the same "auto" sentinel
 *  ChannelsCard's `selected` resolves. */
export function resolvedYKeys(yKeys: number[] | null, fallback: readonly number[]): number[] {
  return yKeys ? [...yKeys] : [...fallback];
}

/** Toggle channel `i`'s Y (plotted) membership. Returns `membership`
 *  UNCHANGED (by reference) when unchecking would leave nothing plotted
 *  besides X -- the caller compares with `===` to skip a no-op history
 *  entry, the same way ChannelsCard's `toggle` returns early instead of
 *  calling `setYKeys`. Removing a channel also drops it from Y2. */
export function toggleChannelPlotted(
  membership: ChannelMembership,
  i: number,
  fallback: readonly number[],
): ChannelMembership {
  const selected = resolvedYKeys(membership.yKeys, fallback);
  const next = selected.includes(i)
    ? selected.filter((c) => c !== i)
    : [...selected, i].sort((a, b) => a - b);
  if (next.filter((c) => c !== membership.xKey).length === 0) return membership;
  const y2 = membership.y2Keys ?? [];
  const y2Keys = !next.includes(i) && y2.includes(i)
    ? (() => {
        const dropped = y2.filter((c) => c !== i);
        return dropped.length ? dropped : null;
      })()
    : membership.y2Keys;
  return { ...membership, yKeys: next, y2Keys };
}

/** Toggle channel `i`'s Y2 (secondary-axis) membership. A no-op (unchanged
 *  reference) when `i` is not already plotted on Y, or when promoting it
 *  would leave no OTHER plotted channel on the primary axis. */
export function toggleChannelSecondary(
  membership: ChannelMembership,
  i: number,
  fallback: readonly number[],
): ChannelMembership {
  const y2 = membership.y2Keys ?? [];
  if (y2.includes(i)) {
    const next = y2.filter((c) => c !== i);
    return { ...membership, y2Keys: next.length ? next : null };
  }
  const selected = resolvedYKeys(membership.yKeys, fallback);
  if (!selected.includes(i)) return membership;
  const primaries = selected.filter((c) => !y2.includes(c));
  if (primaries.length <= 1) return membership;
  return { ...membership, y2Keys: [...y2, i].sort((a, b) => a - b) };
}
