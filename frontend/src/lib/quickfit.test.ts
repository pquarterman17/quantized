import { describe, expect, it } from "vitest";

import {
  firstVisiblePlottedChannel,
  formatQfitParams,
  GADGET_MODE_LABELS,
  GADGET_MODES,
  selectRoiRows,
} from "./quickfit";
import type { Dataset, DataStruct } from "./types";

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [
    [10, 100],
    [20, 200],
    [30, 300],
    [40, 400],
    [50, 500],
    [60, 600],
  ],
  labels: ["A", "B"],
  units: ["emu", "Oe"],
  metadata: {},
};

const mk = (over: Partial<Dataset> = {}): Dataset => ({ id: "d", name: "d", data: DATA, ...over });

describe("selectRoiRows", () => {
  it("selects rows whose x falls in [lo,hi], endpoints in either order", () => {
    expect(selectRoiRows(mk(), [1, 3], 0)).toEqual({
      x: [1, 2, 3],
      y: [20, 30, 40],
      rows: [1, 2, 3],
    });
    // reversed endpoints — same result
    expect(selectRoiRows(mk(), [3, 1], 0)).toEqual({
      x: [1, 2, 3],
      y: [20, 30, 40],
      rows: [1, 2, 3],
    });
  });

  it("reads the requested channel, not always channel 0", () => {
    const sel = selectRoiRows(mk(), [0, 1], 1);
    expect(sel).toEqual({ x: [0, 1], y: [100, 200], rows: [0, 1] });
  });

  it("returns empty for a null dataset, roi, or channel", () => {
    expect(selectRoiRows(null, [0, 1], 0)).toEqual({ x: [], y: [], rows: [] });
    expect(selectRoiRows(mk(), null, 0)).toEqual({ x: [], y: [], rows: [] });
    expect(selectRoiRows(mk(), [0, 1], null)).toEqual({ x: [], y: [], rows: [] });
  });

  it("excludes manually-excluded rows (#50) from the selection", () => {
    // row 2 (x=2) excluded — the ROI [0,3] would otherwise include it
    const sel = selectRoiRows(mk({ excludedRows: [2] }), [0, 3], 0);
    expect(sel.rows).toEqual([0, 1, 3]);
    expect(sel.x).toEqual([0, 1, 3]);
  });

  it("excludes filter-failed rows (#53) from the selection", () => {
    // keep channel-0 value >= 30 -> rows 0,1 fail the filter regardless of ROI
    const sel = selectRoiRows(mk({ filter: [{ col: 0, kind: "range", min: 30 }] }), [0, 5], 0);
    expect(sel.rows).toEqual([2, 3, 4, 5]);
  });

  it("skips non-finite x or y within the range", () => {
    const gapped: DataStruct = {
      ...DATA,
      time: [0, 1, 2],
      values: [[10, 0], [Number.NaN, 0], [30, 0]],
    };
    const sel = selectRoiRows(mk({ data: gapped }), [0, 2], 0);
    expect(sel).toEqual({ x: [0, 2], y: [10, 30], rows: [0, 2] });
  });

  it("returns empty when nothing falls in range", () => {
    expect(selectRoiRows(mk(), [100, 200], 0)).toEqual({ x: [], y: [], rows: [] });
  });
});

describe("firstVisiblePlottedChannel", () => {
  it("picks the first channel not reported hidden", () => {
    expect(firstVisiblePlottedChannel([2, 0, 1], () => false)).toBe(2);
  });

  it("skips hidden channels in plotted order", () => {
    expect(firstVisiblePlottedChannel([0, 1, 2], (c) => c === 0)).toBe(1);
  });

  it("falls back to the first plotted channel when all are hidden", () => {
    expect(firstVisiblePlottedChannel([3, 4], () => true)).toBe(3);
  });

  it("returns null when nothing is plotted", () => {
    expect(firstVisiblePlottedChannel([], () => false)).toBeNull();
  });
});

describe("formatQfitParams", () => {
  it("formats params with ± errors when present", () => {
    expect(formatQfitParams({ params: [1.2345, -0.5], errors: [0.01, 0.2] })).toBe(
      "p0=1.2345±0.01  p1=-0.5±0.2",
    );
  });

  it("omits ± when the error is missing or non-finite", () => {
    expect(formatQfitParams({ params: [2], errors: [null] })).toBe("p0=2");
    expect(formatQfitParams({ params: [2] })).toBe("p0=2");
  });

  it("returns empty string for a null result or no params", () => {
    expect(formatQfitParams(null)).toBe("");
    expect(formatQfitParams({})).toBe("");
  });
});

describe("GADGET_MODES / GADGET_MODE_LABELS (gap #34)", () => {
  it("labels every mode, in the picker's presentation order", () => {
    expect(GADGET_MODES).toEqual(["fit", "integrate", "stats", "differentiate", "fft", "cursors"]);
    for (const m of GADGET_MODES) expect(GADGET_MODE_LABELS[m]).toBeTruthy();
  });
});
