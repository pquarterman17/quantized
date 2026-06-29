import { describe, expect, it } from "vitest";

import { readoutPlugin, type Readout } from "./uplotTools";

/** Drive the readout plugin's setCursor hook with a stubbed uPlot. */
function readoutAt(
  idx: number | null,
  data: (number | null)[][],
  series: { label?: string; show?: boolean }[],
): Readout | null {
  let captured: Readout | null = null;
  const plugin = readoutPlugin((r) => {
    captured = r;
  });
  const u = { cursor: { idx }, data, series };
  // @ts-expect-error — minimal stub stands in for a real uPlot instance
  plugin.hooks.setCursor?.(u);
  return captured;
}

describe("readoutPlugin", () => {
  const data = [
    [10, 20, 30], // x
    [1, 2, 3], // series 1
    [4, 5, 6], // series 2
  ];
  const series = [{}, { label: "M" }, { label: "dM" }];

  it("reports every visible series' value at the cursor index", () => {
    const r = readoutAt(1, data, series);
    expect(r).toEqual({
      x: 20,
      rows: [
        { label: "M", y: 2 },
        { label: "dM", y: 5 },
      ],
    });
  });

  it("returns null when the cursor is off-data", () => {
    expect(readoutAt(null, data, series)).toBeNull();
  });

  it("skips hidden series (show:false) and null gaps", () => {
    const gapped = [
      [10, 20, 30],
      [1, null, 3],
      [4, 5, 6],
    ];
    const r = readoutAt(1, gapped, [{}, { label: "M" }, { label: "dM", show: false }]);
    // series 1 is null at idx 1, series 2 is hidden → no rows → null
    expect(r).toBeNull();
  });

  it("labels an unlabeled series as empty (chip falls back to 'y')", () => {
    const r = readoutAt(0, [[5], [9]], [{}, {}]);
    expect(r).toEqual({ x: 5, rows: [{ label: "", y: 9 }] });
  });
});
