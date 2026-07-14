import { describe, expect, it } from "vitest";

import {
  computePanelLayout,
  framesCoincide,
  type FrameQuad,
  type PanelLayout,
} from "./originPanels";

const cells = (layout: PanelLayout) => layout.placements.map(({ rect: _rect, ...cell }) => cell);

describe("computePanelLayout", () => {
  it("returns nothing to place for an empty layer list", () => {
    expect(computePanelLayout([])).toEqual({ rows: 0, cols: 0, placements: [], spatial: false });
  });

  it("places a single layer in one cell (trivially spatial)", () => {
    const f: FrameQuad = { left: 0, top: 0, right: 100, bottom: 100 };
    expect(computePanelLayout([f])).toEqual({
      rows: 1,
      cols: 1,
      placements: [{
        index: 0, row: 0, col: 0, rect: { left: 0, top: 0, width: 1, height: 1 },
      }],
      spatial: true,
    });
  });

  it("2-stack: two vertically stacked frames -> 2 rows, 1 col, top-to-bottom order", () => {
    const top: FrameQuad = { left: 0, top: 0, right: 100, bottom: 45 };
    const bottom: FrameQuad = { left: 0, top: 55, right: 100, bottom: 100 };
    const layout = computePanelLayout([top, bottom]);
    expect(layout.spatial).toBe(true);
    expect(layout.rows).toBe(2);
    expect(layout.cols).toBe(1);
    expect(cells(layout)).toEqual([
      { index: 0, row: 0, col: 0 },
      { index: 1, row: 1, col: 0 },
    ]);
  });

  it("2-stack: order-independent — the SECOND input frame being the top one still lands in row 0", () => {
    const bottom: FrameQuad = { left: 0, top: 55, right: 100, bottom: 100 };
    const top: FrameQuad = { left: 0, top: 0, right: 100, bottom: 45 };
    const layout = computePanelLayout([bottom, top]); // bottom panel listed first
    expect(cells(layout)).toEqual([
      { index: 0, row: 1, col: 0 }, // "bottom" (input 0) -> row 1
      { index: 1, row: 0, col: 0 }, // "top" (input 1) -> row 0
    ]);
  });

  it("horizontal 2-up: two side-by-side frames -> 1 row, 2 cols", () => {
    const left: FrameQuad = { left: 0, top: 0, right: 45, bottom: 100 };
    const right: FrameQuad = { left: 55, top: 0, right: 100, bottom: 100 };
    const layout = computePanelLayout([left, right]);
    expect(layout.rows).toBe(1);
    expect(layout.cols).toBe(2);
    expect(cells(layout)).toEqual([
      { index: 0, row: 0, col: 0 },
      { index: 1, row: 0, col: 1 },
    ]);
    expect(layout.placements.map((p) => p.rect)).toEqual([
      { left: 0, top: 0, width: 0.45, height: 1 },
      { left: 0.55, top: 0, width: 0.45, height: 1 },
    ]);
  });

  it("2x2 grid: four quadrant frames cluster into 2 rows, 2 cols", () => {
    const tl: FrameQuad = { left: 0, top: 0, right: 45, bottom: 45 };
    const tr: FrameQuad = { left: 55, top: 0, right: 100, bottom: 45 };
    const bl: FrameQuad = { left: 0, top: 55, right: 45, bottom: 100 };
    const br: FrameQuad = { left: 55, top: 55, right: 100, bottom: 100 };
    const layout = computePanelLayout([tl, tr, bl, br]);
    expect(layout.spatial).toBe(true);
    expect(layout.rows).toBe(2);
    expect(layout.cols).toBe(2);
    expect(cells(layout)).toEqual([
      { index: 0, row: 0, col: 0 },
      { index: 1, row: 0, col: 1 },
      { index: 2, row: 1, col: 0 },
      { index: 3, row: 1, col: 1 },
    ]);
  });

  it("tolerates real-world slop in frame edges within the same page", () => {
    // Same "2-stack" shape, but the decoded ints aren't perfectly clean.
    const top: FrameQuad = { left: 1, top: 2, right: 99, bottom: 44 };
    const bottom: FrameQuad = { left: 0, top: 53, right: 100, bottom: 98 };
    const layout = computePanelLayout([top, bottom]);
    expect(layout.spatial).toBe(true);
    expect(layout.rows).toBe(2);
    expect(layout.cols).toBe(1);
  });

  it("falls back to an ordinal stack when frames substantially overlap", () => {
    const outer: FrameQuad = { left: 0, top: 0, right: 100, bottom: 100 };
    const inner: FrameQuad = { left: 10, top: 10, right: 90, bottom: 90 }; // nested, not tiled
    const layout = computePanelLayout([outer, inner]);
    expect(layout.spatial).toBe(false);
    expect(layout.rows).toBe(2);
    expect(layout.cols).toBe(1);
    expect(layout.placements).toEqual([
      { index: 0, row: 0, col: 0 },
      { index: 1, row: 1, col: 0 },
    ]);
  });

  it("falls back when any layer's frame is missing (undecoded/composite layer)", () => {
    const f: FrameQuad = { left: 0, top: 0, right: 100, bottom: 45 };
    expect(computePanelLayout([f, null]).spatial).toBe(false);
    expect(computePanelLayout([f, undefined]).spatial).toBe(false);
    expect(computePanelLayout([null, null]).spatial).toBe(false);
  });

  it("falls back when a frame is degenerate (zero or negative width/height)", () => {
    const f: FrameQuad = { left: 0, top: 0, right: 100, bottom: 45 };
    const zero: FrameQuad = { left: 10, top: 10, right: 10, bottom: 50 }; // right == left
    expect(computePanelLayout([f, zero]).spatial).toBe(false);
  });

  it("accepts frames that plausibly fit the given page (2-stack, page supplied)", () => {
    const top: FrameQuad = { left: 0, top: 0, right: 995, bottom: 480 };
    const bottom: FrameQuad = { left: 0, top: 520, right: 995, bottom: 990 };
    const layout = computePanelLayout([top, bottom], { width: 1000, height: 1000 });
    expect(layout.rows).toBe(2);
    expect(layout.cols).toBe(1);
    expect(layout.spatial).toBe(true);
    expect(cells(layout)).toEqual([
      { index: 0, row: 0, col: 0 },
      { index: 1, row: 1, col: 0 },
    ]);
  });

  it("preserves unequal frame proportions, gaps, and a panel spanning both columns", () => {
    const tl: FrameQuad = { left: 0, top: 0, right: 30, bottom: 25 };
    const tr: FrameQuad = { left: 40, top: 0, right: 100, bottom: 25 };
    const bottom: FrameQuad = { left: 0, top: 35, right: 100, bottom: 100 };
    const layout = computePanelLayout([tl, tr, bottom]);
    expect(layout.spatial).toBe(true);
    expect(layout.placements.map((p) => p.rect)).toEqual([
      { left: 0, top: 0, width: 0.3, height: 0.25 },
      { left: 0.4, top: 0, width: 0.6, height: 0.25 },
      { left: 0, top: 0.35, width: 1, height: 0.65 },
    ]);
  });

  it("matches PNR Graph40's decoded two-up plus full-width y2-host layout", () => {
    // Exact real-corpus frames after layers 3/4's coincident y2 merge. This
    // shape exposed why row/col weights were insufficient: the bottom frame
    // spans both top-row columns. Visually checked against the Origin export.
    const layout = computePanelLayout([
      { left: 548, top: 287, right: 3260, bottom: 2129 },
      { left: 3450, top: 287, right: 6162, bottom: 2129 },
      { left: 548, top: 2559, right: 6162, bottom: 4401 },
    ]);
    expect(layout.spatial).toBe(true);
    expect(cells(layout)).toEqual([
      { index: 0, row: 0, col: 0 },
      { index: 1, row: 0, col: 1 },
      { index: 2, row: 1, col: 0 },
    ]);
    expect(layout.placements[0].rect?.width).toBeCloseTo(2712 / 5614);
    expect(layout.placements[1].rect?.left).toBeCloseTo(2902 / 5614);
    expect(layout.placements[2].rect?.top).toBeCloseTo(2272 / 4114);
    expect(layout.placements[2].rect?.width).toBe(1);
  });

  it("falls back when the frames overshoot the declared page bound (frame/page disagree)", () => {
    // The frames claim to extend well past a page that says it's only 100x100
    // wide/tall — the decode is inconsistent, so don't trust the geometry.
    const top: FrameQuad = { left: 0, top: 0, right: 100, bottom: 45 };
    const bottom: FrameQuad = { left: 0, top: 55, right: 100, bottom: 900 };
    const layout = computePanelLayout([top, bottom], { width: 100, height: 100 });
    expect(layout.spatial).toBe(false);
    expect(layout.rows).toBe(2);
    expect(layout.cols).toBe(1);
  });

  it("matches the real corpus: \"Fixed Lambdas SI\"!Graph6's decoded 2-stack frames", () => {
    // Exact frame quads read from the real corpus file via
    // figures_opju.extract_figures_opju (2026-07-07 spot check) — page units,
    // page size undecoded (None) for this file. Layer 1's bottom edge exactly
    // meets layer 2's top edge (a contiguous stack, no gap).
    const layer1: FrameQuad = { left: 1027, top: 478, right: 6435, bottom: 2272 };
    const layer2: FrameQuad = { left: 1027, top: 2272, right: 6435, bottom: 4066 };
    const layout = computePanelLayout([layer1, layer2]);
    expect(layout.spatial).toBe(true);
    expect(layout.rows).toBe(2);
    expect(layout.cols).toBe(1);
    expect(cells(layout)).toEqual([
      { index: 0, row: 0, col: 0 }, // layer 1 -> top panel
      { index: 1, row: 1, col: 0 }, // layer 2 -> bottom panel
    ]);
  });

  it("ignores a null/missing page and falls back to bbox-derived tolerance", () => {
    const top: FrameQuad = { left: 0, top: 0, right: 100, bottom: 45 };
    const bottom: FrameQuad = { left: 0, top: 55, right: 100, bottom: 100 };
    expect(computePanelLayout([top, bottom], null).spatial).toBe(true);
    expect(computePanelLayout([top, bottom], undefined).spatial).toBe(true);
  });
});

