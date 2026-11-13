// Audit #11 on screen: a full-height shade spans the plot on any scale, a
// data-y shade with a side <= 0 on a log axis runs from the floor instead of
// vanishing, and an off-scale reference line is marked at the edge.

import { beforeAll, describe, expect, it } from "vitest";

import { refLinePlugin, regionShadePlugin } from "./uplotOverlays";
import { drawOffScaleRefLine } from "./uplotRegionShades";

/** The module under test starts a lazy import at load; once that chunk has
 *  evaluated and one macrotask has passed, its `.then` has installed it. */
const lazyChunkLoaded = async () => {
  await import("./uplotRegionShades");
  await new Promise((r) => setTimeout(r, 0));
};
beforeAll(lazyChunkLoaded); // the lazy chunk the module under test loads at import
import type { RegionShade } from "./types";

const BBOX = { left: 10, top: 5, width: 100, height: 80 };

/** A log-ish y: v > 0 -> 100 - log10(v) * 10, v <= 0 -> -Infinity / NaN, as
 *  uPlot's own log valToPos gives for a value with no position. */
function fakeU(log: boolean) {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h });
    },
    fillStyle: "", globalAlpha: 1,
  };
  const valToPos = (v: number, scale: string) => {
    if (scale === "x") return v;
    if (!log) return 100 - v;
    return v > 0 ? 85 - Math.log10(v) * 10 : v === 0 ? -Infinity : NaN;
  };
  return { u: { ctx, bbox: BBOX, valToPos, scales: { x: {}, y: {} } }, rects };
}

function draw(shades: RegionShade[], log: boolean) {
  const { u, rects } = fakeU(log);
  // @ts-expect-error — minimal stub stands in for a real uPlot instance
  regionShadePlugin(shades).hooks.drawClear?.(u);
  return rects;
}

describe("region shades are visible on any scale", () => {
  it("a full-height shade spans the plot height, whatever its y", () => {
    const rects = draw([{ id: "s", x1: 20, x2: 40, y1: 0, y2: 1, fill: "#336699", fullHeight: true }], true);
    expect(rects).toEqual([{ x: 20, y: BBOX.top, w: 20, h: BBOX.height }]);
  });

  it("y1 = 0 on a log axis runs from the plot floor instead of vanishing", () => {
    const rects = draw([{ id: "s", x1: 20, x2: 40, y1: 0, y2: 100, fill: "#336699" }], true);
    expect(rects).toHaveLength(1);
    expect(rects[0].y + rects[0].h).toBe(BBOX.top + BBOX.height);
    expect(rects[0].y).toBe(65); // 85 - log10(100) * 10
  });

  it("a shade with no position at all is skipped", () => {
    expect(draw([{ id: "s", x1: 20, x2: 40, y1: -2, y2: -1, fill: "#336699" }], true)).toEqual([]);
  });

  it("linear data-y shades are unchanged", () => {
    expect(draw([{ id: "s", x1: 20, x2: 40, y1: 10, y2: 90, fill: "#336699" }], false)).toEqual([{ x: 20, y: 10, w: 20, h: 80 }]);
  });
});

describe("an off-scale reference line is marked at the plot edge", () => {
  function marker(axis: "x" | "y", side: "low" | "high", label?: string) {
    const texts: { text: string; x: number; y: number; align: string }[] = [];
    const ctx = {
      save() {}, restore() {}, setLineDash() {}, globalAlpha: 1, textAlign: "", textBaseline: "",
      fillText(text: string, x: number, y: number) {
        texts.push({ text, x, y, align: ctx.textAlign });
      },
    };
    drawOffScaleRefLine(ctx as unknown as CanvasRenderingContext2D, { axis, label }, 25, side, BBOX);
    return texts;
  }

  it("names the line and points the way it lies", () => {
    expect(marker("x", "high")).toEqual([{ text: "x = 25 (off-scale) ▸", x: 106, y: 81, align: "right" }]);
    expect(marker("x", "low")[0].text).toBe("◂ x = 25 (off-scale)");
    expect(marker("y", "high")[0].text).toBe("▴ y = 25 (off-scale)");
    expect(marker("y", "low", "Tc")[0].text).toBe("▾ Tc (off-scale)");
  });
});

describe("refLinePlugin marks an off-scale line instead of dropping it", () => {
  it("draws the marker for a line beyond the x scale, the line itself for one inside", () => {
    const texts: string[] = [];
    const strokes: number[] = [];
    let lastX = NaN;
    const ctx = {
      save() {}, restore() {}, beginPath() {}, setLineDash() {},
      stroke() {
        strokes.push(lastX);
      },
      moveTo(x: number) {
        lastX = x;
      },
      lineTo() {}, measureText: () => ({ width: 10 }),
      fillText(t: string) {
        texts.push(t);
      },
      font: "10px sans-serif", fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1, textAlign: "", textBaseline: "",
    };
    const u = { ctx, bbox: BBOX, valToPos: (v: number) => v };
    const plugin = refLinePlugin([{ id: "a", axis: "x", value: 500 }, { id: "b", axis: "x", value: 50 }], "#888");
    // @ts-expect-error — minimal stub stands in for a real uPlot instance
    plugin.hooks.draw?.(u);
    expect(texts).toEqual(["x = 500 (off-scale) ▸"]);
    expect(strokes).toEqual([50]);
  });
});
