// P2.6 box 1, second pass — what the canvas paints for the violin's inner
// glyph and summary marker, the grouped bars' raw points / summary marker, and
// the nested axis's outer tier, read back from a recording context (jsdom has
// no raster). The export draws the same (`tests/test_stat_marks_violin_bar.py`
// reads the matplotlib artists back for the same options).

import { describe, expect, it } from "vitest";

import { groupedBarSlots, seriesStat } from "../../lib/barlayout";
import { deterministicJitter } from "../../lib/jitter";
import { errorBounds, resolveStatMarks, type ResolvedStatMarks } from "../../lib/statMarks";
import { barValueDomain, boxStatsClient, categorySlots } from "../../lib/statstage";
import { withBarRaw } from "./statBarMarks";
import { barDomainCandidates, violinValueDomain } from "./statDrawMarks";
import { draw as drawStat, type StatDrawData } from "./statRender";
import { drawCategoryAxis } from "./statRenderAxes";
import { drawBar } from "./statRenderBar";

function recorder() {
  const arcs: { x: number; y: number; r: number }[] = [];
  const squares: { x: number; y: number }[] = [];
  const segs: { x: number; y0: number; y1: number; w: number }[] = [];
  const texts: string[] = [];
  const diamonds: { x: number; y: number }[] = [];
  let last: [number, number] = [0, 0];
  const ctx = {
    font: "", fillStyle: "", strokeStyle: "", lineWidth: 0, globalAlpha: 1, textAlign: "", textBaseline: "",
    save() {}, restore() {}, translate() {}, rotate() {}, setLineDash() {}, setTransform() {}, clearRect() {},
    beginPath() {}, closePath() {}, fill() {}, stroke() {}, strokeRect() {},
    fillText(t: string) {
      texts.push(t);
    },
    moveTo(x: number, y: number) {
      last = [x, y];
    },
    lineTo(x: number, y: number) {
      // A diamond's first edge: from its top vertex down-right by r = 4.
      if (Math.abs(x - last[0] - 4) < 1e-9 && Math.abs(y - last[1] - 4) < 1e-9) diamonds.push({ x: last[0], y: y });
      if (x === last[0]) segs.push({ x, y0: last[1], y1: y, w: this.lineWidth });
      last = [x, y];
    },
    arc(x: number, y: number, r: number) {
      arcs.push({ x, y, r });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      if (w === 7 && h === 7) squares.push({ x: x + 3.5, y: y + 3.5 });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, arcs, squares, segs, texts, diamonds };
}

const RECT = { x: 0, y: 0, w: 400, h: 200 };
const VALUES = [1, 2, 2.5, 3, 3.2, 12];
const ROWS = [10, 11, 12, 13, 14, 15];
const marks = (mode: "violin" | "bar", over: Partial<ResolvedStatMarks> = {}) => ({ ...resolveStatMarks(mode, {}), ...over });

describe("violin: the box's inner glyph and the summary marker", () => {
  const box = { ...boxStatsClient([1, 2]), label: "A" }; // n=2: a CI far past the KDE
  const violin = (m: ResolvedStatMarks): Extract<StatDrawData, { mode: "violin" }> => ({
    mode: "violin", valueLabel: "y", groupLabel: "g", marks: m, boxes: [box],
    violins: [{ label: "A", x: [0, 1, 2, 3], density: [0.1, 0.5, 0.5, 0.1], quartiles: [1.25, 1.5, 1.75], n: 2 }],
  });
  const paint = (d: StatDrawData) => {
    const rec = recorder();
    const canvas = { getContext: () => rec.ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
    drawStat(canvas, { clientWidth: 460, clientHeight: 268 } as HTMLElement, d);
    return rec;
  };

  it("draws a q1-q3 bar and a hollow median dot (not a mean / extrema)", () => {
    const d = violin(marks("violin"));
    const rec = paint(d);
    const dom = violinValueDomain(d);
    const thick = rec.segs.filter((s) => s.w === 3);
    expect(thick).toHaveLength(1);
    const span = Math.abs(thick[0].y0 - thick[0].y1);
    // q1..q3 = 0.5 value units of a domain the painter scaled to the rect.
    expect(span).toBeCloseTo((0.5 / (dom[1] - dom[0])) * (268 - 20 - 48), 6);
    expect(rec.arcs.filter((a) => a.r === 2.5)).toHaveLength(1);
    expect(rec.diamonds).toHaveLength(0);
  });

  it("mean + 95% CI: a diamond with its bar, and the domain reaches the CI", () => {
    const m = marks("violin", { summary: "mean", errorBars: "ci95" });
    const d = violin(m);
    const rec = paint(d);
    expect(rec.diamonds).toHaveLength(1);
    const [lo, hi] = errorBounds(box, "ci95")!;
    expect(violinValueDomain(d)[0]).toBeLessThanOrEqual(lo);
    expect(violinValueDomain(d)[1]).toBeGreaterThanOrEqual(hi);
    expect(rec.segs.filter((s) => s.w === 1.5)).toHaveLength(1); // the error bar itself
    const median = paint(violin(marks("violin", { summary: "median" })));
    expect(median.squares).toHaveLength(1);
  });
});

describe("grouped bars: raw points and the summary marker", () => {
  const raw = (vals: number[], rows: number[]) => [vals.map((value, i) => ({ value, rowIndex: rows[i] }))];
  const barData = (stacked: boolean, m: ResolvedStatMarks): Extract<StatDrawData, { mode: "bar" }> => ({
    mode: "bar", valueLabel: "y", groupLabel: "g", stacked, marks: m, showN: false,
    data: withBarRaw({ seriesLabels: ["y"], groups: [{ label: "L1", series: [seriesStat(VALUES)] }] }, [raw(VALUES, ROWS)]),
  });
  const geometry = () => {
    const slot = categorySlots(1)[0];
    const catFullW = slot.halfWidth * 2 * RECT.w;
    const sub = groupedBarSlots(1)[0];
    return { cx: RECT.x + slot.cx * RECT.w + sub.offset * catFullW, hw: sub.halfWidth * catFullW };
  };

  it("all: every point, jittered by (row, category) times the bar's half-width", () => {
    const rec = recorder();
    drawBar(rec.ctx, RECT, barData(false, marks("bar", { points: "all", jitterWidth: 0.5 })), "#000", "#888");
    const { cx, hw } = geometry();
    expect(rec.arcs.map((a) => a.x)).toEqual(ROWS.map((r) => cx + deterministicJitter(r, "L1") * hw * 0.5));
  });

  it("outliers: only the cell's Tukey outlier; median: a square at the cell's median", () => {
    const rec = recorder();
    const d = barData(false, marks("bar", { points: "outliers", jitterWidth: 0, summary: "median" }));
    drawBar(rec.ctx, RECT, d, "#000", "#888");
    expect(rec.arcs).toHaveLength(1);
    const dom = barValueDomain(barDomainCandidates(d));
    const vy = (v: number) => RECT.y + RECT.h - ((v - dom[0]) / (dom[1] - dom[0])) * RECT.h;
    expect(rec.arcs[0].y).toBeCloseTo(vy(12), 9);
    expect(rec.squares.map((s) => s.y)).toEqual([vy(boxStatsClient(VALUES).median)]);
    expect(dom[1]).toBeGreaterThanOrEqual(12); // the drawn outlier is in the domain
  });

  it("mean: a diamond on the bar top; stacked bars draw no marks at all", () => {
    const rec = recorder();
    drawBar(rec.ctx, RECT, barData(false, marks("bar", { summary: "mean" })), "#000", "#888");
    expect(rec.diamonds).toHaveLength(1);
    const stacked = recorder();
    drawBar(stacked.ctx, RECT, barData(true, marks("bar", { points: "all", summary: "median" })), "#000", "#888");
    expect(stacked.arcs).toHaveLength(0);
    expect(stacked.squares).toHaveLength(0);
    expect(barDomainCandidates(barData(true, marks("bar", { points: "all" })))).not.toContain(12);
  });
});

describe("nested axis: the outer tier is drawn whole, as the export draws it", () => {
  it("a one-slot run keeps its full outer label", () => {
    const labels = ["lot = Anneal 450 C under vacuum / wafer = W1", "lot = B / wafer = W1", "lot = B / wafer = W2"];
    const rec = recorder();
    const slots = categorySlots(3);
    drawCategoryAxis(rec.ctx, { x: 0, y: 0, w: 120, h: 100 }, slots, labels, "lot / wafer", "#000", "#888", { nestLabel: "wafer" });
    expect(rec.texts).toContain("lot = Anneal 450 C under vacuum");
    expect(rec.texts).toContain("lot = B");
  });
});
