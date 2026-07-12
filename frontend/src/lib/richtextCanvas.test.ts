// Canvas measurer/drawer sanity. jsdom has no real 2-D text metrics, so ctx
// is a mock whose measureText derives width from the CURRENT font size
// (10 px per char per 10 px of font) — enough to verify script scaling,
// baseline offsets, italic font strings, and centering math. Real visible
// rendering is exercised only in a browser (honest jsdom limit).

import { describe, expect, it } from "vitest";

import { parseRichText } from "./richtext";
import {
  drawRich,
  measureRich,
  measureRichBox,
  SCRIPT_SCALE,
  SCRIPT_SHIFT_EM,
  type RichTextCtx,
} from "./richtextCanvas";

interface Call {
  text: string;
  x: number;
  y: number;
  font: string;
}
interface Seg {
  x: number;
  y: number;
}

function mockCtx(): RichTextCtx & { calls: Call[]; segs: Seg[]; strokes: number } {
  const calls: Call[] = [];
  const segs: Seg[] = []; // moveTo/lineTo points, for rule/radical assertions
  const ctx: RichTextCtx & { calls: Call[]; segs: Seg[]; strokes: number } = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    textAlign: "start",
    textBaseline: "alphabetic",
    calls,
    segs,
    strokes: 0,
    fillText(text: string, x: number, y: number): void {
      calls.push({ text, x, y, font: ctx.font });
    },
    measureText(text: string): TextMetrics {
      const m = /(\d+(?:\.\d+)?)px/.exec(ctx.font);
      const px = m ? parseFloat(m[1]) : 10;
      return { width: text.length * px } as TextMetrics;
    },
    beginPath(): void {},
    moveTo(x: number, y: number): void {
      segs.push({ x, y });
    },
    lineTo(x: number, y: number): void {
      segs.push({ x, y });
    },
    stroke(): void {
      ctx.strokes += 1;
    },
  };
  return ctx;
}

const FONT = { px: 10, family: "ui", weight: "600" };

describe("measureRich", () => {
  it("advances scripts at SCRIPT_SCALE of the current size", () => {
    const ctx = mockCtx();
    const ast = parseRichText("$x^{2}$").nodes;
    // "x" at 10px (width 10) + "2" at 7px (width 7)
    expect(measureRich(ctx, ast, FONT)).toBeCloseTo(10 + 10 * SCRIPT_SCALE, 6);
  });

  it("scales nested scripts multiplicatively", () => {
    const ctx = mockCtx();
    const ast = parseRichText("$x_{a_{b}}$").nodes;
    expect(measureRich(ctx, ast, FONT)).toBeCloseTo(10 + 7 + 7 * SCRIPT_SCALE, 6);
  });

  it("measures plain runs at the base size", () => {
    const ctx = mockCtx();
    const ast = parseRichText("abc").nodes;
    expect(measureRich(ctx, ast, FONT)).toBe(30);
  });
});

describe("drawRich", () => {
  it("offsets sup up and sub down by SCRIPT_SHIFT_EM of the parent size", () => {
    const ctx = mockCtx();
    const ast = parseRichText("$x^{2}_{3}$").nodes;
    drawRich(ctx, ast, 0, 100, FONT, "#eee");
    const [xCall, supCall, subCall] = ctx.calls;
    expect(xCall.y).toBe(100);
    expect(supCall.y).toBeCloseTo(100 - SCRIPT_SHIFT_EM * 10, 6);
    expect(subCall.y).toBeCloseTo(100 + SCRIPT_SHIFT_EM * 10, 6);
  });

  it("accumulates nested script offsets from the nested level's own size", () => {
    const ctx = mockCtx();
    const ast = parseRichText("$x^{a^{b}}$").nodes;
    drawRich(ctx, ast, 0, 0, FONT, "#eee");
    const b = ctx.calls.find((c) => c.text === "b")!;
    expect(b.y).toBeCloseTo(-SCRIPT_SHIFT_EM * 10 - SCRIPT_SHIFT_EM * 7, 6);
    // 10 * 0.7 * 0.7 (float: 4.899999...) — parse the size back out.
    const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(b.font)![1]);
    expect(px).toBeCloseTo(4.9, 6);
  });

  it("uses an italic font slot for italic runs only", () => {
    const ctx = mockCtx();
    const ast = parseRichText("$x=2$").nodes;
    drawRich(ctx, ast, 0, 0, FONT, "#eee");
    const italicCalls = ctx.calls.filter((c) => c.font.startsWith("italic "));
    expect(italicCalls.map((c) => c.text)).toEqual(["x"]);
    const upright = ctx.calls.find((c) => c.text === "=2")!;
    expect(upright.font).toBe("600 10px ui");
  });

  it("centers the total advance on x when align is center", () => {
    const ctx = mockCtx();
    const ast = parseRichText("abcd").nodes; // width 40 at 10px
    const w = drawRich(ctx, ast, 100, 0, FONT, "#eee", "center");
    expect(w).toBe(40);
    expect(ctx.calls[0].x).toBe(80);
  });

  it("sets left/alphabetic anchoring and the fill color", () => {
    const ctx = mockCtx();
    drawRich(ctx, parseRichText("q").nodes, 0, 0, FONT, "#abc");
    expect(ctx.textAlign).toBe("left");
    expect(ctx.textBaseline).toBe("alphabetic");
    expect(ctx.fillStyle).toBe("#abc");
    expect(ctx.strokeStyle).toBe("#abc"); // rules/radical share the ink color
  });
});

