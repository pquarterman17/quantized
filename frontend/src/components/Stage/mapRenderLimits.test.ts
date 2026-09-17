// Audit P2.8 — explicit colour limits actually CLIP the painted heatmap (and
// the colourbar it labels), not merely sit in the store.
//
// Real-raster verification, the same technique (and the same clean skip when
// no canvas backend is present) as mapRender.test.ts's own draw() suite: paint
// a known gradient twice, once auto and once clipped, and read the pixels back.
// A pure `effectiveColorLimits` unit check alone would not prove that `draw`
// passes its result to `buildHeatmapImage` rather than recomputing the extent.

import { describe, expect, it } from "vitest";

import { effectiveColorLimits } from "../../lib/mapView";
import type { MapPayload } from "../../lib/mapdataFetch";
import { draw } from "./mapRender";

const CANVAS_OK = ((): boolean => {
  try {
    return document.createElement("canvas").getContext("2d") != null;
  } catch {
    return false;
  }
})();

/** 12x10 gradient, z from 0 to 119 (mapRender.test.ts's own fixture shape). */
const gradient = (): MapPayload => ({
  xAxis: Array.from({ length: 12 }, (_, i) => i),
  yAxis: Array.from({ length: 10 }, (_, j) => j),
  zGrid: Array.from({ length: 10 }, (_, j) => Array.from({ length: 12 }, (_, i) => j * 12 + i)),
  xLabel: "2Theta",
  xUnit: "deg",
  yLabel: "Omega",
  yUnit: "deg",
  zLabel: "I",
  zUnit: "cts",
  zMin: 0,
  zMax: 119,
});

function host(): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { configurable: true, value: 300 });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: 220 });
  return el;
}

/** How many DISTINCT opaque colours the painted raster contains. Clipping the
 *  range to a narrow band collapses most of the gradient onto the two end
 *  colours, so this number must drop. */
function distinctColours(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const seen = new Set<number>();
  for (let k = 0; k < img.length; k += 4) {
    if (img[k + 3] !== 255) continue;
    seen.add((img[k] << 16) | (img[k + 1] << 8) | img[k + 2]);
  }
  return seen.size;
}

describe("effectiveColorLimits", () => {
  it("prefers explicit limits over the payload's own extent", () => {
    expect(effectiveColorLimits([2, 8], 0, 119)).toEqual([2, 8]);
    expect(effectiveColorLimits(null, 0, 119)).toEqual([0, 119]);
  });

  it("returns null when neither source gives a usable range", () => {
    expect(effectiveColorLimits(null, null, null)).toBeNull();
    expect(effectiveColorLimits(null, 5, 5)).toBeNull(); // zero span
    expect(effectiveColorLimits([8, 2], 0, 119)).toBeNull(); // inverted
  });

  it("raises a non-positive explicit floor to the log floor in log mode", () => {
    // autoLo IS the smallest positive cell when the caller is in log mode.
    expect(effectiveColorLimits([0, 100], 0.5, 119, true)).toEqual([0.5, 100]);
    expect(effectiveColorLimits([-5, 100], 0.5, 119, true)).toEqual([0.5, 100]);
    // …and leaves a positive one alone.
    expect(effectiveColorLimits([2, 100], 0.5, 119, true)).toEqual([2, 100]);
    // Linear mode never raises it.
    expect(effectiveColorLimits([0, 100], 0.5, 119, false)).toEqual([0, 100]);
  });
});

describe.skipIf(!CANVAS_OK)("draw() honours explicit colour limits (real raster)", () => {
  it("clipping the range collapses the gradient onto fewer colours", () => {
    const auto = document.createElement("canvas");
    const clipped = document.createElement("canvas");
    draw(auto, host(), gradient(), "viridis", false);
    draw(clipped, host(), gradient(), "viridis", false, null, true, null, [58, 62]);
    expect(distinctColours(auto)).toBeGreaterThan(20);
    expect(distinctColours(clipped)).toBeLessThan(distinctColours(auto));
  });

  it("a nonsensical (inverted) range paints nothing rather than garbage", () => {
    const bad = document.createElement("canvas");
    draw(bad, host(), gradient(), "viridis", false, null, true, null, [62, 58]);
    const good = document.createElement("canvas");
    draw(good, host(), gradient(), "viridis", false);
    expect(distinctColours(bad)).toBeLessThan(distinctColours(good));
  });
});
