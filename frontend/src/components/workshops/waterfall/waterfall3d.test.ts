// 3-D waterfall of N separate curves (gap-5 lane F): each curve is its own
// polyline in ORIGINAL point order at its own depth (no union grid, no sort),
// preview == export, and it fails closed on what cannot be drawn.

import { describe, expect, it } from "vitest";

import type { WaterfallSeries } from "../../../lib/waterfall";
import { curveWaterfallBody, type Curve3dOptions } from "./waterfall3d";

const S = (label: string, x: number[], y: number[]): WaterfallSeries => ({ id: label, label, x, y, range: 1 });
const O: Curve3dOptions = { channel: "Signal", depth: "index", elev: 30, azim: -60, cmap: "viridis", style: "default", title: "" };
const series = [S("scan 300K", [0, 1, 2], [1, 2, 3]), S("scan 100K", [1, 2, 3], [4, Number.NaN, 6]), S("scan 200K", [0, 1, 2], [7, 8, 9])];

describe("curveWaterfallBody", () => {
  it("sends one polyline per curve: its own points, its own depth, no shared grid", () => {
    const r = curveWaterfallBody(series, O, "png", "p");
    expect(r.ok && r.body).toMatchObject({
      kind: "waterfall", contour_source: "curves", view_elev: 30, view_azim: -60, z_label: "Signal",
      curves: [
        { x: [0, 1, 2], z: [1, 2, 3], depth: 0 },
        { x: [1, 3], z: [4, 6], depth: 1 }, // the non-finite point is dropped, nothing is filled in
        { x: [0, 1, 2], z: [7, 8, 9], depth: 2 },
      ],
    });
    expect(r.ok && r.body.z_grid).toBeUndefined();
    expect(r.ok && r.body.x_axis).toBeUndefined();
  });

  it("a hysteresis loop stays a loop: original order, nothing sorted, merged or overwritten", () => {
    const loopX = [0, 1, 2, 3, 2, 1, 0];
    const loopY = [0, 1, 3, 4, 3.5, 2, 0.5];
    const r = curveWaterfallBody([S("loop 50K", loopX, loopY), S("loop 100K", loopX, loopY.map((v) => v + 1))], O, "png", "p");
    expect(r.ok && r.body.curves?.[0]).toEqual({ x: loopX, z: loopY, depth: 0 });
    expect(r.ok && r.body.curves?.[1].x).toHaveLength(7); // the old union grid kept 4 of 7 points
  });

  it("curves on different x values stay small: points sent == points measured", () => {
    const many = Array.from({ length: 30 }, (_, k) => S(`c ${k}K`, Array.from({ length: 500 }, (_, i) => i + k * 0.01), Array.from({ length: 500 }, (_, i) => i)));
    const r = curveWaterfallBody(many, O, "png", "p");
    expect(r.ok && r.body.curves?.reduce((a, c) => a + c.x.length, 0)).toBe(30 * 500);
  });

  it("depth by number in name uses each curve's own number, in the given order", () => {
    const r = curveWaterfallBody(series, { ...O, depth: "number" }, "png", "p");
    expect(r.ok && r.body.curves?.map((c) => c.depth)).toEqual([300, 100, 200]);
    expect(r.ok && r.body.y_label).toBe("Number in name");
  });

  it("hyphenated names are separators, not minus signs: sample-50K / -100K / -150K", () => {
    const named = ["sample-50K", "sample-100K", "sample-150K"].map((n) => S(n, [0, 1], [1, 2]));
    const r = curveWaterfallBody(named, { ...O, depth: "number" }, "png", "p");
    expect(r.ok && r.body.curves?.map((c) => c.depth)).toEqual([50, 100, 150]);
  });

  it("two curves at the same depth are refused, naming both", () => {
    // "S1 ..." reads as 1 under a first-number rule; here the unit-attached number wins.
    const same = [S("S1_300K", [0, 1], [1, 2]), S("S2_300K", [0, 1], [3, 4])];
    expect(curveWaterfallBody(same, { ...O, depth: "number" }, "png", "p")).toMatchObject({
      ok: false, error: expect.stringMatching(/"S1_300K" and "S2_300K" both sit at depth 300/),
    });
    const ok = [S("S1_10K", [0, 1], [1, 2]), S("S1_50K", [0, 1], [3, 4])];
    const r = curveWaterfallBody(ok, { ...O, depth: "number" }, "png", "p");
    expect(r.ok && r.body.curves?.map((c) => c.depth)).toEqual([10, 50]);
  });

  it("axis labels carry the datasets' labels and units", () => {
    const r = curveWaterfallBody(series, { ...O, xLabel: "H (T)", zLabel: "M (emu)" }, "png", "p");
    expect(r.ok && r.body).toMatchObject({ x_label: "H (T)", z_label: "M (emu)" });
    const bare = curveWaterfallBody(series, O, "png", "p");
    expect(bare.ok && bare.body).toMatchObject({ x_label: "x", z_label: "Signal" });
  });

  it("preview and export are the same request except fmt and filename", () => {
    const a = curveWaterfallBody(series, O, "png", "preview");
    const b = curveWaterfallBody(series, O, "pdf", "waterfall3d_Signal");
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect({ ...a.body, fmt: "", filename: "" }).toEqual({ ...b.body, fmt: "", filename: "" });
  });

  it("fails closed: one curve, a name without a number, bad angles, curves with under 2 points", () => {
    expect(curveWaterfallBody(series.slice(0, 1), O, "png", "p")).toMatchObject({ ok: false, error: expect.stringMatching(/at least 2 curves/) });
    expect(curveWaterfallBody([...series, S("blank", [0, 1], [1, 2])], { ...O, depth: "number" }, "png", "p")).toMatchObject({
      ok: false, error: expect.stringMatching(/"blank" has no number/),
    });
    expect(curveWaterfallBody(series, { ...O, elev: 95 }, "png", "p")).toMatchObject({ ok: false });
    expect(curveWaterfallBody(series, { ...O, azim: Number.NaN }, "png", "p")).toMatchObject({ ok: false });
    expect(curveWaterfallBody([S("a", [1], [1]), S("b", [1], [2])], O, "png", "p")).toMatchObject({ ok: false, error: expect.stringMatching(/found 0/) });
    expect(curveWaterfallBody([S("a", [0, 1], [Number.NaN, Number.NaN]), S("b", [0, 1], [1, 2])], O, "png", "p")).toMatchObject({ ok: false });
  });
});