describe("framesCoincide", () => {
  it("is true for byte-identical frames (the PNR/S7/Book33 repro shape)", () => {
    // Exact frame quads read from PNR.opj's Graph24 layers 2/3 (2026-07-09):
    // a Nuclear-SLD host layer and its Magnetic-SLD y2 overlay share the
    // EXACT same page rectangle.
    const host: FrameQuad = { left: 867, top: 2701, right: 6686, bottom: 4256 };
    const y2: FrameQuad = { left: 867, top: 2701, right: 6686, bottom: 4256 };
    expect(framesCoincide(host, y2)).toBe(true);
  });

  it("is true for near-identical frames within rounding slop", () => {
    const a: FrameQuad = { left: 867, top: 2701, right: 6686, bottom: 4256 };
    const b: FrameQuad = { left: 870, top: 2699, right: 6680, bottom: 4250 };
    expect(framesCoincide(a, b)).toBe(true);
  });

  it("is false for a nested (contained-but-smaller) frame — an inset, not a same-panel overlay", () => {
    const outer: FrameQuad = { left: 0, top: 0, right: 100, bottom: 100 };
    const inner: FrameQuad = { left: 10, top: 10, right: 90, bottom: 90 };
    expect(framesCoincide(outer, inner)).toBe(false);
  });

  it("is false for two tiled (non-overlapping) panels", () => {
    const top: FrameQuad = { left: 0, top: 0, right: 100, bottom: 45 };
    const bottom: FrameQuad = { left: 0, top: 55, right: 100, bottom: 100 };
    expect(framesCoincide(top, bottom)).toBe(false);
  });

  it("is false for a partial (non-coincident) overlap", () => {
    const a: FrameQuad = { left: 0, top: 0, right: 60, bottom: 60 };
    const b: FrameQuad = { left: 40, top: 40, right: 100, bottom: 100 };
    expect(framesCoincide(a, b)).toBe(false);
  });

  it("is false when either frame is degenerate", () => {
    const zero: FrameQuad = { left: 10, top: 10, right: 10, bottom: 50 };
    const f: FrameQuad = { left: 10, top: 10, right: 100, bottom: 50 };
    expect(framesCoincide(zero, f)).toBe(false);
    expect(framesCoincide(f, zero)).toBe(false);
  });
});
