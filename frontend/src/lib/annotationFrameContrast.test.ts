// Audit #11: an inserted text box drew light ink text on a near-white box on
// the dark canvas (the frame's fill defaulted to its stroke = the ink). It is
// now ink text on the plot's PAPER colour (the axes background token) with an
// ink border — the export's white card with a black border, on every theme.

import { describe, expect, it } from "vitest";

import { annotationPlugin, resolveFrameFill } from "./uplotOverlays";
import type { Annotation } from "./types";

function drawBox(paperColor?: string, frame: Annotation["frame"] = { opacity: 0.9 }) {
  const rects: { fill: string; stroke: string }[] = [];
  let textColor = "";
  const stack: [string, string][] = [];
  const ctx = {
    save() {
      stack.push([ctx.fillStyle, ctx.strokeStyle]);
    },
    restore() {
      [ctx.fillStyle, ctx.strokeStyle] = stack.pop() ?? [ctx.fillStyle, ctx.strokeStyle];
    },
    beginPath() {}, fill() {}, arc() {},
    measureText: (t: string) => ({ width: t.length * 6 }) as TextMetrics,
    fillText() {
      textColor = String(ctx.fillStyle);
    },
    fillRect() {
      rects.push({ fill: String(ctx.fillStyle), stroke: String(ctx.strokeStyle) });
    },
    strokeRect() {},
    fillStyle: "" as string, strokeStyle: "" as string, font: "", lineWidth: 1, globalAlpha: 1,
    textBaseline: "" as CanvasTextBaseline, textAlign: "left" as CanvasTextAlign,
  };
  const u = { ctx, bbox: { left: 10, top: 5, width: 100, height: 80 }, valToPos: (v: number, s: string) => (s === "x" ? v : 100 - v), scales: { x: {}, y: {} } };
  const plugin = annotationPlugin([{ id: "a", x: 40, y: 50, text: "τ = 2.0 s", frame }], "#e8e8ee", "11px mono", { paperColor });
  // @ts-expect-error — minimal stub stands in for a real uPlot instance
  plugin.hooks.draw?.(u);
  return { rects, textColor };
}

describe("text box contrast", () => {
  it("fills with the plot's paper colour behind ink text and an ink border", () => {
    const { rects, textColor } = drawBox("#13131a");
    expect(rects).toEqual([{ fill: "#13131a", stroke: "#e8e8ee" }]);
    expect(textColor).toBe("#e8e8ee");
    expect(rects[0].fill).not.toBe(textColor);
  });

  it("an explicit fill still wins", () => {
    expect(drawBox("#13131a", { fill: "#ffee00" }).rects[0].fill).toBe("#ffee00");
    expect(resolveFrameFill({}, "#f7f7fa")).toBe("#f7f7fa");
  });
});
