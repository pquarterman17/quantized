import { describe, expect, it } from "vitest";

import { cellInk, COLORMAPS, colormap, colormapCss, diverging, divergingCss, normalize, sampleColormap } from "./colormap";

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

describe("normalize", () => {
  it("linear maps endpoints to 0 and 1", () => {
    expect(normalize(0, 0, 10, false)).toBe(0);
    expect(normalize(10, 0, 10, false)).toBe(1);
    expect(normalize(5, 0, 10, false)).toBe(0.5);
  });

  it("log compresses a wide dynamic range (decade midpoint -> 0.5)", () => {
    // lo=1, hi=100 -> v=10 sits at half the log span.
    expect(normalize(10, 1, 100, true)).toBeCloseTo(0.5, 12);
    expect(normalize(1, 1, 100, true)).toBe(0);
    expect(normalize(100, 1, 100, true)).toBeCloseTo(1, 12);
  });

  it("returns null (transparent) for non-finite, and non-positive in log mode", () => {
    expect(normalize(NaN, 0, 10, false)).toBeNull();
    expect(normalize(0, 1, 100, true)).toBeNull(); // log of 0 is undefined
    expect(normalize(-5, 1, 100, true)).toBeNull();
  });

  it("collapses a degenerate range to 0", () => {
    expect(normalize(5, 7, 7, false)).toBe(0);
  });
});

describe("diverging (correlation-matrix RDBU scale, JMP_GAP J10)", () => {
  it("r=-1 and r=+1 land on the RDBU end stops", () => {
    expect(diverging(-1)).toEqual(sampleColormap(COLORMAPS.rdbu, 0));
    expect(diverging(1)).toEqual(sampleColormap(COLORMAPS.rdbu, 1));
  });

  it("r=0 lands on the near-white midpoint", () => {
    const [r, g, b] = diverging(0);
    expect(r).toBeGreaterThan(230);
    expect(g).toBeGreaterThan(230);
    expect(b).toBeGreaterThan(230);
  });

  it("clamps out-of-range r to the endpoints", () => {
    expect(diverging(-5)).toEqual(diverging(-1));
    expect(diverging(5)).toEqual(diverging(1));
  });

  it("non-finite r reads as the neutral midpoint, not an extreme", () => {
    expect(diverging(NaN)).toEqual(diverging(0));
  });

  it("positive r reads warmer (more red, less blue) than negative r", () => {
    const pos = diverging(0.8);
    const neg = diverging(-0.8);
    expect(pos[0]).toBeGreaterThan(neg[0]);
    expect(pos[2]).toBeLessThan(neg[2]);
  });

  it("divergingCss emits an rgb() string matching diverging()", () => {
    const [r, g, b] = diverging(0.5);
    expect(divergingCss(0.5)).toBe(`rgb(${r}, ${g}, ${b})`);
  });
});

describe("cellInk", () => {
  it("picks light ink over a dark fill", () => {
    expect(cellInk([5, 48, 97])).toBe("#f2f2f2");
  });
  it("picks dark ink over a light fill", () => {
    expect(cellInk([247, 247, 247])).toBe("#1a1a1a");
  });
});
