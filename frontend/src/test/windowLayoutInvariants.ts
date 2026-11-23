// Shared test helper: the window-layout model's invariants (lib/windowLayout/ops.ts header).
import { expect } from "vitest";

import { placementEntries, stackOf } from "../lib/windowLayout/ops";
import { SLOTS, type WindowLayoutV1 } from "../lib/windowLayout/types";

/** The invariants in ops.ts's header. */
export function checkInvariants(l: WindowLayoutV1): void {
  for (const slot of SLOTS) {
    const stack = stackOf(l, slot);
    stack.forEach((r, i) => {
      expect(l.placements[r]!.order, `${r} order`).toBe(i);
      expect(l.placements[r]!.lastSlot, `${r} lastSlot`).toBe(slot);
    });
    if (stack.length) expect(stack.reduce((a, r) => a + l.placements[r]!.share, 0)).toBeCloseTo(1, 12);
  }
  const floating = placementEntries(l).filter(([, p]) => p.open && p.slot === null).map(([r]) => r);
  expect([...l.z].sort()).toEqual([...floating].sort());
  expect(new Set(l.z).size).toBe(l.z.length);
}
