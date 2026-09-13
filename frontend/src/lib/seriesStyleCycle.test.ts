// PRIMARY_SOFTWARE_AUDIT_PLAN P3.3 — the auto dash/marker cycle's own unit
// contract. The behaviours the canvas, the legend and the export all lean on:
// no cycle is the IDENTITY (not "a copy that happens to look the same"), a
// cycle assigns by DISPLAY POSITION (which is not always the caller's own
// index), and an explicit style always wins.

import { describe, expect, it } from "vitest";

import { MARKER_SHAPES } from "./markers";
import {
  AUTO_DASH_CYCLE,
  AUTO_MARKER_CYCLE,
  DASH,
  displayPositions,
  documentPinsSeriesStyles,
  overlayExportsSeriesStyles,
  resolveSeriesStyle,
  type CycleView,
} from "./seriesStyleCycle";
import type { SeriesStyle } from "./types";

/** Plain display order for `n` series — what every canvas passes. */
const ident = (n: number) => displayPositions(true, n);

describe("displayPositions", () => {
  it("is null when the preference is off — the ONLY switch there is", () => {
    expect(displayPositions(false, 5)).toBeNull();
  });

  it("is plain display order when on", () => {
    expect(displayPositions(true, 3)).toEqual([0, 1, 2]);
    expect(displayPositions(true, 0)).toEqual([]);
  });
});

describe("overlayExportsSeriesStyles — the ONE view test both sides gate on", () => {
  const overlay: CycleView = {
    groupKey: null,
    facetKey: null,
    stackMode: false,
    polarMode: false,
    statMode: false,
  };

  it("accepts the plain single-panel overlay", () => {
    expect(overlayExportsSeriesStyles(overlay)).toBe(true);
  });

  it("refuses every view whose export cannot apply per-series styles", () => {
    // group_col: export_figures.py:114-117 ("series_styles is not applied in
    // this path either") — the screen splits each channel into per-level series.
    expect(overlayExportsSeriesStyles({ ...overlay, groupKey: 3 })).toBe(false);
    // facets: export_figures.py:125-127 ("series_styles ... UNUSED once facets
    // is set") — yet the screen's facet panels would happily cycle.
    expect(overlayExportsSeriesStyles({ ...overlay, facetKey: 2 })).toBe(false);
    // stackMode: the screen-only panel split (and the gate PlotStage puts every
    // other multi-panel arrangement behind) that a single figure cannot show.
    expect(overlayExportsSeriesStyles({ ...overlay, stackMode: true })).toBe(false);
    // polar/stat: the XY canvas is replaced entirely (PlotStage early-returns to
    // PolarStage/StatStage), but a plain buildFigureSpec request still emits an
    // ordinary XY figure — so "Export figure…" used to dash a figure the screen
    // never dashed.
    expect(overlayExportsSeriesStyles({ ...overlay, polarMode: true })).toBe(false);
    expect(overlayExportsSeriesStyles({ ...overlay, statMode: true })).toBe(false);
  });
});

describe("documentPinsSeriesStyles — an exact array is the document's final word", () => {
  it("is true only for an ARRAY of publication series styles", () => {
    // `figureSpec` ships an exact array verbatim and never calls
    // `buildExportStyles`, so the canvas beside such a document must not cycle.
    expect(documentPinsSeriesStyles({ publication: { seriesStyles: [{}, null] } })).toBe(true);
    expect(documentPinsSeriesStyles({ publication: { seriesStyles: [] } })).toBe(true);
  });

  it("is false for absent, null, and no publication block at all", () => {
    // absent = "derive from the PlotView" (so the cycle may apply);
    // null = "omit styles"; neither pins anything.
    expect(documentPinsSeriesStyles({ publication: { seriesStyles: undefined } })).toBe(false);
    expect(documentPinsSeriesStyles({ publication: { seriesStyles: null } })).toBe(false);
    expect(documentPinsSeriesStyles({})).toBe(false);
    expect(documentPinsSeriesStyles(undefined)).toBe(false);
    expect(documentPinsSeriesStyles(null)).toBe(false);
  });
});

describe("resolveSeriesStyle with NO cycle", () => {
  it("returns undefined for an unstyled series — no object is invented", () => {
    expect(resolveSeriesStyle(undefined, 0, null)).toBeUndefined();
    expect(resolveSeriesStyle(undefined, 1, null)).toBeUndefined();
    expect(resolveSeriesStyle(undefined, 7, null)).toBeUndefined();
  });

  it("returns the caller's OWN reference, not a shallow copy", () => {
    const style: SeriesStyle = { color: "#ff0000", width: 3 };
    // Reference identity, deliberately: `toBe`, not `toEqual`. A copy would
    // compare equal here and still break every `useMemo`/prop-identity check
    // downstream, which is what "off changes nothing" has to mean.
    expect(resolveSeriesStyle(style, 4, null)).toBe(style);
  });

  it("leaves an index the cycle does not cover alone — the overlay guard", () => {
    // A fit/baseline/peak overlay is appended PAST the plotted channels and the
    // export draws none of them, so PlotStage's positions stop at
    // `plotted.length` and index 3 here falls off the end.
    const style: SeriesStyle = { width: 1 };
    expect(resolveSeriesStyle(style, 3, ident(3))).toBe(style);
    expect(resolveSeriesStyle(undefined, 3, ident(3))).toBeUndefined();
  });
});

