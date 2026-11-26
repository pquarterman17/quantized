// Measurement labels on the canvas stay inside the plot frame, and an angle's
// label is clear of both of its arms (the export agrees: tests/test_annotation_label_placement.py).
import { describe, expect, it } from "vitest";

import { segmentHitsBox } from "./annotationMeasure";
import type { Shape } from "./types";
import { drawMeasureShape } from "./uplotMeasureShapes";

const BBOX = { left: 50, top: 10, width: 400, height: 300 };
const CHAR_W = 7;
const GLYPH_H = 11;

function stub() {
  const u = {
    valToPos: (v: number, sc: string) => (sc === "x" ? BBOX.left + v * 20 : BBOX.top + BBOX.height - v * 13),
    scales: { x: { distr: 1 }, y: { distr: 1 } },
    bbox: BBOX,
  };
  const drawn: { text: string; x: number; y: number }[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => {
      if (k === "fillText") return (text: string, x: number, y: number) => drawn.push({ text, x, y });
      if (k === "measureText") return (text: string) => ({ width: text.length * CHAR_W, actualBoundingBoxAscent: GLYPH_H - 3, actualBoundingBoxDescent: 3 });
      return k in t ? t[k] : () => undefined;
    },
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  return { u, ctx, drawn };
}

const style = { stroke: "#fff", opacity: 1, width: 1.5, dash: [] as number[] };
const layout = (u: ReturnType<typeof stub>["u"], s: Shape) => ({
  x1: u.valToPos(s.x1, "x"), y1: u.valToPos(s.y1, "y"), x2: u.valToPos(s.x2, "x"), y2: u.valToPos(s.y2, "y"),
  ...(s.x3 !== undefined && s.y3 !== undefined ? { x3: u.valToPos(s.x3, "x"), y3: u.valToPos(s.y3, "y") } : {}),
});
const box = (d: { text: string; x: number; y: number }): [number, number, number, number] => [d.x, d.y, d.text.length * CHAR_W, GLYPH_H];

describe("measurement label placement on the canvas", () => {
  it("keeps a distance label near the right edge inside the frame", () => {
    const { u, ctx, drawn } = stub();
    const s = { id: "d", kind: "distance", x1: 11, y1: 2.2, x2: 18, y2: 8.8 } as Shape;
    drawMeasureShape(u as never, ctx, s, layout(u, s), style, "11px monospace");
    expect(drawn).toHaveLength(1);
    const [left, top, w, h] = box(drawn[0]);
    expect(left).toBeGreaterThanOrEqual(BBOX.left);
    expect(left + w).toBeLessThanOrEqual(BBOX.left + BBOX.width);
    expect(top).toBeGreaterThanOrEqual(BBOX.top);
    expect(top + h).toBeLessThanOrEqual(BBOX.top + BBOX.height);
  });

  it("places an angle label clear of both arms and the vertex's arc", () => {
    const { u, ctx, drawn } = stub();
    const s = { id: "a", kind: "angle", x1: 3, y1: 16.5, x2: 7, y2: 18.7, x3: 7.4, y3: 16.5 } as Shape;
    const l = layout(u, s) as Required<ReturnType<typeof layout>>;
    drawMeasureShape(u as never, ctx, s, l, style, "11px monospace");
    const b = box(drawn[0]);
    expect(segmentHitsBox([l.x1, l.y1], [l.x2, l.y2], b)).toBe(false);
    expect(segmentHitsBox([l.x1, l.y1], [l.x3, l.y3], b)).toBe(false);
    const cx = b[0] + b[2] / 2;
    const cy = b[1] + b[3] / 2;
    expect(Math.hypot(cx - l.x1, cy - l.y1)).toBeGreaterThanOrEqual(24);
  });
});