describe("fractions (MAIN #28)", () => {
  it("measures a fraction wider and taller than a single line", () => {
    const ctx = mockCtx();
    const ast = parseRichText("$\\frac{M}{M_s}$").nodes;
    const box = measureRichBox(ctx, ast, FONT);
    // content = max(numWidth 10, denWidth 17) + 2*pad(1.4) = 19.8
    expect(box.width).toBeCloseTo(17 + 2 * 0.14 * 10, 6);
    // both arms clear the baseline: taller above AND below than a plain glyph.
    expect(box.ascent).toBeGreaterThan(0.78 * 10);
    expect(box.descent).toBeGreaterThan(0.22 * 10);
  });

  it("draws the rule on the math axis with num above and den below", () => {
    const ctx = mockCtx();
    const ast = parseRichText("$\\frac{1}{2}$").nodes;
    drawRich(ctx, ast, 0, 100, FONT, "#eee");
    expect(ctx.strokes).toBeGreaterThanOrEqual(1);
    const num = ctx.calls.find((c) => c.text === "1")!;
    const den = ctx.calls.find((c) => c.text === "2")!;
    expect(num.y).toBeLessThan(100); // numerator above the baseline
    expect(den.y).toBeGreaterThan(100); // denominator below it
    // the rule sits between them, above the baseline (math axis).
    const barY = 100 - 0.28 * 10;
    expect(ctx.segs.some((s) => Math.abs(s.y - barY) < 1e-6)).toBe(true);
    expect(num.y).toBeLessThan(barY);
    expect(den.y).toBeGreaterThan(barY);
  });
});

describe("radicals (MAIN #28)", () => {
  it("reserves the radical lead width + overline height", () => {
    const ctx = mockCtx();
    const box = measureRichBox(ctx, parseRichText("$\\sqrt{x}$").nodes, FONT);
    // lead(5.5) + radicand(10) + tail(1.2)
    expect(box.width).toBeCloseTo(0.55 * 10 + 10 + 0.12 * 10, 6);
    expect(box.ascent).toBeGreaterThan(0.78 * 10); // overline sits above the radicand
    expect(box.descent).toBeCloseTo(0.22 * 10, 6);
  });

  it("strokes the radical and draws the radicand inset by the lead", () => {
    const ctx = mockCtx();
    drawRich(ctx, parseRichText("$\\sqrt{x}$").nodes, 0, 50, FONT, "#eee");
    expect(ctx.strokes).toBeGreaterThanOrEqual(1);
    const x = ctx.calls.find((c) => c.text === "x")!;
    expect(x.x).toBeCloseTo(0.55 * 10, 6); // radicand starts after the radical
    expect(x.y).toBe(50); // radicand on the baseline
  });

  it("draws the root index small and above the baseline for \\sqrt[3]{}", () => {
    const ctx = mockCtx();
    drawRich(ctx, parseRichText("$\\sqrt[3]{x}$").nodes, 0, 50, FONT, "#eee");
    const idx = ctx.calls.find((c) => c.text === "3")!;
    const idxPx = parseFloat(/(\d+(?:\.\d+)?)px/.exec(idx.font)![1]);
    expect(idxPx).toBeCloseTo(0.55 * 10, 6); // INDEX_SCALE of the level
    expect(idx.y).toBeLessThan(50); // tucked above the baseline in the crook
  });
});