describe("resolveSeriesStyle with a cycle", () => {
  it("assigns a dash + glyph by display position to an unstyled series", () => {
    const c = ident(3);
    expect(resolveSeriesStyle(undefined, 0, c)).toEqual({ line: "solid", markerShape: "circle" });
    expect(resolveSeriesStyle(undefined, 1, c)).toEqual({ line: "dashed", markerShape: "square" });
    expect(resolveSeriesStyle(undefined, 2, c)).toEqual({ line: "dotted", markerShape: "triangle" });
  });

  it("reads the DISPLAY POSITION, not the caller's own index", () => {
    // This is finding 2 in one assertion. The export's own index for a channel
    // is its slot in the hidden-FILTERED list; the canvas kept the hidden
    // series in place, so the same channel's display position is 2 there. Given
    // the canvas' positions, index 0 must resolve to position 2's dotted — if
    // this function used `index` the test reads "solid" and the PDF disagrees
    // with the screen.
    expect(resolveSeriesStyle(undefined, 0, [2, 3])?.line).toBe("dotted");
    expect(resolveSeriesStyle(undefined, 1, [2, 3])?.line).toBe("solid"); // 3 % 3
    expect(resolveSeriesStyle(undefined, 1, [2, 3])?.markerShape).toBe("diamond"); // 3 of 8
  });

  it("gives three consecutive series three DISTINCT dashes and glyphs", () => {
    const three = [0, 1, 2].map((i) => resolveSeriesStyle(undefined, i, ident(3))!);
    expect(new Set(three.map((s) => s.line)).size).toBe(3);
    expect(new Set(three.map((s) => s.markerShape)).size).toBe(3);
    // and the dashes are visually distinct too, not three names for one pattern
    expect(new Set(three.map((s) => JSON.stringify(DASH[s.line!]))).size).toBe(3);
  });

  it("wraps at each cycle's own length, independently", () => {
    const c = ident(10);
    expect(resolveSeriesStyle(undefined, 3, c)?.line).toBe("solid"); // 3 dashes
    expect(resolveSeriesStyle(undefined, 3, c)?.markerShape).toBe("diamond"); // 8 glyphs
    expect(resolveSeriesStyle(undefined, 8, c)?.markerShape).toBe(AUTO_MARKER_CYCLE[0]);
    expect(resolveSeriesStyle(undefined, 9, c)?.line).toBe(AUTO_DASH_CYCLE[0]);
  });

  it("an explicit line/markerShape WINS over the cycle — including solid/circle", () => {
    const c = ident(3);
    // position 1 would otherwise be dashed/square
    expect(resolveSeriesStyle({ line: "solid" }, 1, c)).toEqual({ line: "solid", markerShape: "square" });
    expect(resolveSeriesStyle({ markerShape: "circle" }, 1, c)).toEqual({
      line: "dashed",
      markerShape: "circle",
    });
    expect(resolveSeriesStyle({ line: "dotted", markerShape: "star" }, 1, c)).toEqual({
      line: "dotted",
      markerShape: "star",
    });
  });

  it("preserves every other field of the caller's style", () => {
    const style: SeriesStyle = { color: "#123456", width: 2.5, marker: true, markerSize: 9, step: "mid" };
    expect(resolveSeriesStyle(style, 1, ident(2))).toEqual({ ...style, line: "dashed", markerShape: "square" });
  });

  it("never turns markers ON by itself — the glyph is inert until something does", () => {
    expect(resolveSeriesStyle(undefined, 1, ident(2))?.marker).toBeUndefined();
    expect(resolveSeriesStyle({ marker: false }, 1, ident(2))?.marker).toBe(false);
  });
});

describe("the cycles themselves", () => {
  it("cover the whole LineStyle / MarkerShape vocabularies with no repeats", () => {
    expect(new Set(AUTO_DASH_CYCLE).size).toBe(AUTO_DASH_CYCLE.length);
    expect(new Set(AUTO_MARKER_CYCLE).size).toBe(AUTO_MARKER_CYCLE.length);
    expect([...AUTO_DASH_CYCLE].sort()).toEqual(Object.keys(DASH).sort());
    // Against the real shape list, not the magic number 8: a ninth glyph must
    // either join the cycle or make this fail, never silently stay unreachable.
    expect([...AUTO_MARKER_CYCLE].sort()).toEqual(MARKER_SHAPES.map((m) => m.value).sort());
  });

  it("starts at the values that reproduce today's default look for series 1", () => {
    expect(AUTO_DASH_CYCLE[0]).toBe("solid");
    expect(AUTO_MARKER_CYCLE[0]).toBe("circle");
  });
});
