// The scale bar through the real map render path: what `draw` strokes and prints
// for a bar in each corner, against the rules in lib/mapScaleBar.ts (the export
// draws the same bar: tests/test_map_scalebar.py).
import { afterEach, describe, expect, it, vi } from "vitest";

import { BAR_PX, scaleBarLayout } from "../../lib/mapScaleBar";
import type { MapScaleBar, ScaleBarCorner } from "../../lib/mapScaleBarOptions";
import type { MapPayload } from "../../lib/mapdataFetch";
import { draw, plotRect } from "./mapRender";

const payload = {
  xAxis: [0, 25, 50, 75, 100], yAxis: [0, 10, 20], xUnit: "nm", yUnit: "deg", xLabel: "x", yLabel: "y", zLabel: "z", zUnit: "",
  zGrid: [[0, 1, 2, 3, 4], [4, 5, 6, 7, 8], [8, 9, 10, 11, 12]], zMin: 0, zMax: 12,
} as unknown as MapPayload;
const W = 650;
const H = 450;
const TEXT_W = 10; // measureText's width, in px

interface Seg { x1: number; y1: number; x2: number; y2: number; width: number; style: string }

function run(bar: MapScaleBar | null) {
  const segs: Seg[] = [];
  const texts: { text: string; x: number; y: number; style: string }[] = [];
  let moved: [number, number] | null = null;
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      if (prop === "moveTo") return (x: number, y: number) => { moved = [x, y]; };
      if (prop === "lineTo") return (x: number, y: number) => {
        if (moved) segs.push({ x1: moved[0], y1: moved[1], x2: x, y2: y, width: t.lineWidth as number, style: t.strokeStyle as string });
        moved = [x, y];
      };
      if (prop === "fillText") return (text: string, x: number, y: number) => texts.push({ text, x, y, style: t.fillStyle as string });
      if (prop === "createLinearGradient") return () => ({ addColorStop: () => {} });
      if (prop === "createImageData") return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (prop === "measureText") return () => ({ width: TEXT_W });
      return () => {};
    },
    set(t, prop, v) {
      t[prop as string] = v;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as never);
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: W });
  Object.defineProperty(host, "clientHeight", { value: H });
  draw(document.createElement("canvas"), host, payload, "viridis", false, null, true, null, null, null, bar);
  return { segs, texts };
}

afterEach(() => vi.restoreAllMocks());

describe("map scale bar on the canvas", () => {
  const rect = plotRect(payload, W, H);

  it("draws nothing unless asked", () => {
    const { segs, texts } = run(null);
    expect(texts.map((t) => t.text)).not.toContain("20 nm");
    expect(segs.filter((s) => s.width === BAR_PX)).toEqual([]);
  });

  it.each<ScaleBarCorner>(["bl", "br", "tl", "tr"])("an automatic bar in the %s corner is a fifth of the axis, labelled with its unit", (corner) => {
    const { segs, texts } = run({ corner, color: "#ff8800" });
    const bar = segs.find((s) => s.width === BAR_PX)!;
    const label = texts.find((t) => t.text === "20 nm")!;
    expect(bar.style).toBe("#ff8800");
    expect(label.style).toBe("#ff8800");
    expect(bar.x2 - bar.x1).toBeCloseTo((20 / 100) * rect.w, 6); // 20 nm of a 100 nm axis
    const lay = scaleBarLayout(corner, rect.w, rect.h, bar.x2 - bar.x1, TEXT_W, 11 * 1.2);
    expect(bar.x1).toBeCloseTo(rect.x + lay.x0, 6);
    expect(bar.x2).toBeCloseTo(rect.x + lay.x1, 6);
    expect(bar.y1).toBeCloseTo(rect.y + lay.y, 6);
    expect(label.x).toBeCloseTo(rect.x + lay.labelLeft, 6);
    expect(label.y).toBeCloseTo(rect.y + lay.labelTop, 6);
    // in the corner it was asked for, inside the plot area
    expect(bar.x1).toBeGreaterThanOrEqual(rect.x);
    expect(bar.x2).toBeLessThanOrEqual(rect.x + rect.w);
    expect(bar.y1 > rect.y + rect.h / 2).toBe(corner.startsWith("b"));
    expect(bar.x1 > rect.x + rect.w / 2).toBe(corner.endsWith("r"));
  });

  it("an explicit length and label are used as typed", () => {
    const { segs, texts } = run({ corner: "bl", color: "#ffffff", length: 50, label: "50 um" });
    const bar = segs.find((s) => s.width === BAR_PX)!;
    expect(bar.x2 - bar.x1).toBeCloseTo(0.5 * rect.w, 6);
    expect(texts.map((t) => t.text)).toContain("50 um");
  });
});
