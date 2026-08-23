// Naming the ROI commit bar's two collapse axes.
//
// The bug this covers was a labelling bug, but the fix has a correctness edge:
// the box and the ruler collapse in DIFFERENT frames, so "just show the data
// axes" would be wrong for the ruler at every angle but zero. These tests pin
// that distinction, not just the strings.

import { describe, expect, it } from "vitest";

import type { MapPayload } from "../../lib/mapdataFetch";
import {
  axisTitle,
  boxAxes,
  integrateTitle,
  previewTitle,
  rulerAxes,
  shortAxisName,
} from "./roiAxisNames";

function payload(over: Partial<MapPayload> = {}): MapPayload {
  return {
    xAxis: [0, 1],
    yAxis: [0, 1],
    zGrid: [[1, 2], [3, 4]],
    xLabel: "2Theta",
    xUnit: "deg",
    yLabel: "Omega",
    yUnit: "deg",
    zLabel: "Intensity",
    zUnit: "counts",
    zMin: 1,
    zMax: 4,
    ...over,
  };
}

describe("shortAxisName", () => {
  it("passes a name the toggle can fit through untouched", () => {
    expect(shortAxisName("2Theta", "x")).toBe("2Theta");
    expect(shortAxisName("Qx", "x")).toBe("Qx");
  });

  it("ellipsizes a longer one rather than letting it push the ✕ out of the bar", () => {
    expect(shortAxisName("Temperature", "x")).toBe("Tempe…");
    expect(shortAxisName("Temperature", "x").length).toBe(6);
  });

  it("falls back when a channel carries no label at all", () => {
    expect(shortAxisName("", "x")).toBe("x");
    expect(shortAxisName("   ", "y")).toBe("y");
  });
});

describe("axisTitle", () => {
  it("composes label + unit the way the canvas axis title does", () => {
    // mapRender.ts paints `${p.xLabel} (${p.xUnit})`; the bar must not invent
    // a second spelling of the same axis.
    expect(axisTitle("2Theta", "deg", "x")).toBe("2Theta (deg)");
  });

  it("omits an empty unit instead of rendering bare parens", () => {
    expect(axisTitle("Qx", "", "x")).toBe("Qx");
    expect(axisTitle("Qx", "  ", "x")).toBe("Qx");
  });
});

describe("boxAxes — the axis-aligned box takes the map's own axes", () => {
  it("names each collapse axis after the data, not after x/y", () => {
    const a = boxAxes(payload());
    expect(a.x.name).toBe("2Theta");
    expect(a.y.name).toBe("Omega");
  });

  it("carries units in the full name for the tooltip", () => {
    const a = boxAxes(payload());
    expect(a.x.full).toBe("2Theta (deg)");
    expect(a.y.full).toBe("Omega (deg)");
  });

  it("names the OTHER axis as the one being summed away", () => {
    // "∫ 2Theta" produces a profile vs 2Theta by summing over Omega
    // (roiMath.boxProfileLocal: collapse "x" keeps x as the abscissa). Getting
    // this backwards in the tooltip would be worse than no tooltip.
    const a = boxAxes(payload());
    expect(a.x.over).toBe("Omega (deg)");
    expect(a.y.over).toBe("2Theta (deg)");
  });

  it("works in Q space, where the same map has different axes", () => {
    const a = boxAxes(payload({ xLabel: "Qx", xUnit: "1/Å", yLabel: "Qz", yUnit: "1/Å" }));
    expect(a.x.name).toBe("Qx");
    expect(a.y.name).toBe("Qz");
    expect(a.x.full).toBe("Qx (1/Å)");
  });
});

describe("rulerAxes — the ruler collapses in its OWN rotated frame", () => {
  it("does not name its axes after the data axes", () => {
    // The load-bearing assertion. useMapRuler passes `angle: ruler.angle` to
    // boxProfileLocal, and rulerToRect puts local x along the ruler's LENGTH —
    // so calling that axis "2Theta" would be false as soon as the ruler turns.
    const a = rulerAxes(payload(), 30);
    expect(a.x.name).not.toBe("2Theta");
    expect(a.y.name).not.toBe("Omega");
    expect(a.x.name).toBe("along");
    expect(a.y.name).toBe("across");
  });

  it("quotes the angle against the map's x axis by name", () => {
    expect(rulerAxes(payload(), 30).x.full).toBe("the ruler's length (30° from 2Theta)");
    expect(rulerAxes(payload({ xLabel: "Qx" }), -12.5).x.full).toBe(
      "the ruler's length (-12.5° from Qx)",
    );
  });

  it("rounds a dragged angle to one decimal instead of showing float noise", () => {
    expect(rulerAxes(payload(), 30.049999).x.full).toContain("30° from");
    expect(rulerAxes(payload(), 30.06).x.full).toContain("30.1° from");
  });

  it("still says along/across at angle 0, where the frames happen to coincide", () => {
    // Tempting to special-case, deliberately not: a bar whose labels change
    // vocabulary as you drag through 0° is worse than one that is always true.
    const a = rulerAxes(payload(), 0);
    expect(a.x.name).toBe("along");
    expect(a.x.full).toBe("the ruler's length (0° from 2Theta)");
  });
});

describe("tooltips", () => {
  it("distinguishes the client preview from the landing commit", () => {
    // The sparkline never touches the network (roiMath.ts's header); the ∫
    // button does and lands a dataset. Same axis, two different promises.
    const a = boxAxes(payload());
    expect(previewTitle(a.x)).toBe("Preview the profile onto 2Theta (deg), summing over Omega (deg)");
    expect(integrateTitle(a.x)).toBe(
      "Integrate onto 2Theta (deg), summing over Omega (deg) — lands as a new dataset",
    );
  });

  it("reads as English for the ruler's possessive phrasing too", () => {
    const a = rulerAxes(payload(), 30);
    expect(integrateTitle(a.x)).toBe(
      "Integrate onto the ruler's length (30° from 2Theta), summing over its width — lands as a new dataset",
    );
    expect(integrateTitle(a.y)).toBe(
      "Integrate onto the ruler's width, summing over its length — lands as a new dataset",
    );
  });
});
