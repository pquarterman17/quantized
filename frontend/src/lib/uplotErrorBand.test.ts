// Origin gap audit 4 G8 (the Y error as a shaded band) and G10 (symbol edge /
// fill / opacity / every N), the canvas half. Screen == export is the shared
// wire fixture (`seriesRampSymbolsBandFixture.test.ts`).

import { render } from "@testing-library/react";
import { createElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import LegendSample from "../components/Stage/LegendSample";
import { buildExportStyles } from "./exportStyles";
import { seriesStyleFromExport } from "./graphFormat";
import { blocksDecimation, loadMarks, usesMarks } from "./marksLoader";
import { regionDecorSettled } from "./regionDecorLoader";
import { markerPaths, seriesPoints } from "./markers";
import { sanitizeExportSeriesStyles } from "./publicationStyles";
import { bandQuads } from "./uplotErrorBand";
import { errorBarsPlugin, errorSpansPlugin } from "./uplotOverlays";
import { everyNth, symbolPoints } from "./symbolDetails";

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.Path2D ??= class { moveTo() {} lineTo() {} closePath() {} };
});

beforeAll(async () => {
  await Promise.all([loadMarks(), regionDecorSettled]); // the symbol details' chunk; the bars' and the band's
});

/** Call one of a plugin's hooks (a single function, as these plugins register). */
const run = (p: { hooks: object }, k: "draw" | "drawAxes", u: never) => (p.hooks as Record<string, ((u: never) => void) | undefined>)[k]?.(u);

/** A uPlot stand-in that records what its canvas is asked to do. */
function fakeU(xs: number[], ys: (number | null)[], qzErr?: object) {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => calls.push(`${k}${k === "lineTo" || k === "moveTo" ? `(${a.join(",")})` : ""}`)),
    set: (t, k: string, v) => ((t[k] = v), true),
  });
  return {
    u: {
      ctx, bbox: { left: 0, top: 0, width: 100, height: 100 }, data: [xs, ys],
      series: [{}, { scale: "y", show: true, stroke: () => "#123456", qzErr }],
      valToPos: (v: number) => v,
    },
    calls, ctx,
  };
}

describe("error band (G8)", () => {
  it("quads follow ROW order on a loop and break at a null", () => {
    const q = bandQuads([0, 1, 2, 1, 0], [0, 1, 0, -1, 0], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1]);
    expect(q.map((s) => s[0])).toEqual([0, 1, 1, 0]); // the return branch is its own quads, from its lower-X end
    expect(q[2]).toEqual([1, 0, 2, 1, -1, -2]);
    expect(bandQuads([0, 1, 2], [0, null, 0], [1, 1, 1], [1, 1, 1])).toEqual([]);
    expect(bandQuads([2, 1], [0, 0], [null, 1], [1, null])).toEqual([[1, 1, 2, 0, -1, 0]]); // a missing side is 0
  });

  it("a band column is filled under the lines (drawAxes) and gets no Y bars; X spans stay bars", () => {
    const spans = new Map([[1, [
      { axis: "y" as const, plus: [1, 1], minus: [1, 1] },
      { axis: "x" as const, plus: [0.5, 0.5], minus: [0.5, 0.5] },
    ]]]);
    const p = errorSpansPlugin(spans, "#888", 3);
    const band = fakeU([0, 10], [5, 5], { band: true });
    run(p, "drawAxes", band.u as never);
    expect(band.calls).toContain("fill");
    expect(band.ctx.fillStyle).toBe("color-mix(in oklab, #123456 25%, transparent)");
    band.calls.length = 0;
    run(p, "draw", band.u as never);
    const vertical = band.calls.filter((c) => c === "lineTo(0,6)" || c === "lineTo(10,6)");
    expect(vertical).toEqual([]); // no Y whisker from 4 to 6
    expect(band.calls).toContain("lineTo(0.5,5)"); // the X bar
    const bars = fakeU([0, 10], [5, 5]);
    run(p, "drawAxes", bars.u as never);
    expect(bars.calls).not.toContain("fill");
    run(p, "draw", bars.u as never);
    expect(bars.calls).toContain("lineTo(0,6)");
  });

  it("the legacy symmetric plugin bands too", () => {
    const p = errorBarsPlugin(new Map([[1, [1, 1]]]), "#888");
    const band = fakeU([0, 10], [5, 5], { band: true, color: "#ff0000" });
    run(p, "drawAxes", band.u as never);
    expect(band.ctx.fillStyle).toBe("color-mix(in oklab, #ff0000 25%, transparent)");
    band.calls.length = 0;
    run(p, "draw", band.u as never);
    expect(band.calls.filter((c) => c.startsWith("lineTo"))).toEqual([]);
  });

  it("rides the export request and the saved styles", () => {
    expect(buildExportStyles([0], { 0: { errorBar: { band: true } } })[0]).toMatchObject({ error_band: true });
    expect(sanitizeExportSeriesStyles([{ error_band: true }])).toEqual([{ error_band: true }]); // validated by the backend
    expect(seriesStyleFromExport({ error_band: true })?.errorBar?.band).toBe(true);
  });
});

