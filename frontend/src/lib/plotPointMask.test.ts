// Gap audit 3 N2: a 2-D box drag of the Select Rows tool takes only the rows
// with a point inside it (masked points too, so a box can unmask; Y2 curves on
// their own scale), and a right-click finds the single point under it. On a
// reduced (decimated / windowed) payload every hit is traced to its dataset
// row through the payload's row map, or refused -- never taken by position.

import type uPlot from "uplot";
import { describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "./plotdata";
import { filterReason, isDataSeries, nearestPointRow, pickRows, rowsInBox, traceRow } from "./plotPointMask";
import type { Dataset } from "./types";
import { MIN_BOX_HEIGHT_PX, selectBoxPick } from "./uplotRegionBox";

const xs = [0, 1, 2, 3, 4];
const y1 = [0, 10, 20, 30, 40];
const y2 = [5, 5, 5, 5, 5];

describe("rowsInBox", () => {
  it("takes rows whose x is in the band AND some curve's y is in the box", () => {
    const series = [{ label: "a", unit: "" }, { label: "b", unit: "" }];
    expect(rowsInBox([xs, y1, y2], series, 2, { x0: 0.5, x1: 3.5, y: [15, 35] })).toEqual([2, 3]);
    // The flat curve at 5 is inside a low box at every x in the band.
    expect(rowsInBox([xs, y1, y2], series, 2, { x0: 3.5, x1: 0.5, y: [0, 6] })).toEqual([1, 2, 3]);
  });

  it("counts a masked point's muted companion, never an overlay", () => {
    const series = [{ label: "a", unit: "" }, { label: "a (excluded)", unit: "", kind: "points" as const, muted: true }, { label: "fit", unit: "" }];
    const ghost = [null, null, 22, null, null];
    const fit = [21, 21, 21, 21, 21];
    expect(rowsInBox([xs, [0, 10, null, 30, 40], ghost, fit], series, 1, { x0: 0, x1: 4, y: [15, 25] })).toEqual([2]);
    expect(isDataSeries(series, 1, 2)).toBe(false);
  });

  it("tests a Y2 curve against the box's edges on the Y2 scale (review #7)", () => {
    const series = [{ label: "a", unit: "" }, { label: "b", unit: "", axis: 1 }];
    const onRight = [500, 600, 700, 800, 900];
    // Box: primary 100..200 (no primary point), secondary 650..850 (rows 2, 3).
    expect(rowsInBox([xs, y1, onRight], series, 2, { x0: 0, x1: 4, y: [100, 200], y2: [650, 850] })).toEqual([2, 3]);
    expect(rowsInBox([xs, y1, onRight], series, 2, { x0: 0, x1: 4, y: [100, 200] })).toEqual([]);
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

describe("a reduced (decimated) payload is traced to dataset rows (review #1)", () => {
  // 50k-row sweep with one outlier at row 30,000; the server sent a 1-in-50
  // subset plus the outlier -- the outlier is drawn row ~600, NOT row 30,000.
  const N = 50_000;
  const OUT = 30_000;
  const y = Array.from({ length: N }, (_, r) => (r === OUT ? 99 : Math.sin(r / 500)));
  const ds: Dataset = { id: "d", name: "sweep", data: { time: Array.from({ length: N }, (_, r) => r), values: y.map((v) => [v]), labels: ["M"], units: [""], metadata: {} } };
  const ids = Array.from({ length: N }, (_, r) => r).filter((r) => r % 50 === 0 || r === OUT);
  const decimated: PlotPayload = {
    data: [ids.map((r) => r), ids.map((r) => y[r])] as uPlot.AlignedData,
    series: [{ label: "M", unit: "" }],
    xLabel: "t", xUnit: "", decimated: true, rowIds: ids,
  };
  const drawnOutlier = ids.indexOf(OUT);

  it("the right-clicked outlier is dataset row 30,000, not its drawn position", () => {
    expect(drawnOutlier).toBeLessThan(1000);
    expect(traceRow(decimated, drawnOutlier, [0], ds, null)).toEqual({ row: OUT });
  });

  it("a box around the outlier selects exactly its row; an x band takes every dataset row in it", () => {
    expect(pickRows(decimated, [0], ds, null, { x0: OUT - 30, x1: OUT + 30, y: [50, 150] })).toEqual({ rows: [OUT] });
    expect(pickRows(decimated, [0], ds, null, { x0: 100, x1: 104 })).toEqual({ rows: [100, 101, 102, 103, 104] });
  });

  it("refuses when the payload has no row map, or the map does not match the data", () => {
    const noMap = { ...decimated, rowIds: undefined };
    expect(traceRow(noMap, drawnOutlier, [0], ds, null)).toHaveProperty("refused");
    expect(pickRows(noMap, [0], ds, null, { x0: 0, x1: 10 })).toHaveProperty("refused");
    const shifted = { ...decimated, rowIds: ids.map((r) => r + 1) };
    expect(traceRow(shifted, drawnOutlier, [0], ds, null)).toHaveProperty("refused");
  });

  it("a windowed payload is reduced too", () => {
    const windowed = { ...decimated, decimated: false, window: [0, N] as [number, number] };
    expect(traceRow(windowed, drawnOutlier, [0], ds, null)).toEqual({ row: OUT });
    expect(traceRow({ ...windowed, rowIds: undefined }, drawnOutlier, [0], ds, null)).toHaveProperty("refused");
  });
});

describe("filterReason (review #9)", () => {
  it("names the filter that hides a row", () => {
    const ds: Dataset = {
      id: "d", name: "run 3",
      data: { time: [0, 1, 2], values: [[1], [5], [9]], labels: ["T"], units: ["K"], metadata: {} },
      filter: [{ col: 0, kind: "range", min: 2, max: 10 }],
    };
    expect(filterReason(ds, 0)).toBe("the “T” filter of “run 3”");
    expect(filterReason(ds, 1)).toBeNull();
  });
});

describe("selectBoxPick", () => {
  const payload = { data: [xs, y1], series: [{ label: "a", unit: "" }] } as unknown as PlotPayload;
  const fakeU = (height: number) =>
    ({
      select: { left: 10, width: 30, top: 20, height },
      over: { clientHeight: 200 },
      posToVal: (px: number, scale: string) => (scale === "x" ? px / 10 : scale === "y2" ? 1000 - px : 100 - px),
      setSelect: vi.fn(),
    }) as unknown as uPlot;

  it("a deliberate box reports its y edges on the primary axis", () => {
    const pick = vi.fn();
    selectBoxPick(fakeU(40), payload, false, pick);
    expect(pick).toHaveBeenCalledWith(1, 4, [80, 40], undefined);
  });

  it("on a dual-Y plot it reports the edges on BOTH axes", () => {
    const pick = vi.fn();
    selectBoxPick(fakeU(40), payload, true, pick);
    expect(pick).toHaveBeenCalledWith(1, 4, [80, 40], [980, 940]);
  });

  it("a flat drag stays an x-band, repainted full height", () => {
    const pick = vi.fn();
    const u = fakeU(MIN_BOX_HEIGHT_PX - 1);
    selectBoxPick(u, payload, false, pick);
    expect(pick).toHaveBeenCalledWith(1, 4);
    expect(u.setSelect).toHaveBeenCalledWith({ left: 10, top: 0, width: 30, height: 200 }, false);
  });
});
