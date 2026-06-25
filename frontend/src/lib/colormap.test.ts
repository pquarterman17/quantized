import { describe, expect, it } from "vitest";

import { COLORMAPS, colormap, colormapCss, sampleColormap } from "./colormap";

describe("sampleColormap", () => {
  const stops = COLORMAPS.viridis;

  it("returns the endpoints at t=0 and t=1", () => {
    expect(sampleColormap(stops, 0)).toEqual(stops[0]);
    expect(sampleColormap(stops, 1)).toEqual(stops[stops.length - 1]);
  });

  it("clamps out-of-range t to the endpoints", () => {
    expect(sampleColormap(stops, -2)).toEqual(stops[0]);
    expect(sampleColormap(stops, 5)).toEqual(stops[stops.length - 1]);
  });

  it("maps non-finite t to the first stop (NaN-safe)", () => {
    expect(sampleColormap(stops, NaN)).toEqual(stops[0]);
  });

  it("interpolates linearly between adjacent stops", () => {
    // gray has exactly two stops [0,0,0] and [255,255,255]; t=0.5 -> mid gray.
    expect(sampleColormap(COLORMAPS.gray, 0.5)).toEqual([128, 128, 128]);
  });

  it("stays within byte range across the ramp", () => {
    for (let t = 0; t <= 1; t += 0.05) {
      for (const c of sampleColormap(stops, t)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("colormap / colormapCss", () => {
  it("named lookup matches direct sampling", () => {
    expect(colormap("magma", 0.3)).toEqual(sampleColormap(COLORMAPS.magma, 0.3));
  });

  it("emits an rgb() string", () => {
    expect(colormapCss("viridis", 0)).toBe("rgb(68, 1, 84)");
  });
});