describe("symbol details (G10)", () => {
  const pts = (style: Parameters<typeof seriesPoints>[0]) =>
    symbolPoints(seriesPoints(style, "Line", "#f00"), style, "#f00", (c) => `R${c}`);

  it("edge, fill colour and fill opacity reach the points; the edge stays opaque", () => {
    const sq = pts({ marker: true, markerShape: "square", markerAlpha: 0.3, markerEdge: "#00f", markerFillColor: "#0f0" });
    expect(sq.stroke).toBe("R#00f"); // resolved for the canvas by the caller's resolver
    expect(sq.fill).toBe("color-mix(in oklab, R#0f0 30%, transparent)");
    expect(pts({ marker: true, markerAlpha: 0.5 })).toMatchObject({ stroke: "#f00", fill: "color-mix(in oklab, #f00 50%, transparent)" });
    expect(pts({ marker: true, markerFill: "hollow", markerEdge: "#00f" })).toMatchObject({ stroke: "R#00f", fill: "transparent" });
    expect(pts({ marker: true, markerShape: "plus", markerFillColor: "#0f0" }).fill).toBeUndefined(); // an open glyph has no fill
    expect(pts({ marker: true })).toEqual({ show: true, size: 5 }); // unset: unchanged
    expect(usesMarks({ markerAlpha: 0.5 }) && !usesMarks({ marker: true })).toBe(true);
  });

  it("every N counts the drawn points in row order, over all rows", () => {
    const f = everyNth(2) as (u: unknown, s: number) => number[];
    expect(f({ data: [[0, 1, 2, 3, 4, 5], [1, null, 3, 4, NaN, 6]] }, 1)).toEqual([0, 3]);
    expect(typeof pts({ marker: true, markerEvery: 3 }).filter).toBe("function");
    expect(pts({ marker: true, markerEvery: 1 }).filter).toBeUndefined();
    expect(blocksDecimation([{ markerEvery: 4 }], 1e6)).toBe(true); // row-indexed: no decimated payload
  });

  it("a glyph path builder draws only the filtered rows", () => {
    const moves: number[] = [];
    const g = globalThis as unknown as { Path2D: unknown };
    const saved = g.Path2D;
    g.Path2D = class { moveTo(x: number) { moves.push(x); } lineTo() {} closePath() {} };
    const build = markerPaths("square", 4)!;
    build({ data: [[0, 10, 20, 30], [1, 1, 1, 1]], series: [{}, { scale: "y" }], valToPos: (v: number) => v } as never, 1, 0, 3, [1, 3]);
    g.Path2D = saved;
    expect(moves).toEqual([8, 28]); // squares around x 10 and 30 (r = 2)
  });

  it("the export request, saved styles and templates carry the details as hex", () => {
    const [spec] = buildExportStyles([0], { 0: { marker: true, markerEdge: "#112233", markerFillColor: "#AABBCC", markerAlpha: 0.25, markerEvery: 5 } });
    expect(spec).toMatchObject({ marker_edge: "#112233", marker_face: "#aabbcc", marker_alpha: 0.25, marker_every: 5 });
    expect(buildExportStyles([0], { 0: { markerEvery: 1 } })[0]?.marker_every).toBeUndefined();
    expect(sanitizeExportSeriesStyles([{ marker_alpha: 0.5, marker_every: 3, marker_edge: "#000000" }]))
      .toEqual([{ marker_alpha: 0.5, marker_every: 3, marker_edge: "#000000" }]); // validated by the backend (calc.figure_symbols)
    expect(seriesStyleFromExport({ marker_edge: "#010203", marker_face: "#040506", marker_alpha: 0.4, marker_every: 2 }))
      .toEqual({ markerEdge: "#010203", markerFillColor: "#040506", markerAlpha: 0.4, markerEvery: 2 });
  });

  it("the legend swatch shows the edge, the fill and its opacity", () => {
    const { container } = render(createElement(LegendSample, {
      color: "#f00", style: { marker: true, markerEdge: "--series-2", markerFillColor: "#00ff00", markerAlpha: 0.4 },
    }));
    const c = container.querySelector("circle")!;
    expect(c.getAttribute("stroke")).toBe("var(--series-2)");
    expect(c.getAttribute("fill")).toBe("#00ff00");
    expect(c.getAttribute("fill-opacity")).toBe("0.4");
  });
});
