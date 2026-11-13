// The divide-by factor ("×10³") on the canvas (figures leftover d): drawn
// OUTSIDE the frame where the export's matplotlib offset text sits, in the
// axis' own tick-label font, with a band reserved above the frame for a Y
// factor. It used to be drawn small inside the plot's top-left corner, under
// the legend's default spot.

import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import { applyAxisExtras } from "./axisExtras";
import { loadAxisExtras } from "./axisExtrasHook";
import { divideFont, divideLabelSpot, divideTopPadding, reserveDivideBand } from "./axisDivideLabel";
import { buildOpts } from "./uplotOpts";

const BBOX = { left: 60, top: 30, width: 400, height: 300 };

/** Run the extras' draw hook on a fake uPlot and record each fillText. */
function drawn(side: 1 | 2 | 3, font: uPlot.Axis["font"] | [string, number]) {
  const axes: uPlot.Axis[] = [{ side, font: font as uPlot.Axis["font"] }];
  const plugin = applyAxisExtras(axes, [{ mode: "auto", digits: 2, divide: 1000 }], ["linear"], "#000");
  const texts: { text: string; x: number; y: number; font: string }[] = [];
  const ctx = {
    font: "",
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, font: this.font });
    },
  };
  const u = { ctx, bbox: BBOX, axes, valToPos: () => 0 } as unknown as uPlot;
  (plugin?.hooks.draw as (u: uPlot) => void)(u);
  return texts;
}

describe("divide-by factor placement (canvas)", () => {
  it("a Y factor sits above the frame, in the axis' own tick font", () => {
    const [t] = drawn(3, ["14px JetBrains Mono", 14]);
    expect(t.text).toBe("×10³");
    expect(t.y).toBeLessThan(BBOX.top);
    expect(t.x).toBe(BBOX.left);
    expect(t.font).toBe("14px JetBrains Mono");
  });

  it("a Y2 factor sits above the frame at the right end", () => {
    const [t] = drawn(1, ["14px JetBrains Mono", 14]);
    expect(t.y).toBeLessThan(BBOX.top);
    expect(t.x).toBe(BBOX.left + BBOX.width);
  });

  it("an X factor sits below the tick labels at the right end, outside the frame", () => {
    const [t] = drawn(2, ["14px JetBrains Mono", 14]);
    expect(t.y).toBeGreaterThan(BBOX.top + BBOX.height + 14);
    expect(t.x).toBe(BBOX.left + BBOX.width);
  });

  it("reads uPlot's initialised [font, px] axis font and a CSS string alike", () => {
    expect(divideFont(["24px Mono", 24], 2)).toEqual({ font: "24px Mono", px: 24 });
    expect(divideFont("12px Mono", 2)).toEqual({ font: "24px Mono", px: 24 });
    expect(divideLabelSpot(3, BBOX, 1, 12).baseline).toBe("bottom");
  });
});

describe("divide-by factor band (canvas)", () => {
  it("a Y factor widens the top padding enough for its font; an X factor does not", () => {
    const opts = { axes: [{ side: 2, font: "12px Mono" }, { side: 3, font: "12px Mono" }], padding: [null, 8, null, null] } as unknown as uPlot.Options;
    expect(reserveDivideBand(opts, [1]).padding).toEqual([divideTopPadding("12px Mono"), 8, null, null]);
    expect(divideTopPadding("12px Mono")).toBeGreaterThanOrEqual(12 + 8);
    expect(reserveDivideBand(opts, [0])).toBe(opts);
  });

  it("buildOpts' extras plugin reserves the band once the on-demand module has loaded", async () => {
    await loadAxisExtras();
    const payload = { data: [[0, 1], [0, 1]], series: [{ label: "y", unit: "", axis: 0 }], xLabel: "x", xUnit: "" };
    const args = { width: 400, height: 300, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: () => {}, yFmt: { mode: "auto", digits: 2, divide: 1000 } };
    const opts = buildOpts(payload as never, args as never);
    const after = (opts.plugins ?? []).reduce((o, p) => (p.opts ? (p.opts({} as uPlot, o) as uPlot.Options) ?? o : o), opts);
    expect(after.padding?.[0]).toBeGreaterThanOrEqual(divideTopPadding(String(opts.axes?.[1]?.font)));
  });
});
