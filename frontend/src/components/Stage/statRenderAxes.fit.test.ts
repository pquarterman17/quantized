// P2.6 box 1 leftover — long upright category labels wrap or rotate on the
// Stat Stage canvas (`statRenderAxes` header): with neither option chosen a
// draw's marks opt the axis into the shared rule (`axisStyleOf` -> `fit:
// "auto"`), which `plotRect`, the painter and the hit-test all apply over
// the SAME slot pitch (`slotPitch`) and the SAME text widths (`labelWidth`).
// This file installs its own measurer (`setLabelMeasurer`: a "W" is twice
// as wide as any other glyph), which is what the rotated depth and the fit
// read — the other files run on the setup's monospace estimate.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveStatMarks } from "../../lib/statMarks";
import type { BoxStat } from "../../lib/statstage";
import { axisStyleOf } from "./statDrawMarks";
import { monospaceEstimate, setLabelMeasurer } from "./statLabelMetrics";
import { draw, paintedAxisRotation, plotRect, type StatDrawData } from "./statRender";
import { categoryAxisLayout, drawCategoryAxis, labelWidth, slotPitch } from "./statRenderAxes";

const GLYPH = 6;
const width = (t: string) => Array.from(t).reduce((w, ch) => w + (ch === "W" ? 2 * GLYPH : GLYPH), 0);

/** A recording 2D context: every member is a no-op except `fillText`,
 *  kept with the rotation in force. */
function recordingCtx() {
  const texts: { text: string; rot: number }[] = [];
  let rot = 0;
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_t, k) => {
      if (k === "rotate") return (a: number) => { rot += a; };
      if (k === "save") return () => { rot = 0; };
      if (k === "restore") return () => { rot = 0; };
      if (k === "fillText") return (text: string) => texts.push({ text, rot: Math.round((rot * 180) / Math.PI) });
      return () => undefined;
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

beforeAll(() => setLabelMeasurer(width));
afterAll(() => setLabelMeasurer(monospaceEstimate));

const BOX: BoxStat = {
  label: "", q1: 3.5, median: 6, q3: 8.5, iqr: 5, whislo: 1, whishi: 10, mean: 6.2, sem: 0.9, ciLo: 4.3, ciHi: 8.1,
  n: 11, fliers: [],
};
const LONG = ["Anneal temperature under vacuum 450 C", "Anneal temperature under vacuum 500 C"];
const WRAPPABLE = ["Anneal temperature 450 C", "Anneal temperature 500 C"];
function boxDraw(labels: string[], marks = resolveStatMarks("box", {})): StatDrawData {
  return { mode: "box", boxes: labels.map((label) => ({ ...BOX, label })), valueLabel: "v", groupLabel: "g", marks };
}

describe("labelWidth measures with the canvas's own text metrics", () => {
  it("a W is twice as wide as an i (the mock), and a count could not tell", () => {
    expect(labelWidth("WWWW")).toBe(2 * labelWidth("iiii"));
  });
  it("a rotated label's depth follows the measured width, not the character count", () => {
    const narrow = categoryAxisLayout(["iiiiiiii"], { rotation: 90 });
    const wide = categoryAxisLayout(["WWWWWWWW"], { rotation: 90 });
    expect(wide.depth).toBe(Math.ceil(16 * GLYPH));
    expect(narrow.depth).toBe(Math.ceil(8 * GLYPH));
    expect(categoryAxisLayout(["iiiiiiii"]).depth).toBe(categoryAxisLayout(["WWWWWWWW"]).depth);
  });
});

describe("fit: auto on the canvas — the draw's marks opt in, the rect's pitch decides", () => {
  it("axisStyleOf opts a draw in exactly when neither rotation nor wrap is chosen", () => {
    expect(axisStyleOf(boxDraw(["a"]))).toMatchObject({ rotation: 0, wrap: false, fit: "auto" });
    expect(axisStyleOf(boxDraw(["a"], resolveStatMarks("box", { labelRotation: 45 })))).not.toHaveProperty("fit");
    expect(axisStyleOf(boxDraw(["a"], resolveStatMarks("box", { labelWrap: true })))).not.toHaveProperty("fit");
    expect(axisStyleOf({ mode: "box", boxes: [BOX], valueLabel: "v", groupLabel: "g" })).not.toHaveProperty("fit");
  });

  it("long labels on a narrow canvas rotate 45; the same labels on a wide one stay upright and whole", () => {
    const d = boxDraw(LONG);
    expect(paintedAxisRotation(300, 600, d)).toBe(45);
    expect(paintedAxisRotation(1200, 600, d)).toBe(0);
    // Tall enough that the canvas cap (`maxBottom`) leaves the rotated
    // label whole — the cap's own cut is `statRender.test.ts`'s subject.
    const narrow = plotRect(300, 600, d);
    const layout = categoryAxisLayout(LONG, axisStyleOf(d), narrow.maxBottom, slotPitch(narrow, 2));
    expect(layout.rotation).toBe(45);
    expect(layout.lines).toEqual(LONG.map((l) => [l]));
    // The rect's own margin IS that rotated layout's bottom (one number),
    // and the depth is the MEASURED width turned 45 degrees.
    expect(600 - narrow.y - narrow.h).toBe(layout.bottom);
    expect(layout.depth).toBe(Math.ceil((width(LONG[0]) + 11) * Math.SQRT1_2));
    const wide = plotRect(1200, 600, d);
    expect(categoryAxisLayout(LONG, axisStyleOf(d), wide.maxBottom, slotPitch(wide, 2)).lines).toEqual(LONG.map((l) => [l]));
  });

  it("labels that wrap within three fitting lines wrap instead of turning", () => {
    const d = boxDraw(WRAPPABLE);
    const rect = plotRect(220, 400, d); // pitch ~ 90 px: 24 chars (144 px) too wide, 'temperature' (66 px) fits
    const layout = categoryAxisLayout(WRAPPABLE, axisStyleOf(d), rect.maxBottom, slotPitch(rect, 2));
    expect(layout).toMatchObject({ rotation: 0, wrap: true });
    expect(layout.lines[0]).toEqual(["Anneal", "temperature", "450 C"]);
  });

  it("an explicit rotation is the user's: never changed by the rule", () => {
    const d = boxDraw(["a", "b"], resolveStatMarks("box", { labelRotation: 90 }));
    expect(paintedAxisRotation(1200, 400, d)).toBe(90);
  });

  it("without a pitch (a caller predating the rule) the options apply as given", () => {
    expect(categoryAxisLayout(LONG, { fit: "auto" }).rotation).toBe(0);
  });

  it("the painter draws the rotation the layout chose, and draw() publishes it on the host", () => {
    const d = boxDraw(LONG);
    const rect = plotRect(300, 600, d);
    const { ctx, texts } = recordingCtx();
    drawCategoryAxis(ctx, rect, [{ cx: 0.25 }, { cx: 0.75 }], LONG, "g", "#000", "#888", axisStyleOf(d));
    expect(texts.filter((t) => t.text !== "g").map((t) => t.rot)).toEqual([-45, -45]);
    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { value: 300 });
    Object.defineProperty(host, "clientHeight", { value: 600 });
    const canvas = document.createElement("canvas");
    draw(canvas, host, d);
    expect(host.dataset.axisRotation).toBe("45");
    draw(canvas, host, null);
    expect(host.dataset.axisRotation).toBeUndefined();
  });
});
