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

function mockCtx(): RichTextCtx & { calls: Call[] } {
  const calls: Call[] = [];
  const ctx: RichTextCtx & { calls: Call[] } = {
    font: "",
    fillStyle: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    calls,
    fillText(text: string, x: number, y: number): void {
      calls.push({ text, x, y, font: ctx.font });
    },
    measureText(text: string): TextMetrics {
      const m = /(\d+(?:\.\d+)?)px/.exec(ctx.font);
      const px = m ? parseFloat(m[1]) : 10;
      return { width: text.length * px } as TextMetrics;
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
  });
});
