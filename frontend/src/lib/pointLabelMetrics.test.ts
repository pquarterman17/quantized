// #1075: the canvas draws a point label at the export's size relative to its ticks, and its slots
// match the export's. Shares tests/fixtures/wire/point_label_avoid_cluster.json (`screen_vs_export`)
// with tests/test_point_label_screen_scale.py, which asserts the Python rule gives these same slots.

import { describe, expect, it } from "vitest";
import type uPlot from "uplot";

import wire from "../../../tests/fixtures/wire/point_label_avoid_cluster.json";
import { placeLabels } from "./labelPlacement";
import { labelMetrics, tickPxOf } from "./pointLabelMetrics";
import { drawPointLabels } from "./pointLabelsDraw";
import type { LabelLayout } from "./pointLabelText";

const FX = wire.screen_vs_export;
const K = FX.screen_tick_px / FX.export_pt.tick; // canvas px per export pt

describe("label metrics", () => {
  it("are the export's points times the px per pt the ticks use", () => {
    const m = labelMetrics(FX.screen_tick_px);
    expect(m.fontPx).toBeCloseTo(FX.export_pt.label * K, 3);
    expect(m.fontPx / FX.screen_tick_px).toBeCloseTo(FX.export_pt.label / FX.export_pt.tick, 4); // 0.69 of the tick, not 1.00
    expect(m.h).toBeCloseTo(FX.export_pt.label * FX.export_pt.line_height * K, 3);
    expect(m.gap).toBeCloseTo(FX.export_pt.gap * K, 6);
    expect(m.pad).toBeCloseTo(FX.export_pt.pad * K, 6);
    expect(m.markerR).toBeCloseTo(FX.export_pt.marker * K, 6);
  });

  it("scale with the tick size and the device pixel ratio", () => {
    expect(labelMetrics(22).fontPx).toBeCloseTo(2 * labelMetrics(11).fontPx, 9);
  });

  it("reads the tick size from the axis font, else falls back", () => {
    expect(tickPxOf("22px JetBrains Mono, monospace", 5)).toBe(22);
    expect(tickPxOf("10.5px mono", 5)).toBe(10.5);
    expect(tickPxOf(undefined, 5)).toBe(5);
    expect(tickPxOf(["x"], 5)).toBe(5);
    expect(tickPxOf(["13px mono", 13, 1.2], 5)).toBe(13); // uPlot's initialised form
  });
});

describe("a crowded run on the canvas picks the export's slots", () => {
  it("every label lands in the same slot, to within a tenth of a point", () => {
    const m = labelMetrics(FX.screen_tick_px);
    const c = FX.crowd;
    // The canvas sees the export's geometry scaled by K (a uniform zoom); only the label sizes come from its own metrics.
    const items = c.items.map((i) => ({ ax: i.ax * K, ay: i.ay * K, w: i.w * K, h: m.h, importance: i.importance }));
    const placed = placeLabels(items, { left: 0, top: 0, right: c.rect.right * K, bottom: c.rect.bottom * K }, {
      gap: m.gap, markerR: m.markerR, step: m.h, rings: c.opts.rings, pad: m.pad, leaderMin: c.opts.leader_min,
    });
    expect(placed.some((p) => p.leader)).toBe(true);
    placed.forEach((p, i) => {
      const want = c.placed[i];
      expect(p.left / K).toBeCloseTo(want.left, 1);
      expect(p.top / K).toBeCloseTo(want.top, 1);
      expect(p.overlap).toBe(want.overlap);
      expect(p.leader === null).toBe(want.leader === null);
    });
  });
});

describe("drawPointLabels", () => {
  function draw(avoid: boolean, tickFont: string | undefined) {
    const fonts: string[] = [];
    const at: { text: string; x: number; y: number }[] = [];
    const ctx = {
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, stroke() {}, setLineDash() {}, moveTo() {}, lineTo() {},
      measureText: (t: string) => ({ width: t.length * 0.6 * parseFloat(ctx.font) }),
      font: "", textBaseline: "", textAlign: "", fillStyle: "", strokeStyle: "", lineWidth: 1,
      fillText(text: string, x: number, y: number) { fonts.push(ctx.font); at.push({ text, x, y }); },
    };
    const u = {
      ctx, bbox: { left: 0, top: 0, width: 400, height: 300 }, axes: [{ font: tickFont }],
      series: [{}, { stroke: "#123456", show: true, points: { size: 6 } }], valToPos: (v: number) => v * 10,
    } as unknown as uPlot;
    const layout: LabelLayout = {
      points: [{ x: 10, y: 15, text: "peak", row: 0, ch: 4, s: 0 }], note: avoid ? null : "a note", refusal: null,
      ...(avoid ? { avoid: { leaderDistance: 1.5, leaderWidth: 0.75, leaderDashed: false } } : {}),
    };
    drawPointLabels(u, layout, [4]);
    return { fonts, at };
  }

  it("draws a label at 0.69 of the tick font and offsets it by the export's 3 pt", () => {
    const { fonts, at } = draw(false, "11px monospace");
    const m = labelMetrics(11);
    expect(parseFloat(fonts[0])).toBeCloseTo(m.fontPx, 6);
    expect(parseFloat(fonts[0]) / 11).toBeCloseTo(0.6944, 3);
    expect(at[0].x).toBeCloseTo(100 + m.gap, 6);
    expect(at[0].y).toBeCloseTo(150 - m.gap, 6);
    expect(parseFloat(fonts[1])).toBe(11); // the one-line note keeps its own size
  });

  it("follows a larger tick font, and the avoid layout uses the same size", () => {
    const { fonts } = draw(true, "22px monospace");
    expect(parseFloat(fonts[0])).toBeCloseTo(labelMetrics(22).fontPx, 6);
  });
});
