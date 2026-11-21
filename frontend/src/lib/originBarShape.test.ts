// An Origin column chart on the Stat Stage (`originFigureSelection.
// figureBarState`): the 100 % stack (`barMatrix.percentBars`), the layer's
// fixed Y range (`statDrawMarks.barDomain`, clipped on screen, `y_domain` on
// export) and both picks surviving a save / reopen (`sanitizeStatPicks`).
import { describe, expect, it, vi } from "vitest";

import { drawBar } from "../components/Stage/statRenderBar";
import { barDomain } from "../components/Stage/statDrawMarks";
import type { StatDrawData } from "../components/Stage/statRender";
import type { BarChartData } from "./barlayout";
import { percentBars, seriesStat } from "./barMatrix";
import { sanitizeStatPicks } from "./plotviewSanitize";

const bars = (rows: number[][]): BarChartData => ({
  groups: rows.map((r, i) => ({ label: `g${i}`, series: r.map((v) => seriesStat([v])) })),
  seriesLabels: rows[0].map((_, i) => `s${i}`),
});

describe("percentBars (Origin's 100 % stacked column)", () => {
  it("scales every category's series to shares of its stacked total", () => {
    const out = percentBars(bars([[1, 3], [2, 2], [5, 15]]));
    expect(out.groups.map((g) => g.series.map((s) => s.mean))).toEqual([[25, 75], [50, 50], [25, 75]]);
    expect(out.groups[0].series[0].n).toBe(1);
  });

  it("a missing series counts 0; a category with nothing to share draws nothing", () => {
    const d = bars([[2, 2], [0, 0]]);
    d.groups[0].series[1] = seriesStat([]);
    const out = percentBars(d);
    expect(out.groups[0].series[0].mean).toBe(100);
    expect(Number.isNaN(out.groups[0].series[1].mean)).toBe(true);
    expect(out.groups[1].series.every((s) => Number.isNaN(s.mean))).toBe(true);
  });
});

const draw = (valueRange?: [number, number]): Extract<StatDrawData, { mode: "bar" }> => ({
  mode: "bar", data: bars([[70, 72]]), valueLabel: "y", groupLabel: "x", stacked: false, valueRange,
});

/** Every method a spy (measureText answers a width), every property settable. */
function fakeCtx(): CanvasRenderingContext2D {
  const t: Record<string | symbol, unknown> = {};
  return new Proxy(t, {
    get: (o, k) => (k in o ? o[k] : (o[k] = vi.fn(() => ({ width: 10 })))),
    set: (o, k, v) => ((o[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
}

describe("the bar chart's value axis", () => {
  it("is the saved Origin Y range when there is one, else autoscaled from 0", () => {
    expect(barDomain(draw([65, 75]))).toEqual([65, 75]);
    const auto = barDomain(draw());
    expect(auto[0]).toBeLessThanOrEqual(0);
    expect(auto[1]).toBeGreaterThan(72);
  });

  it("clips the bars to the plot frame only under a fixed range", () => {
    const ctx = fakeCtx();
    const rect = { x: 10, y: 10, w: 200, h: 100 };
    drawBar(ctx, rect, draw([65, 75]), "#000", "#888");
    expect(ctx.clip).toHaveBeenCalledTimes(1);
    expect(ctx.rect).toHaveBeenCalledWith(10, 10, 200, 100);
    expect(ctx.restore).toHaveBeenCalled();
    const plain = fakeCtx();
    drawBar(plain, rect, draw(), "#000", "#888");
    expect(plain.clip).not.toHaveBeenCalled();
  });
});

describe("the picks survive a save / reopen", () => {
  it("keeps barPercent and a finite ascending valueRange, drops anything else", () => {
    const saved = { mode: "bar" as const, barStack: true, barPercent: true, valueRange: [0, 100] as [number, number] };
    expect(sanitizeStatPicks(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    for (const valueRange of [[100, 0], [0], [0, "1"], [0, null], "0..1"]) {
      expect(sanitizeStatPicks({ valueRange }).valueRange).toBeUndefined();
    }
    expect(sanitizeStatPicks({ barPercent: "yes" }).barPercent).toBeUndefined();
  });
});
