// Plan item 24: the pure rules and the hook wiring that the wire fixture does not reach.

import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { equalAspectPlugin, equalAspectRange } from "./axisEqualAspect";
import { inheritedAxisFormat, sanitizeAxisExtras } from "./axisFormat";
import { cleanSymbols, validText } from "./symbolSanitize";
import { stackTotalLabel } from "./uplotStackTotals";
import { TEXT_SYMBOL_MAX, textSymbolRows, textSymbolSpec } from "./uplotTextSymbols";

describe("equal aspect", () => {
  it("widens the smaller-span axis about its centre and never crops", () => {
    expect(equalAspectRange([0, 10], [0, 5], 400, 300)).toEqual({ x: [0, 10], y: [-1.25, 6.25] });
    const flat = equalAspectRange([0, 10], [0, 5], 500, 100)!;
    expect(flat.y).toEqual([0, 5]);
    expect(flat.x[1] - flat.x[0]).toBeCloseTo(25, 12);
  });

  it("refits after a scale change in a microtask, once, without re-entering", async () => {
    const setScale = vi.fn();
    const plugin = equalAspectPlugin();
    const hook = plugin.hooks.setScale as ((u: uPlot, key?: string) => void) | undefined;
    const u = {
      scales: { x: { min: 0, max: 10 }, y: { min: 0, max: 5 } },
      bbox: { width: 400, height: 300 },
      batch: (fn: () => void) => { fn(); hook!(u, "x"); }, // uPlot fires setScale inside the batch
      setScale,
    } as unknown as uPlot;
    hook!(u, "x");
    hook!(u, "y2"); // another scale: ignored
    await Promise.resolve();
    expect(setScale).toHaveBeenCalledTimes(2);
    expect(setScale).toHaveBeenCalledWith("y", { min: -1.25, max: 6.25 });
  });
});

describe("text symbols and totals", () => {
  it("validates 1-3 characters and drops bad stored values on load", () => {
    expect([validText("A"), validText("Fe"), validText("abcd"), validText(" "), validText(3)]).toEqual([true, true, false, false, false]);
    expect(cleanSymbols({ markerText: "toolong", markerTextSize: 2 })).toEqual({});
    expect(textSymbolSpec({ markerText: "A", bars: true })).toBeNull();
  });

  it("caps the drawn rows", () => {
    const xs = Array.from({ length: TEXT_SYMBOL_MAX + 10 }, (_, i) => i);
    expect(textSymbolRows(xs, xs)).toHaveLength(TEXT_SYMBOL_MAX);
  });

  it("labels totals to 6 significant figures", () => {
    expect(stackTotalLabel(1234567)).toBe("1234570");
    expect(stackTotalLabel(0.1 + 0.2)).toBe("0.3");
  });
});

describe("axis format", () => {
  it("keeps equal on the Y format only (not inherited by Y2)", () => {
    expect(sanitizeAxisExtras({ mode: "auto", digits: 3, equal: true })).toMatchObject({ equal: true });
    expect(inheritedAxisFormat({ mode: "auto", digits: 3, equal: true })).not.toHaveProperty("equal");
  });
});
