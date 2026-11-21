import { describe, expect, it } from "vitest";

import { axisDraft, axisPatch, type AxisView } from "./axisDialogModel";
import type { AxisFormat } from "./axisFormat";
import { defaultPlotView } from "./plotview";
import { figureDivides, originDivideFmt, originDividePatch, originPanelFmt, type TickLabelDivide, withY2PanelFmt } from "./originTickDivide";
import type { OriginFigure } from "./types";

const AUTO: AxisFormat = { mode: "auto", digits: 2 };
const fig = (divide: TickLabelDivide | undefined): OriginFigure =>
  ({ name: "Graph1", x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false, n_curves: 0, annotations: [], tick_label_divide: divide }) as OriginFigure;

describe("Axis dialog edits of an Origin Divide by", () => {
  const view = { ...defaultPlotView(), yFmt: { ...AUTO, divide: 100, divideMark: false } } as AxisView;
  it("keeps Origin's unmarked factor when another field is edited", () => {
    const next = axisPatch(view, "y", { ...axisDraft(view, "y"), size: "14" });
    expect(next.yFmt).toMatchObject({ divide: 100, divideMark: false });
  });
  it("makes a NEW factor the user's own, drawn with its mark", () => {
    const next = axisPatch(view, "y", { ...axisDraft(view, "y"), divide: "1000" });
    expect(next.yFmt?.divide).toBe(1000);
    expect(next.yFmt?.divideMark).toBeUndefined();
    const cleared = axisPatch(view, "y", { ...axisDraft(view, "y"), divide: "" });
    expect(cleared.yFmt?.divide).toBeUndefined();
    expect(cleared.yFmt?.divideMark).toBeUndefined();
  });
});

describe("Origin tick-label Divide by", () => {
  it("divides without the ×factor mark Origin never draws", () => {
    expect(originDivideFmt(AUTO, 10)).toEqual({ mode: "auto", digits: 2, divide: 10, divideMark: false });
  });

  it("drops an earlier Origin factor but keeps a user's own Axis-dialog divide", () => {
    expect(originDivideFmt({ ...AUTO, divide: 10, divideMark: false }, undefined)).toEqual(AUTO);
    const own: AxisFormat = { ...AUTO, divide: 1000 };
    expect(originDivideFmt(own, undefined)).toBe(own);
  });

  it("ignores factors that change nothing or are not numbers", () => {
    expect(originDivideFmt(AUTO, 1)).toBe(AUTO);
    expect(originDivideFmt(AUTO, 0)).toBe(AUTO);
    expect(originDivideFmt(AUTO, Number.NaN)).toBe(AUTO);
  });

  it("maps a layer's sides to the plot's axes; a double-Y pair's right axis is the upper layer's", () => {
    expect(figureDivides(fig({ bottom: 10, left: 0.1 }))).toEqual({ x: 10, y: 0.1, y2: undefined });
    expect(figureDivides(fig({ left: 10 }), fig({ right: 10 }))).toEqual({ x: undefined, y: 10, y2: 10 });
  });

  it("keeps the right axis off the left axis' factor", () => {
    const patch = originDividePatch({ xFmt: AUTO, yFmt: AUTO, y2Fmt: null }, { y: 10 });
    expect(patch.yFmt.divide).toBe(10);
    expect(patch.y2Fmt).toEqual(AUTO);
    expect(originDividePatch({ xFmt: AUTO, yFmt: AUTO, y2Fmt: null }, {}).y2Fmt).toBeNull();
  });

  it("gives a spatial panel its own overrides", () => {
    expect(originPanelFmt(fig(undefined))).toBeUndefined();
    expect(originPanelFmt(fig({ bottom: 10 }))).toEqual({ x: { divide: 10, divideMark: false } });
    const left = originPanelFmt(fig({ left: 10 }));
    expect(left).toEqual({ y: { divide: 10, divideMark: false }, y2: {} });
    expect(withY2PanelFmt(left, fig({ right: 10 }))?.y2).toEqual({ divide: 10, divideMark: false });
    expect(withY2PanelFmt(left, fig({}))).toBe(left);
  });
});
