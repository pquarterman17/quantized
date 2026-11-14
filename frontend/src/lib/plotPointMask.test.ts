// Gap audit 3 N2: a 2-D box drag of the Select Rows tool takes only the rows
// with a point inside the box (masked points too, so a box can unmask), and a
// right-click finds the single point under it.

import type uPlot from "uplot";
import { describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "./plotdata";
import { isDataSeries, nearestPointRow, rowsInBox } from "./plotPointMask";
import { MIN_BOX_HEIGHT_PX, selectBoxPick } from "./uplotRegionBox";

const xs = [0, 1, 2, 3, 4];
const y1 = [0, 10, 20, 30, 40];
const y2 = [5, 5, 5, 5, 5];

describe("rowsInBox", () => {
  it("takes rows whose x is in the band AND some curve's y is in the box", () => {
    const series = [{ label: "a", unit: "" }, { label: "b", unit: "" }];
    expect(rowsInBox([xs, y1, y2], series, 2, { x0: 0.5, x1: 3.5, y0: 15, y1: 35, onY2: false })).toEqual([2, 3]);
    // The flat curve at 5 is inside a low box at every x in the band.
    expect(rowsInBox([xs, y1, y2], series, 2, { x0: 3.5, x1: 0.5, y0: 0, y1: 6, onY2: false })).toEqual([1, 2, 3]);
  });

  it("counts a masked point's muted companion, never an overlay, and only the box's axis", () => {
    const series = [{ label: "a", unit: "" }, { label: "a (excluded)", unit: "", kind: "points" as const, muted: true }, { label: "fit", unit: "" }];
    const ghost = [null, null, 22, null, null];
    const fit = [21, 21, 21, 21, 21];
    expect(rowsInBox([xs, [0, 10, null, 30, 40], ghost, fit], series, 1, { x0: 0, x1: 4, y0: 15, y1: 25, onY2: false })).toEqual([2]);
    expect(isDataSeries(series, 1, 2)).toBe(false);
    const onRight = [{ label: "a", unit: "", axis: 1 }];
    expect(rowsInBox([xs, y1], onRight, 1, { x0: 0, x1: 4, y0: 15, y1: 25, onY2: false })).toEqual([]);
    expect(rowsInBox([xs, y1], onRight, 1, { x0: 0, x1: 4, y0: 15, y1: 25, onY2: true })).toEqual([2]);
  });
});

describe("nearestPointRow", () => {
  it("returns the nearest drawn point within the radius, else null", () => {
    const pos = (s: number, r: number): [number, number] | null => (s === 0 ? [r * 10, 100 - y1[r]] : null);
    expect(nearestPointRow(2, 5, () => true, pos, 21, 79, 5)).toEqual({ series: 0, row: 2 });
    expect(nearestPointRow(2, 5, () => true, pos, 25, 50, 5)).toBeNull();
    expect(nearestPointRow(2, 5, (s) => s !== 0, pos, 21, 79, 5)).toBeNull();
  });
});

describe("selectBoxPick", () => {
  const payload = { data: [xs, y1], series: [{ label: "a", unit: "" }] } as unknown as PlotPayload;
  const fakeU = (height: number) =>
    ({
      select: { left: 10, width: 30, top: 20, height },
      over: { clientHeight: 200 },
      posToVal: (px: number, scale: string) => (scale === "x" ? px / 10 : 100 - px),
      setSelect: vi.fn(),
    }) as unknown as uPlot;

  it("a deliberate box reports its y edges", () => {
    const pick = vi.fn();
    selectBoxPick(fakeU(40), payload, false, pick);
    expect(pick).toHaveBeenCalledWith(1, 4, 80, 40, false);
  });

  it("a flat drag stays an x-band, repainted full height", () => {
    const pick = vi.fn();
    const u = fakeU(MIN_BOX_HEIGHT_PX - 1);
    selectBoxPick(u, payload, false, pick);
    expect(pick).toHaveBeenCalledWith(1, 4);
    expect(u.setSelect).toHaveBeenCalledWith({ left: 10, top: 0, width: 30, height: 200 }, false);
  });
});
