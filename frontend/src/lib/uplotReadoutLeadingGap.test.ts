// The data-cursor readout on an x that starts with blank cells: uPlot's binary-search cursor
// cannot be trusted there (a null reads as 0), so the readout takes the nearest row WITH an x
// and reports its SOURCE index.
import { describe, expect, it, vi } from "vitest";

import { readoutPlugin } from "./uplotPointerTools";
import type { Readout } from "./uplotTools";

function hover(x: (number | null)[], y: number[], at: number, idx: number | null): Readout | null {
  const onReadout = vi.fn();
  const u = {
    data: [x, y], cursor: { idx, left: 10 }, series: [{}, { label: "Y", show: true }],
    posToVal: () => at,
  };
  (readoutPlugin(onReadout).hooks.setCursor as unknown as (u: unknown) => void)(u);
  return onReadout.mock.calls[0]?.[0] ?? null;
}

describe("readout with a leading blank x", () => {
  const x = [null, null, -2, -1, 0, 1, 2];
  const y = [900, 900, 1, 2, 3, 4, 5];
  it("reports the nearest finite-x row's source index, not uPlot's", () => {
    const r = hover(x, y, 0.9, 0); // uPlot's cursor landed on a blank row
    expect(r?.idx).toBe(5);
    expect(r?.x).toBe(1);
    expect(r?.rows[0]?.y).toBe(4);
  });
  it("is unchanged for an x with no leading blank", () => {
    const r = hover([1, 2, 3], [4, 5, 6], 99, 1);
    expect(r?.idx).toBe(1);
  });
});
