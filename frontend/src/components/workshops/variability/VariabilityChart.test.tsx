// Review finding 1: `VariabilityChart` used to key `deterministicJitter` on
// a point's POSITION within its cell's `values` array, so excluding a row
// from that same cell (any row, not just the last) reshuffled every point
// after it. Fixed by keying on `VariabilityCell.rowIds[i]` — the ORIGINAL
// dataset row — instead.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { VariabilityFactorLevel } from "../../../lib/variability";
import VariabilityChart from "./VariabilityChart";
import type { VariabilitySummaryResponse } from "./useVariability";

const SUMMARY: VariabilitySummaryResponse = {
  cells: [],
  a_groups: [],
  grand_mean: 0,
  grand_n: 0,
  a_levels: 1,
  balanced: true,
};

function levelsWith(values: number[], rowIds: number[]): VariabilityFactorLevel[] {
  return [{ aIndex: 0, aLabel: "A0", cells: [{ bIndex: 0, bLabel: "B0", values, rowIds }] }];
}

function cxOf(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("circle")].map((c) => c.getAttribute("cx"));
}

describe("VariabilityChart — jitter keyed by ORIGINAL row (review finding 1)", () => {
  it("excluding a row from the SAME cell leaves every OTHER point's screen x position unchanged", () => {
    const full = render(<VariabilityChart levels={levelsWith([10, 20, 30], [5, 6, 7])} summary={SUMMARY} />);
    const cxBefore = cxOf(full.container);
    full.unmount();

    // Row 6 (value 20, the MIDDLE point) is excluded. Rows 5 and 7 keep
    // their own row ids — row 7 shifts from position 2 to position 1 in
    // `values`, which is exactly where the pre-fix, position-keyed jitter
    // would have reshuffled it.
    const dropped = render(<VariabilityChart levels={levelsWith([10, 30], [5, 7])} summary={SUMMARY} />);
    const cxAfter = cxOf(dropped.container);
    dropped.unmount();

    expect(cxAfter).toHaveLength(2);
    expect(cxBefore).toHaveLength(3);
    expect(cxAfter[0]).toBe(cxBefore[0]); // row 5: position 0 both times
    expect(cxAfter[1]).toBe(cxBefore[2]); // row 7: position 2 -> position 1, jitter unchanged
  });

  it("excluding a row in ANOTHER cell leaves this cell's points' x positions unchanged", () => {
    const levels: VariabilityFactorLevel[] = [
      {
        aIndex: 0, aLabel: "A0",
        cells: [
          { bIndex: 0, bLabel: "B0", values: [1, 2, 3], rowIds: [0, 1, 2] },
          { bIndex: 1, bLabel: "B1", values: [4, 5, 6], rowIds: [3, 4, 5] },
        ],
      },
    ];
    const before = render(<VariabilityChart levels={levels} summary={SUMMARY} />);
    const cxBefore = cxOf(before.container);
    before.unmount();

    // Row 4 excluded from the SECOND cell — the first cell's own values/
    // rowIds are untouched, and so must its points' x positions be.
    const levelsAfter: VariabilityFactorLevel[] = [
      {
        aIndex: 0, aLabel: "A0",
        cells: [
          { bIndex: 0, bLabel: "B0", values: [1, 2, 3], rowIds: [0, 1, 2] },
          { bIndex: 1, bLabel: "B1", values: [4, 6], rowIds: [3, 5] },
        ],
      },
    ];
    const after = render(<VariabilityChart levels={levelsAfter} summary={SUMMARY} />);
    const cxAfter = cxOf(after.container);
    after.unmount();

    expect(cxAfter.slice(0, 3)).toEqual(cxBefore.slice(0, 3)); // cell B0's three points, unchanged
  });
});
