// Plot audit round 4, measured on NCNR PNR (Rpp/Rmm/Tpp/Tmm with dR and dQ):
// the canvas drew every series' error bars in one dim ink while the export
// draws each in its series' colour (`calc/figure_errorbars.py`), so four
// overlapping curves' bars could not be told apart on screen and read
// differently in the PDF. A hidden series' bars are not drawn either.
import { describe, expect, it } from "vitest";

import { errorBarsPlugin, errorSpansPlugin } from "./uplotOverlays";

function stub(series: { stroke?: unknown; show?: boolean }[]) {
  const inks: string[] = [];
  const ctx = {
    strokeStyle: "",
    lineWidth: 0,
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      inks.push(ctx.strokeStyle);
    },
  };
  const u = {
    ctx,
    bbox: { left: 0, top: 0, width: 100, height: 100 },
    valToPos: (v: number) => v,
    data: [[0, 1], [10, 20], [30, 40]],
    series: [{}, ...series],
  };
  return { u, inks };
}

describe("error bar ink", () => {
  it("draws each column's bars in its series' colour (a function stroke too)", () => {
    const { u, inks } = stub([{ stroke: "#ff0000" }, { stroke: () => "#00ff00" }]);
    const bars = errorBarsPlugin(new Map([[1, [1, 1]], [2, [1, 1]]]), "#dim");
    // @ts-expect-error — minimal stub stands in for a real uPlot instance
    bars.hooks.draw?.(u);
    expect(inks).toEqual(["#ff0000", "#ff0000", "#00ff00", "#00ff00"]);
  });

  it("falls back to the dim ink without a series colour, and skips a hidden series", () => {
    const { u, inks } = stub([{}, { stroke: "#00ff00", show: false }]);
    const spans = errorSpansPlugin(
      new Map([
        [1, [{ axis: "y" as const, plus: [1, 1], minus: [1, 1] }]],
        [2, [{ axis: "y" as const, plus: [1, 1], minus: [1, 1] }]],
      ]),
      "#dim",
    );
    // @ts-expect-error — minimal stub stands in for a real uPlot instance
    spans.hooks.draw?.(u);
    expect(inks).toEqual(["#dim", "#dim"]);
  });
});
