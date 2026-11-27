import { describe, expect, it } from "vitest";

import { placeBesidePlot, type Box, type PlacementInput } from "./toolWindowPlacement";

const VIEW = { width: 1440, height: 900 };
const base = (over: Partial<PlacementInput>): PlacementInput => ({
  width: 340, viewport: VIEW, plot: { left: 239, top: 102, right: 1047, bottom: 876 },
  toolbar: { left: 254, top: 143, right: 1033, bottom: 196 }, libraryRight: 230, deskTop: 102, fallback: { x: 120, y: 90 }, ...over,
});
const hits = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const boxAt = (p: { x: number; y: number }, w: number, h = 400): Box => ({ left: p.x, top: p.y, right: p.x + w, bottom: p.y + h });

describe("placeBesidePlot (u11)", () => {
  it("opens to the right of the plot when there is room, level with its top", () => {
    const p = placeBesidePlot(base({}));
    expect(p).toEqual({ x: 1055, y: 102 });
  });

  it("falls back to the left of the plot, clear of the Library", () => {
    const plot = { left: 700, top: 102, right: 1430, bottom: 876 };
    const p = placeBesidePlot(base({ plot, toolbar: { left: 710, top: 143, right: 1420, bottom: 196 } }));
    expect(p.x).toBe(700 - 8 - 340);
    expect(p.x).toBeGreaterThanOrEqual(238);
  });

  it("with no room beside, sits inside the plot UNDER its toolbar (a wide Ternary window)", () => {
    const p = placeBesidePlot(base({ width: 560 }));
    const toolbar = base({}).toolbar!;
    expect(p.y).toBeGreaterThanOrEqual(toolbar.bottom + 8);
    expect(hits(boxAt(p, 560), toolbar)).toBe(false);
    expect(p.x + 560).toBeLessThanOrEqual(VIEW.width - 8);
  });

  it("never opens above the desk top, nor over the toolbar, whatever the plot", () => {
    for (const width of [300, 340, 440, 560, 700]) {
      const p = placeBesidePlot(base({ width }));
      expect(p.y).toBeGreaterThanOrEqual(102);
      expect(hits(boxAt(p, width), base({}).toolbar!)).toBe(false);
    }
  });

  it("without a plot it keeps the old corner, but below the desk top and clear of the Library", () => {
    expect(placeBesidePlot(base({ plot: null, toolbar: null }))).toEqual({ x: 238, y: 110 });
    expect(placeBesidePlot(base({ plot: null, toolbar: null, libraryRight: 0, deskTop: 0 }))).toEqual({ x: 120, y: 90 });
  });
});
