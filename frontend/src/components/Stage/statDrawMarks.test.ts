// P2.6 box 1 — what a categorical draw shows under each mark option, read
// back from the canvas calls it makes (a recording context: jsdom has no
// raster), plus the domain / hit-test rules the painter and the click share.
// The export draws the same things (`tests/test_calc_figure_stat_marks.py`
// reads the matplotlib artists back for the same options).

import { describe, expect, it } from "vitest";

import { seriesStat } from "../../lib/barlayout";
import { deterministicJitter } from "../../lib/jitter";
import { errorBounds, resolveStatMarks, type ResolvedStatMarks } from "../../lib/statMarks";
import { barValueDomain, boxStatsClient, type BoxStat } from "../../lib/statstage";
import {
  barDomainCandidates,
  barErrorHalf,
  boxValueDomain,
  drawMarks,
  stripValueDomain,
  summaryExtents,
} from "./statDrawMarks";
import { plotRect, type StatDrawData } from "./statRender";
import { drawBoxesWithMarks, drawStrip } from "./statRenderBox";
import { clickedSlotAt } from "./statRenderSelection";

/** Records arcs (points / fliers), filled rects (median squares), and
 *  vertical line segments (error bars / whiskers). */
function recorder() {
  const arcs: { x: number; y: number; r: number }[] = [];
  const squares: { x: number; y: number }[] = [];
  const segs: { x: number; y0: number; y1: number }[] = [];
  let last: [number, number] = [0, 0];
  const ctx = {
    font: "", fillStyle: "", strokeStyle: "", lineWidth: 0, globalAlpha: 1,
    textAlign: "", textBaseline: "",
    save() {}, restore() {}, translate() {}, rotate() {}, setLineDash() {},
    beginPath() {}, closePath() {}, fill() {}, stroke() {}, strokeRect() {}, fillText() {},
    moveTo(x: number, y: number) {
      last = [x, y];
    },
    lineTo(x: number, y: number) {
      if (x === last[0]) segs.push({ x, y0: last[1], y1: y });
      last = [x, y];
    },
    arc(x: number, y: number, r: number) {
      arcs.push({ x, y, r });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      if (w === 7 && h === 7) squares.push({ x: x + 3.5, y: y + 3.5 });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, arcs, squares, segs };
}

const RECT = { x: 0, y: 0, w: 400, h: 200 };
const VALUES = [1, 2, 2.5, 3, 3.2, 12];
const ROWS = [10, 11, 12, 13, 14, 15];
const BOX: BoxStat = { ...boxStatsClient(VALUES), label: "A" };
const POINTS = [{ label: "A", points: VALUES.map((value, i) => ({ value, rowIndex: ROWS[i] })) }];
const marks = (over: Partial<ResolvedStatMarks> = {}, mode: "box" | "strip" = "box") => ({
  ...resolveStatMarks(mode, {}),
  ...over,
});

function boxDraw(m: ResolvedStatMarks): Extract<StatDrawData, { mode: "box" }> {
  return { mode: "box", boxes: [BOX], points: POINTS, valueLabel: "y", groupLabel: "g", marks: m };
}
function stripDraw(m: ResolvedStatMarks): Extract<StatDrawData, { mode: "strip" }> {
  return {
    mode: "strip", boxes: [BOX], points: POINTS, valueLabel: "y", groupLabel: "g", showMeanCI: false,
    connectMeans: false, marks: m,
  };
}

describe("raw-point visibility on the canvas", () => {
  it("box: outliers = its fliers on the centre line; all = every point jittered, no duplicate flier; none = neither", () => {
    const cx = RECT.x + 0.5 * RECT.w;
    const out = recorder();
    drawBoxesWithMarks(out.ctx, RECT, boxDraw(marks({ points: "outliers" })), "#000", "#888");
    expect(out.arcs.map((a) => a.x)).toEqual([cx]); // the one flier, 12
    const all = recorder();
    drawBoxesWithMarks(all.ctx, RECT, boxDraw(marks({ points: "all", jitterWidth: 0.5 })), "#000", "#888");
    expect(all.arcs).toHaveLength(VALUES.length);
    const hw = 0.3 * RECT.w; // categorySlots(1): half-width 0.3 of the axis
    expect(all.arcs.map((a) => a.x)).toEqual(ROWS.map((r) => cx + deterministicJitter(r, "A") * hw * 0.5));
    const none = recorder();
    drawBoxesWithMarks(none.ctx, RECT, boxDraw(marks({ points: "none" })), "#000", "#888");
    expect(none.arcs).toHaveLength(0);
  });

  it("strip: outliers shows only values beyond the whiskers; jitter 0 puts them on the centre line", () => {
    const r = recorder();
    drawStrip(r.ctx, RECT, stripDraw(marks({ points: "outliers", jitterWidth: 0 }, "strip")), "#000", "#888");
    expect(r.arcs.map((a) => a.x)).toEqual([200]);
    const none = recorder();
    drawStrip(none.ctx, RECT, stripDraw(marks({ points: "none", summary: "median" }, "strip")), "#000", "#888");
    expect(none.arcs).toHaveLength(0);
    expect(none.squares).toHaveLength(1);
  });
});

describe("summary marker + error bars on the canvas", () => {
  it.each(["sd", "se", "ci95"] as const)("mean +/- %s: the whisker spans exactly the error bounds", (kind) => {
    const r = recorder();
    const d = stripDraw(marks({ points: "none", summary: "mean", errorBars: kind }, "strip"));
    drawStrip(r.ctx, RECT, d, "#000", "#888");
    const [lo, hi] = errorBounds(BOX, kind) as [number, number];
    const [d0, d1] = stripValueDomain(d);
    const vy = (v: number) => RECT.y + RECT.h - ((v - d0) / (d1 - d0)) * RECT.h;
    const bars = r.segs.filter((sg) => sg.x === 200);
    expect(bars).toHaveLength(1);
    expect(bars[0].y0).toBeCloseTo(vy(lo), 9);
    expect(bars[0].y1).toBeCloseTo(vy(hi), 9);
  });

  it("no error bar below n=2, and none for the median marker", () => {
    const one: BoxStat = { ...boxStatsClient([4]), label: "A" };
    expect(summaryExtents(one, marks({ summary: "mean", errorBars: "sd" }))).toEqual([4]);
    expect(summaryExtents(BOX, marks({ summary: "median", errorBars: "sd" }))).toEqual([BOX.median]);
    expect(summaryExtents(BOX, marks({ summary: "none" }))).toEqual([]);
  });

  it("the value domain reaches a wide error bar, so it is never clipped", () => {
    const small: BoxStat = { ...boxStatsClient([1, 2]), label: "A" }; // t(0.975,1) = 12.7
    const [lo, hi] = boxValueDomain([small], marks({ summary: "mean", errorBars: "ci95" }));
    expect(lo).toBeLessThan(small.ciLo as number);
    expect(hi).toBeGreaterThan(small.ciHi as number);
  });
});

describe("bar error bars follow the chosen kind (screen, hit-test and export share barErrorHalf)", () => {
  const s = seriesStat([2, 4, 4, 4, 5, 5, 7, 9]);
  const bar = (errorBars: ResolvedStatMarks["errorBars"]): Extract<StatDrawData, { mode: "bar" }> => ({
    mode: "bar", data: { groups: [{ label: "A", series: [s] }], seriesLabels: ["y"] }, valueLabel: "y",
    groupLabel: "g", stacked: false, marks: { ...resolveStatMarks("bar", {}), errorBars },
  });
  it("SE by default, SD = SE*sqrt(n), none", () => {
    expect(barErrorHalf(bar("se"), s)).toBeCloseTo(s.sem, 14);
    expect(barErrorHalf(bar("sd"), s)).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(barErrorHalf(bar("none"), s)).toBeNaN();
    expect(barDomainCandidates(bar("sd"))).toEqual([0, 5, 5 + Math.sqrt(32 / 7), 5 - Math.sqrt(32 / 7)].map(
      (v, i) => (i < 2 ? v : expect.closeTo(v, 12)),
    ));
  });
  it("a click on the SD whisker (beyond where an SE one would end) selects the slot", () => {
    const sd = Math.sqrt(32 / 7);
    const at = (d: Extract<StatDrawData, { mode: "bar" }>, v: number) => {
      const rect = plotRect(400, 300, d);
      const [d0, d1] = barValueDomain(barDomainCandidates(d));
      return clickedSlotAt(d, 400, 300, rect.x + rect.w / 2, rect.y + rect.h - ((v - d0) / (d1 - d0)) * rect.h, 1);
    };
    expect(at(bar("sd"), 5 + (s.sem + sd) / 2)).toBe(0);
    // Under SE the same stretch above the whisker is blank background.
    expect(at(bar("se"), 5 + s.sem * 1.04)).toBeNull();
    expect(at(bar("se"), 5 + s.sem * 0.5)).toBe(0);
  });
});

describe("drawMarks — legacy draws keep their old meaning", () => {
  it("maps showMeanCI / points / connectMeans", () => {
    const legacy: StatDrawData = {
      mode: "box", boxes: [BOX], points: POINTS, valueLabel: "y", groupLabel: "g", showMeanCI: true, connectMeans: true,
    };
    expect(drawMarks(legacy)).toMatchObject({
      points: "all", summary: "mean", errorBars: "ci95", connectMeans: true, legacyFliers: true, jitterWidth: 0.7,
    });
  });
});
