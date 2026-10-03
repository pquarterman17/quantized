// Plot audit round 2: the floating plot dock covered the TOP Y TICK LABEL
// (measured live: dock bottom 65 px, plot frame top 69 px, so a 12 px label
// centred on the frame's top edge started at ~62 px — under the dock).
//
// PlotStage is too heavy to mount in jsdom (see PlotStage.test.tsx), and jsdom
// lays nothing out anyway, so this pins the arithmetic on the source: the
// inset PlotStage hands PlotViewport must put the top tick label's upper edge
// below the dock's tallest row.

import { describe, expect, it } from "vitest";

const plotStageSrc = Object.values(
  import.meta.glob("./PlotStage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;

/** The dock's tallest row ends here (shell.css, GUI_INTERACTION #17: top 12 +
 *  9 px caption + 2 gap + 32 px button + 4+4 padding + border; measured 65). */
const DOCK_BOTTOM = 65;
/** uPlot's automatic top padding with no top axis: round(default x-axis size 50 / 3). */
const UPLOT_TOP_PAD = 17;
/** Half the tallest tick font the screen templates use (14 px, comfortable density). */
const HALF_TICK = 7;
/** Visible breathing room between the dock and the label. */
const GAP = 2;

describe("PlotStage — the plot starts below its dock", () => {
  it("insets the plot host so the top tick label clears the dock", () => {
    const m = plotStageSrc.match(/insetTop=\{(\d+)\}/);
    expect(m, "PlotStage passes a literal insetTop").not.toBeNull();
    const insetTop = Number(m![1]);
    expect(insetTop + UPLOT_TOP_PAD - HALF_TICK).toBeGreaterThanOrEqual(DOCK_BOTTOM + GAP);
  });
});
