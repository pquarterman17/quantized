import { describe, expect, it } from "vitest";

import {
  breakComposition,
  breakPanelsOf,
  compositionPanelCount,
  facetComposition,
  facetPanelsOf,
  spatialComposition,
  spatialPanelsOf,
  type Composition,
} from "./composition";
import type { BreakPanel, FacetPanel } from "./facet";
import type { SpatialPanel } from "./multipanel";
import type { PlotPayload } from "./plotdata";

function payload(): PlotPayload {
  return {
    data: [
      [0, 1],
      [1, 2],
    ] as PlotPayload["data"],
    series: [{ label: "y", unit: "", axis: 0 }],
    xLabel: "x",
    xUnit: "",
  };
}

function spatial(): SpatialPanel {
  return {
    datasetId: "ds1",
    xKey: 0,
    yKeys: [1],
    xLim: [0, 1],
    yLim: [0, 1],
    xLog: false,
    yLog: false,
    row: 0,
    col: 0,
  };
}

const facet = (): FacetPanel => ({ label: "a", payload: payload() });
const brk = (): BreakPanel => ({ payload: payload(), xRange: [0, 1] });

describe("composition constructors", () => {
  it("returns null for an empty panel list so 'nothing' has ONE representation", () => {
    // The invariant that lets callers test `c === null` alone, never also
    // `c.panels.length === 0`.
    expect(spatialComposition([])).toBeNull();
    expect(facetComposition([])).toBeNull();
    expect(breakComposition([])).toBeNull();
  });

  it("tags the kind and holds the panel array by reference", () => {
    const panels = [spatial()];
    const c = spatialComposition(panels);
    expect(c?.kind).toBe("spatial");
    expect(c?.panels).toBe(panels); // identity, not a copy
  });

  it("tags facet and break kinds", () => {
    expect(facetComposition([facet()])?.kind).toBe("facet");
    expect(breakComposition([brk()])?.kind).toBe("break");
  });
});

describe("composition accessors", () => {
  it("returns the panels for a matching kind, by reference", () => {
    const panels = [spatial()];
    expect(spatialPanelsOf(spatialComposition(panels))).toBe(panels);
  });

  it("returns null for a non-matching kind", () => {
    const c = spatialComposition([spatial()]);
    expect(facetPanelsOf(c)).toBeNull();
    expect(breakPanelsOf(c)).toBeNull();
  });

  it("returns null for an absent composition", () => {
    expect(spatialPanelsOf(null)).toBeNull();
    expect(facetPanelsOf(null)).toBeNull();
    expect(breakPanelsOf(null)).toBeNull();
  });

  it("is reference-stable across repeated calls (Zustand selector safety)", () => {
    // A selector that built a fresh array/object each call would re-render on
    // every unrelated store write.
    const c = facetComposition([facet()]);
    expect(facetPanelsOf(c)).toBe(facetPanelsOf(c));
  });

  it("makes the old mutual exclusion structural: exactly one accessor is non-null", () => {
    const cases: Composition[] = [
      spatialComposition([spatial()])!,
      facetComposition([facet()])!,
      breakComposition([brk()])!,
    ];
    for (const c of cases) {
      const live = [spatialPanelsOf(c), facetPanelsOf(c), breakPanelsOf(c)].filter(
        (p) => p !== null,
      );
      expect(live).toHaveLength(1);
    }
  });
});

describe("compositionPanelCount", () => {
  it("counts panels, and is 0 when absent", () => {
    expect(compositionPanelCount(null)).toBe(0);
    expect(compositionPanelCount(spatialComposition([spatial(), spatial()]))).toBe(2);
    expect(compositionPanelCount(breakComposition([brk()]))).toBe(1);
  });
});
