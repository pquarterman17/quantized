// Where the significance marks go (gap audit 8 lane SIG): bracket stacking,
// letters over their own group, the value domain growing to hold them, and the
// refusal to lay out against a draw that is not the one the test ran on.

import { describe, expect, it } from "vitest";

import type { AxisSlot } from "../../lib/groupAxis";
import { buildComparisons, type PairP, type StatComparisonsResult } from "../../lib/statComparisons";
import { resolveStatMarks } from "../../lib/statMarks";
import { boxStatsClient } from "../../lib/statstage";
import { seriesStat } from "../../lib/barMatrix";
import { boxValueDomain, drawMarks, stripValueDomain } from "./statDrawMarks";
import { alignGroups, groupSlots, groupTops, layoutComparisons, type CategoricalDraw } from "./statCompareLayout";
import { drawComparisons } from "./statDrawComparisons";
import { comparisonWire } from "./statExportDomain";
import type { StatDrawData } from "./statRender";

const G = [
  { label: "a", values: [1, 2, 3] },
  { label: "b", values: [4, 5, 6] },
  { label: "c", values: [9, 10, 11] },
];
const boxes = G.map((g) => ({ ...boxStatsClient(g.values), label: g.label }));
const box = (over: Partial<Extract<StatDrawData, { mode: "box" }>> = {}): Extract<StatDrawData, { mode: "box" }> => ({
  mode: "box", boxes, valueLabel: "y", groupLabel: "g", marks: resolveStatMarks("box", {}), ...over,
});
const pair = (a: number, b: number, p: number): PairP => ({ a, b, p });
const result = (pairs: PairP[], display: "brackets" | "letters" = "brackets", exact = false): StatComparisonsResult => {
  const r = buildComparisons("tukey", display, exact, G.map((g) => g.values.reduce((s, v) => s + v, 0) / g.values.length), pairs, null);
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("alignment", () => {
  it("accepts the draw the groups came from and refuses any other", () => {
    expect(alignGroups(box(), G)).toEqual([0, 1, 2]);
    expect(alignGroups(box(), G.slice(0, 2))).toBeNull(); // a group went missing
    expect(alignGroups(box(), [G[0], G[1], { label: "c", values: [1, 2] }])).toBeNull(); // n differs
  });
});

describe("brackets", () => {
  it("draws significant pairs only, labelled with stars", () => {
    const d = box();
    const m = layoutComparisons(d, result([pair(0, 1, 0.5), pair(0, 2, 0.0004), pair(1, 2, 0.03)]), [0, 1, 2]);
    expect(m.brackets.map((b) => [b.a, b.b, b.label])).toEqual([[1, 2, "*"], [0, 2, "***"]]);
  });

  it("puts every bracket above the groups it spans and stacks overlapping ones", () => {
    const d = box();
    const tops = groupTops(d);
    const m = layoutComparisons(d, result([pair(0, 1, 0.001), pair(1, 2, 0.001), pair(0, 2, 0.001)]), [0, 1, 2]);
    const at = (a: number, b: number) => m.brackets.find((x) => x.a === a && x.b === b)!;
    expect(at(0, 1).y).toBeGreaterThan(Math.max(tops[0], tops[1]));
    expect(at(1, 2).y).toBeGreaterThan(at(0, 1).y); // shares slot 1: one step above
    expect(at(0, 2).y).toBeGreaterThan(at(1, 2).y); // spans both
    expect(m.top).toBeGreaterThan(at(0, 2).y); // label headroom
  });

  it("keeps non-overlapping brackets on the same level", () => {
    const four = [...G, { label: "d", values: [1, 2, 3] }];
    const d = box({ boxes: four.map((g) => ({ ...boxStatsClient(g.values), label: g.label })) });
    const r = buildComparisons("tukey", "brackets", false, [1, 2, 3, 4], [pair(0, 1, 0.001), pair(2, 3, 0.001)], null);
    if ("error" in r) throw new Error(r.error);
    const m = layoutComparisons(d, r, [0, 1, 2, 3]);
    expect(m.brackets).toHaveLength(2);
    const tops = groupTops(d);
    const [first, second] = m.brackets;
    // each sits one gap above ITS OWN pair, not stacked on the other
    expect(first.y).toBeGreaterThan(Math.max(tops[0], tops[1]));
    expect(second.y).toBeGreaterThan(Math.max(tops[2], tops[3]));
    expect(first.y).toBeLessThan(second.y); // group c is taller, so its bracket sits higher, with no stacking step
    expect(second.y - Math.max(tops[2], tops[3])).toBeCloseTo(first.y - Math.max(tops[0], tops[1]), 9);
  });

  it("says so when no pair is significant", () => {
    const m = layoutComparisons(box(), result([pair(0, 1, 0.5)]), [0, 1, 2]);
    expect(m.brackets).toEqual([]);
    expect(m.note).toContain("no pair significant");
    expect(Number.isNaN(m.top)).toBe(true);
  });

  it("adds the exact p when asked", () => {
    const m = layoutComparisons(box(), result([pair(0, 1, 0.0042)], "brackets", true), [0, 1, 2]);
    expect(m.brackets[0].label).toBe("** p=0.0042");
  });

  it("uses the axis slot, not the group index, when a slot is empty", () => {
    const slot = (label: string, group: number | null): AxisSlot =>
      ({ label, group, n: group === null ? 0 : 3, nonFinite: 0, excluded: 0, absent: group === null });
    const slots = [slot("a", 0), slot("empty", null), slot("b", 1), slot("c", 2)];
    const d = box({ slots });
    expect(groupSlots(d)).toEqual([0, 2, 3]);
    const m = layoutComparisons(d, result([pair(0, 2, 0.001)]), [0, 1, 2]);
    expect([m.brackets[0].a, m.brackets[0].b]).toEqual([0, 3]);
  });
});

describe("letters", () => {
  it("sit just above their own group", () => {
    const d = box();
    const m = layoutComparisons(d, result([pair(0, 1, 0.001), pair(0, 2, 0.001), pair(1, 2, 0.001)], "letters"), [0, 1, 2]);
    expect(m.brackets).toEqual([]);
    expect(m.letters.map((l) => l.text)).toEqual(["c", "b", "a"]);
    const tops = groupTops(d);
    m.letters.forEach((l, i) => expect(l.y).toBeGreaterThan(tops[i]));
  });
});

describe("the value domain holds the marks", () => {
  it("box and strip domains grow to the top; without comparisons they are unchanged", () => {
    const d = box();
    const m = layoutComparisons(d, result([pair(0, 2, 0.001)]), [0, 1, 2]);
    const base = boxValueDomain(d.boxes, drawMarks(d));
    const withC = boxValueDomain(d.boxes, drawMarks(d), [m.top]);
    expect(withC[1]).toBeGreaterThan(base[1]);
    expect(withC[1]).toBeGreaterThanOrEqual(m.top);
    expect(withC[0]).toBeLessThanOrEqual(base[0]); // the 8 % pad scales with the taller range
    expect(boxValueDomain(d.boxes, drawMarks(d), [])).toEqual(base);
    const strip: Extract<StatDrawData, { mode: "strip" }> = {
      mode: "strip", boxes, valueLabel: "y", groupLabel: "g", marks: resolveStatMarks("strip", {}),
      points: G.map((g) => ({ label: g.label, points: g.values.map((value, i) => ({ value, rowIndex: i })) })),
    };
    expect(stripValueDomain({ ...strip, comparisons: m })[1]).toBeGreaterThanOrEqual(m.top);
    expect(stripValueDomain(strip)[1]).toBeLessThan(m.top);
  });
});

describe("bar", () => {
  const bar: Extract<StatDrawData, { mode: "bar" }> = {
    mode: "bar", valueLabel: "y", groupLabel: "g", stacked: false, marks: resolveStatMarks("bar", {}),
    data: { seriesLabels: ["y"], groups: G.map((g) => ({ label: g.label, series: [seriesStat(g.values)] })) },
  };
  it("aligns by label and n, and tops are the bar plus its error bar", () => {
    expect(alignGroups(bar, G)).toEqual([0, 1, 2]);
    // labels differ between the bar matrix ("A") and the grouping ("grp = A"): n and mean decide
    expect(alignGroups(bar, G.map((g) => ({ ...g, label: `grp = ${g.label}` })))).toEqual([0, 1, 2]);
    expect(alignGroups(bar, [{ label: "a", values: [1, 2, 4] }, G[1], G[2]])).toBeNull(); // mean differs
    expect(alignGroups(bar, G.slice(0, 2))).toBeNull(); // a category went missing
    const tops = groupTops(bar as CategoricalDraw);
    expect(tops[2]).toBeGreaterThan(10);
    const m = layoutComparisons(bar, result([pair(0, 2, 0.001)]), [0, 1, 2]);
    expect(m.brackets[0].y).toBeGreaterThan(tops[2]);
  });
});

describe("painting and the export wire", () => {
  function rec() {
    const calls: [string, ...unknown[]][] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => { calls.push([k, ...a]); }),
      set: (t, k: string, v) => { t[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  }
  const slots = [0, 1, 2].map((i) => ({ cx: (i + 0.5) / 3, halfWidth: 0.1 }));
  const rect = { x: 0, y: 0, w: 300, h: 100 };

  it("draws a three-segment bracket and its label, and letters", () => {
    const { ctx, calls } = rec();
    drawComparisons(ctx, rect, slots, (v) => 100 - v, { note: "n", brackets: [{ a: 0, b: 2, y: 50, label: "**" }], letters: [{ slot: 1, y: 20, text: "b" }], tick: 5, top: 60 }, "#000");
    const lines = calls.filter((c) => c[0] === "lineTo");
    expect(lines).toHaveLength(3);
    expect(calls.filter((c) => c[0] === "fillText").map((c) => c[1])).toEqual(["**", "b"]);
    expect(calls.find((c) => c[0] === "fillText")![2]).toBeCloseTo(150); // centred between slots 0 and 2
  });

  it("paints nothing without marks", () => {
    const { ctx, calls } = rec();
    drawComparisons(ctx, rect, slots, (v) => v, null, "#000");
    drawComparisons(ctx, rect, slots, (v) => v, { note: "n", brackets: [], letters: [], tick: 1, top: NaN }, "#000");
    expect(calls).toEqual([]);
  });

  it("posts the laid-out marks verbatim, and nothing when there are none", () => {
    const m = layoutComparisons(box(), result([pair(0, 2, 0.001)]), [0, 1, 2]);
    expect(comparisonWire({ ...box(), comparisons: m })).toEqual({ comparisons: m });
    expect(comparisonWire(box())).toEqual({});
    expect(comparisonWire({ ...box(), comparisons: { ...m, brackets: [], letters: [] } })).toEqual({});
    expect(comparisonWire(null)).toEqual({});
  });
});

describe("the painters draw the marks", () => {
  it("box, strip and bar painters all paint the bracket label, and none without the marks", async () => {
    const { drawBoxesWithMarks, drawStrip } = await import("./statRenderBox");
    const { drawBar } = await import("./statRenderBar");
    const texts: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => { if (k === "fillText") texts.push(String(a[0])); }),
      set: (t, k: string, v) => { t[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const rect = { x: 0, y: 0, w: 400, h: 200 };
    const r = result([pair(0, 2, 0.0004)]);
    const boxD = box();
    drawBoxesWithMarks(ctx, rect, { ...boxD, comparisons: layoutComparisons(boxD, r, [0, 1, 2]) }, "#000", "#888");
    const stripD: Extract<StatDrawData, { mode: "strip" }> = {
      mode: "strip", boxes, valueLabel: "y", groupLabel: "g", marks: resolveStatMarks("strip", {}),
      points: G.map((g) => ({ label: g.label, points: g.values.map((value, i) => ({ value, rowIndex: i })) })),
    };
    drawStrip(ctx, rect, { ...stripD, comparisons: layoutComparisons(stripD, r, [0, 1, 2]) }, "#000", "#888");
    const barD: Extract<StatDrawData, { mode: "bar" }> = {
      mode: "bar", valueLabel: "y", groupLabel: "g", stacked: false, marks: resolveStatMarks("bar", {}),
      data: { seriesLabels: ["y"], groups: G.map((g) => ({ label: g.label, series: [seriesStat(g.values)] })) },
    };
    drawBar(ctx, rect, { ...barD, comparisons: layoutComparisons(barD, r, [0, 1, 2]) }, "#000", "#888");
    const { draw: paint } = await import("./statRender");
    const violinD: Extract<StatDrawData, { mode: "violin" }> = {
      mode: "violin", boxes, valueLabel: "y", groupLabel: "g", marks: resolveStatMarks("violin", {}),
      violins: G.map((g) => ({
        label: g.label, x: [g.values[0] - 1, g.values[2] + 1], density: [0.1, 0.1], quartiles: [g.values[0], g.values[1], g.values[2]], n: 3,
      })),
    };
    const host = { clientWidth: 400, clientHeight: 240, dataset: {} } as unknown as HTMLElement;
    const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
    paint(canvas, host, { ...violinD, comparisons: layoutComparisons(violinD, r, [0, 1, 2]) });
    expect(texts.filter((t) => t === "***")).toHaveLength(4);
    texts.length = 0;
    drawBoxesWithMarks(ctx, rect, boxD, "#000", "#888");
    expect(texts).not.toContain("***");
  });
});

describe("review hardening", () => {
  it("refuses a same-sized but different set of groups (order swapped), not just a different size", () => {
    const swapped = [G[1], G[0], G[2]]; // same n everywhere, different means
    expect(alignGroups(box(), swapped)).toBeNull();
    const stripD: Extract<StatDrawData, { mode: "strip" }> = {
      mode: "strip", boxes, valueLabel: "y", groupLabel: "g", marks: resolveStatMarks("strip", {}),
      points: G.map((g) => ({ label: g.label, points: g.values.map((value, i) => ({ value, rowIndex: i })) })),
    };
    expect(alignGroups(stripD, swapped)).toBeNull();
    expect(alignGroups(stripD, G)).toEqual([0, 1, 2]);
  });

  it("never draws a flat or doubled bracket", () => {
    const m = layoutComparisons(box(), result([pair(0, 2, 0.001), pair(2, 0, 0.001), pair(1, 1, 0.001)]), [0, 1, 2]);
    expect(m.brackets).toHaveLength(1);
    expect(m.brackets[0].a).not.toBe(m.brackets[0].b);
  });
});
