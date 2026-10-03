// fitNewWindowGeometry — a NEW window's cascade placement + default size,
// fitted to the live stage so a small stage (1000x700 / 800x600 windows)
// never opens a window partly clipped by it.

import { describe, expect, it } from "vitest";

import { cascadeGeometry, fitNewWindowGeometry, NEW_WINDOW_MIN_H, NEW_WINDOW_MIN_W } from "./plotWindows";

describe("fitNewWindowGeometry", () => {
  it("leaves the geometry alone when there are no bounds yet (Plot tab never mounted)", () => {
    const g = cascadeGeometry(3);
    expect(fitNewWindowGeometry(g, null)).toEqual(g);
  });

  it("leaves a geometry that already fits untouched", () => {
    const g = cascadeGeometry(1);
    expect(fitNewWindowGeometry(g, { width: 1200, height: 800 })).toEqual(g);
  });

  it("slides the cascade offset back so the whole default-size frame is inside the stage", () => {
    // index 10: x = y = 280, 480x360 — overflows a 700x560 stage on both axes
    const out = fitNewWindowGeometry(cascadeGeometry(10), { width: 700, height: 560 });
    expect(out).toEqual({ x: 700 - 480, y: 560 - 360, w: 480, h: 360 });
  });

  it("shrinks a frame larger than the stage to the stage, at 0,0", () => {
    const out = fitNewWindowGeometry({ x: 64, y: 64, w: 760, h: 560 }, { width: 520, height: 400 });
    expect(out).toEqual({ x: 0, y: 0, w: 520, h: 400 });
  });

  it("never shrinks below the minimum, even on a tiny stage", () => {
    const out = fitNewWindowGeometry({ x: 40, y: 40, w: 480, h: 360 }, { width: 50, height: 30 });
    expect(out).toEqual({ x: 0, y: 0, w: NEW_WINDOW_MIN_W, h: NEW_WINDOW_MIN_H });
  });
});
