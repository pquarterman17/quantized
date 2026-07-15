import { describe, expect, it } from "vitest";

import {
  columnWidths,
  cumulativeOffsets,
  type PanelPos,
  rowBoundaryGaps,
  rowHeights,
  spatialPixelRects,
  sharesXWithPanelBelow,
  suppressedXIndices,
} from "./panelLayout";

describe("sharesXWithPanelBelow", () => {
  const panels: PanelPos[] = [
    { row: 0, col: 0, xLim: [0, 1.5] },
    { row: 1, col: 0, xLim: [0, 1.5] }, // same x as row 0 -> flush with it
    { row: 0, col: 1, xLim: [0, 100] }, // different column, unrelated
  ];

  it("is true when the panel directly below (same column) shares its x-range", () => {
    expect(sharesXWithPanelBelow(panels[0], panels)).toBe(true);
  });

  it("is false for the bottom-most panel in a column (nothing below it)", () => {
    expect(sharesXWithPanelBelow(panels[1], panels)).toBe(false);
  });

  it("is false when nothing sits below in the SAME column, even if another column does", () => {
    expect(sharesXWithPanelBelow(panels[2], panels)).toBe(false);
  });

  it("is false when the x-ranges disagree beyond tolerance", () => {
    const p: PanelPos[] = [
      { row: 0, col: 0, xLim: [0, 1.5] },
      { row: 1, col: 0, xLim: [0, 100] }, // wildly different range
    ];
    expect(sharesXWithPanelBelow(p[0], p)).toBe(false);
  });

  it("tolerates small float slop within the default tolerance", () => {
    const p: PanelPos[] = [
      { row: 0, col: 0, xLim: [0.0080000001, 0.075] },
      { row: 1, col: 0, xLim: [0.008, 0.0750000002] },
    ];
    expect(sharesXWithPanelBelow(p[0], p)).toBe(true);
  });

  it("does not match a range that differs just outside the tolerance", () => {
    const p: PanelPos[] = [
      { row: 0, col: 0, xLim: [0, 100] },
      { row: 1, col: 0, xLim: [0, 100.5] }, // 0.5% off a 100-wide span
    ];
    expect(sharesXWithPanelBelow(p[0], p, 1e-3)).toBe(false);
  });
});

describe("rowBoundaryGaps", () => {
  it("is flush (0) at a boundary where every column agrees, normal gap elsewhere", () => {
    // 2 cols x 3 rows: rows 0/1 share x in BOTH columns (flush); rows 1/2 differ.
    const panels: PanelPos[] = [
      { row: 0, col: 0, xLim: [0, 1] },
      { row: 0, col: 1, xLim: [0, 1] },
      { row: 1, col: 0, xLim: [0, 1] },
      { row: 1, col: 1, xLim: [0, 1] },
      { row: 2, col: 0, xLim: [0, 5] },
      { row: 2, col: 1, xLim: [0, 5] },
    ];
    expect(rowBoundaryGaps(panels, 3, 8)).toEqual([0, 8]);
  });

  it("keeps the normal gap when even ONE column disagrees (conservative)", () => {
    const panels: PanelPos[] = [
      { row: 0, col: 0, xLim: [0, 1] },
      { row: 0, col: 1, xLim: [0, 1] },
      { row: 1, col: 0, xLim: [0, 1] }, // shares with (0,0)
      { row: 1, col: 1, xLim: [0, 99] }, // does NOT share with (0,1)
    ];
    expect(rowBoundaryGaps(panels, 2, 8)).toEqual([8]);
  });

  it("a column absent from one side of the boundary doesn't block flushing the columns that DO match (ragged grid)", () => {
    const panels: PanelPos[] = [
      { row: 0, col: 0, xLim: [0, 1] },
      { row: 0, col: 1, xLim: [0, 1] },
      { row: 1, col: 0, xLim: [0, 1] }, // col 1 has nothing at row 1 (ragged grid)
    ];
    // Only col 0 exists on both sides, and it matches -> flush; col 1's
    // absence from row 1 simply doesn't constrain this boundary.
    expect(rowBoundaryGaps(panels, 2, 8)).toEqual([0]);
  });

  it("stays at the normal gap when no column at all has a same-column pair", () => {
    const panels: PanelPos[] = [
      { row: 0, col: 0, xLim: [0, 1] },
      { row: 1, col: 1, xLim: [0, 1] }, // different column -> no vertical pair anywhere
    ];
    expect(rowBoundaryGaps(panels, 2, 8)).toEqual([8]);
  });

  it("returns [] for a single row (no boundaries)", () => {
    const panels: PanelPos[] = [{ row: 0, col: 0, xLim: [0, 1] }];
    expect(rowBoundaryGaps(panels, 1, 8)).toEqual([]);
  });

  it("side-by-side columns with matching x never fuse ACROSS columns (rows only)", () => {
    // Single row, 2 columns sharing the same x-range: no row boundary exists
    // to fuse (the rule only ever looks at same-column vertical adjacency).
    const panels: PanelPos[] = [
      { row: 0, col: 0, xLim: [0, 1] },
      { row: 0, col: 1, xLim: [0, 1] },
    ];
    expect(rowBoundaryGaps(panels, 1, 8)).toEqual([]);
  });
});

