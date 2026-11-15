// 3-D waterfall of N separate curves (gap-5 lane F): the request is the
// workshop's union-x grid over a depth axis, preview == export, and it fails
// closed on what cannot be drawn.

import { describe, expect, it } from "vitest";

import type { WaterfallSeries } from "../../../lib/waterfall";
import { curveWaterfallBody, type Curve3dOptions } from "./waterfall3d";

const S = (label: string, x: number[], y: number[]): WaterfallSeries => ({ id: label, label, x, y, range: 1 });
const O: Curve3dOptions = { channel: "Signal", depth: "index", elev: 30, azim: -60, cmap: "viridis", style: "default", title: "" };
const series = [S("scan 300K", [0, 1, 2], [1, 2, 3]), S("scan 100K", [1, 2, 3], [4, Number.NaN, 6]), S("scan 200K", [0, 1, 2], [7, 8, 9])];

describe("curveWaterfallBody", () => {
  it("puts the curves on the union x grid, one row per curve, gaps as null", () => {
    const r = curveWaterfallBody(series, O, "png", "p");
    expect(r.ok && r.body).toMatchObject({
      kind: "waterfall", x_axis: [0, 1, 2, 3], y_axis: [0, 1, 2], view_elev: 30, view_azim: -60, z_label: "Signal",
      z_grid: [[1, 2, 3, null], [null, 4, null, 6], [7, 8, 9, null]],
    });
  });

  it("depth by number in name uses each curve's own number, in the given order", () => {
    const r = curveWaterfallBody(series, { ...O, depth: "number" }, "png", "p");
    expect(r.ok && r.body.y_axis).toEqual([300, 100, 200]);
    expect(r.ok && r.body.y_label).toBe("Number in name");
  });

  it("preview and export are the same request except fmt and filename", () => {
    const a = curveWaterfallBody(series, O, "png", "preview");
    const b = curveWaterfallBody(series, O, "pdf", "waterfall3d_Signal");
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect({ ...a.body, fmt: "", filename: "" }).toEqual({ ...b.body, fmt: "", filename: "" });
  });

  it("fails closed: one curve, a name without a number, bad angles, no shared x", () => {
    expect(curveWaterfallBody(series.slice(0, 1), O, "png", "p")).toMatchObject({ ok: false, error: expect.stringMatching(/at least 2 curves/) });
    expect(curveWaterfallBody([...series, S("blank", [0, 1], [1, 2])], { ...O, depth: "number" }, "png", "p")).toMatchObject({
      ok: false, error: expect.stringMatching(/"blank" has no number/),
    });
    expect(curveWaterfallBody(series, { ...O, elev: 95 }, "png", "p")).toMatchObject({ ok: false });
    expect(curveWaterfallBody([S("a", [1], [1]), S("b", [1], [2])], O, "png", "p")).toMatchObject({ ok: false });
  });
});
