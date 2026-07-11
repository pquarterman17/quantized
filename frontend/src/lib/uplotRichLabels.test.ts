// richLabelsPlugin geometry + DOM-title swap, against a stub uPlot instance
// (uPlot itself never runs in jsdom). Verifies the draw hook replicates
// uPlot's own label pass: centered on the plot area, positioned off the
// axis's internal _lpos, rotated for vertical sides — and that the init hook
// swaps the .u-title DOM content for rich nodes.

import { describe, expect, it } from "vitest";
import type uPlot from "uplot";

import { parseRichText } from "./richtext";
import { richDomFragment, richLabelsPlugin } from "./uplotRichLabels";

interface Call {
  text: string;
  x: number;
  y: number;
  font: string;
}

interface MockCtx {
  font: string;
  fillStyle: string;
  textAlign: string;
  textBaseline: string;
  calls: Call[];
  ops: string[];
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(a: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): TextMetrics;
}

function mockCtx(): MockCtx {
  const calls: Call[] = [];
  const ops: string[] = [];
  const ctx: MockCtx = {
    font: "",
    fillStyle: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    calls,
    ops,
    save(): void {
      ops.push("save");
    },
    restore(): void {
      ops.push("restore");
    },
    translate(x: number, y: number): void {
      ops.push(`translate(${x},${y})`);
    },
    rotate(a: number): void {
      ops.push(`rotate(${a.toFixed(4)})`);
    },
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

const STYLE = { px: 14, family: "ui", color: "#aaa", weight: "600" };

function stubU(ctx: ReturnType<typeof mockCtx>, axes: object[]): uPlot {
  return {
    ctx,
    axes,
    bbox: { left: 40, top: 10, width: 500, height: 300 },
    root: document.createElement("div"),
  } as unknown as uPlot;
}

function drawHook(plugin: uPlot.Plugin): (u: uPlot) => void {
  return plugin.hooks.draw as (u: uPlot) => void;
}

describe("richLabelsPlugin draw", () => {
  it("draws the x label centered under the plot at the axis _lpos band", () => {
    const ctx = mockCtx();
    const ast = parseRichText("$M_s$").nodes;
    const plugin = richLabelsPlugin({ x: ast }, STYLE);
    const u = stubU(ctx, [{ side: 2, _lpos: 430, labelGap: 0 }]);
    drawHook(plugin)(u);
    expect(ctx.calls.length).toBeGreaterThan(0);
    // TOP baseline at _lpos converts to alphabetic via the ascent fraction.
    expect(ctx.calls[0].y).toBeCloseTo(430 + 0.78 * 14, 3);
    // Centered on the plot area: total advance M(14) + s(9.8) = 23.8.
    const w = 14 + 14 * 0.7;
    expect(ctx.calls[0].x).toBeCloseTo(Math.round(40 + 500 / 2) - w / 2, 3);
    // No rotation for a horizontal axis.
    expect(ctx.ops.some((op) => op.startsWith("rotate"))).toBe(false);
    expect(ctx.ops[0]).toBe("save");
    expect(ctx.ops[ctx.ops.length - 1]).toBe("restore");
  });

  it("rotates -90deg around the label band for the left y axis", () => {
    const ctx = mockCtx();
    const ast = parseRichText("$\\chi''$").nodes;
    const plugin = richLabelsPlugin({ y: ast }, STYLE);
    const u = stubU(ctx, [{ side: 2, _lpos: 430 }, { side: 3, _lpos: 12 }]);
    drawHook(plugin)(u);
    expect(ctx.ops).toContain(`translate(12,${Math.round(10 + 300 / 2)})`);
    expect(ctx.ops).toContain(`rotate(${(-Math.PI / 2).toFixed(4)})`);
    expect(ctx.calls.length).toBeGreaterThan(0);
  });

  it("rotates +90deg for the right y2 axis", () => {
    const ctx = mockCtx();
    const ast = parseRichText("$T$ (K)").nodes;
    const plugin = richLabelsPlugin({ y2: ast }, STYLE);
    const u = stubU(ctx, [
      { side: 2, _lpos: 430 },
      { side: 3, _lpos: 12 },
      { side: 1, _lpos: 590 },
    ]);
    drawHook(plugin)(u);
    expect(ctx.ops).toContain(`rotate(${(Math.PI / 2).toFixed(4)})`);
  });

  it("skips axes without a reserved label band (_lpos missing)", () => {
    const ctx = mockCtx();
    const plugin = richLabelsPlugin({ x: parseRichText("$q$").nodes }, STYLE);
    drawHook(plugin)(stubU(ctx, [{ side: 2 }]));
    expect(ctx.calls).toHaveLength(0);
  });
});

describe("richLabelsPlugin init (DOM title swap)", () => {
  it("replaces .u-title text with rich nodes", () => {
    const ast = parseRichText("$\\mu_0H$ loop").nodes;
    const plugin = richLabelsPlugin({ title: ast }, STYLE);
    const root = document.createElement("div");
    const titleEl = document.createElement("div");
    titleEl.className = "u-title";
    titleEl.textContent = "$\\mu_0H$ loop";
    root.appendChild(titleEl);
    const u = { root } as unknown as uPlot;
    (plugin.hooks.init as (u: uPlot) => void)(u);
    expect(titleEl.querySelector("i")?.textContent).toBe("μ");
    expect(titleEl.querySelector("sub")?.textContent).toBe("0");
    expect(titleEl.textContent).toContain("loop");
    expect(titleEl.textContent).not.toContain("$");
  });
});

describe("richDomFragment", () => {
  it("builds nested sub/sup with the 0.7em scale", () => {
    const frag = richDomFragment(parseRichText("$x_{a_{b}}$").nodes, document);
    const host = document.createElement("span");
    host.appendChild(frag);
    const sub = host.querySelector<HTMLElement>("sub")!;
    expect(sub.style.fontSize).toBe("0.7em");
    expect(sub.querySelector("sub")?.textContent).toBe("b");
  });
});