describe("suppressedXIndices", () => {
  it("suppresses every panel except the bottom of a flush run", () => {
    // A single flush column of 3, matching the PNR.opj Graph11 shape.
    const panels: PanelPos[] = [
      { row: 0, col: 0, xLim: [0, 1.5] },
      { row: 1, col: 0, xLim: [0, 1.5] },
      { row: 2, col: 0, xLim: [0, 1.5] },
    ];
    expect(suppressedXIndices(panels)).toEqual(new Set([0, 1]));
  });

  it("suppresses nothing when no column shares an x-axis with its neighbor", () => {
    const panels: PanelPos[] = [
      { row: 0, col: 0, xLim: [0, 1] },
      { row: 1, col: 0, xLim: [0, 99] },
    ];
    expect(suppressedXIndices(panels)).toEqual(new Set());
  });

  it("handles independent side-by-side columns, each its own run", () => {
    // 2x2: col 0 rows 0/1 flush; col 1 rows 0/1 NOT flush.
    const panels: PanelPos[] = [
      { row: 0, col: 0, xLim: [0, 1] },
      { row: 1, col: 0, xLim: [0, 1] },
      { row: 0, col: 1, xLim: [0, 1] },
      { row: 1, col: 1, xLim: [0, 50] },
    ];
    expect(suppressedXIndices(panels)).toEqual(new Set([0])); // only col 0's top panel
  });
});

describe("columnWidths", () => {
  it("splits evenly minus the uniform gap", () => {
    expect(columnWidths(2, 400, 8)).toEqual([196, 196]);
  });

  it("handles the degenerate count", () => {
    expect(columnWidths(0, 400)).toEqual([]);
  });

  it("never goes below 1px", () => {
    expect(columnWidths(5, 10, 8)).toEqual(new Array(5).fill(1));
  });
});

describe("rowHeights", () => {
  it("gives every row the SAME height even when boundary gaps are uneven", () => {
    // 3 rows, 400px total, gaps [0, 8] (flush then normal) -> (400-8)/3 = 130.67 -> 130 each.
    expect(rowHeights(3, 400, [0, 8])).toEqual([130, 130, 130]);
  });

  it("consumes less total gap (taller rows) when a boundary is flush vs. all-normal", () => {
    const flushCase = rowHeights(2, 300, [0]);
    const normalCase = rowHeights(2, 300, [8]);
    expect(flushCase[0]).toBeGreaterThan(normalCase[0]);
  });

  it("handles the degenerate count", () => {
    expect(rowHeights(0, 400, [])).toEqual([]);
  });

  it("never goes below 1px", () => {
    expect(rowHeights(5, 10, [8, 8, 8, 8])).toEqual(new Array(5).fill(1));
  });
});

describe("spatialPixelRects", () => {
  it("scales unequal, offset, and spanning normalized frames into the stage", () => {
    const panels = [
      { frameRect: { left: 0, top: 0, width: 0.3, height: 0.25 } },
      { frameRect: { left: 0.4, top: 0, width: 0.6, height: 0.25 } },
      { frameRect: { left: 0, top: 0.35, width: 1, height: 0.65 } },
    ];
    expect(spatialPixelRects(panels, 1000, 800)).toEqual([
      { left: 0, top: 0, width: 300, height: 200 },
      { left: 400, top: 0, width: 600, height: 200 },
      { left: 0, top: 280, width: 1000, height: 520 },
    ]);
  });

  it("fails closed when any panel rectangle is absent or invalid", () => {
    expect(spatialPixelRects([{ frameRect: undefined }], 100, 100)).toBeNull();
    expect(spatialPixelRects([
      { frameRect: { left: 0, top: 0, width: 1.1, height: 1 } },
    ], 100, 100)).toBeNull();
    expect(spatialPixelRects([], 100, 100)).toBeNull();
  });
});

describe("cumulativeOffsets", () => {
  it("accumulates sizes + a uniform gap number (column placement)", () => {
    expect(cumulativeOffsets([100, 100, 100], 8)).toEqual([0, 108, 216]);
  });

  it("accumulates sizes + a per-boundary gap array (row placement, item B)", () => {
    // Row 0 at 0; row 1 at 130 (flush, +0 gap); row 2 at 260 (+8 gap after row 1).
    expect(cumulativeOffsets([130, 130, 130], [0, 8])).toEqual([0, 130, 268]);
  });

  it("treats a missing gap array entry as 0", () => {
    expect(cumulativeOffsets([50, 50], [])).toEqual([0, 50]);
  });

  it("returns [] for an empty size list", () => {
    expect(cumulativeOffsets([], 8)).toEqual([]);
  });
});
