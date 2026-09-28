// P2.6 box 1 — the error-bar footnote appears exactly when the painters draw
// at least one error bar, and names the kind they draw.

import { describe, expect, it } from "vitest";

import { seriesStat } from "../../lib/barlayout";
import { resolveStatMarks, type StatMarks } from "../../lib/statMarks";
import { boxStatsClient, type StatMode } from "../../lib/statstage";
import { drawsErrorBars, figureErrorNote } from "./statErrorNote";
import type { StatDrawData } from "./statRender";
import type { FacetDraw } from "./useStatStageCompute";

const box = (label: string, values: number[]) => boxStatsClient(values, 1.5, label);
const marks = (mode: StatMode, m: StatMarks) => resolveStatMarks(mode, m);

function boxDraw(m: StatMarks, groups: number[][] = [[1, 2, 3], [4, 5, 7]]): StatDrawData {
  return {
    mode: "box", boxes: groups.map((g, i) => box(`g${i}`, g)), valueLabel: "y", groupLabel: "g",
    marks: marks("box", m),
  };
}

function barDraw(m: StatMarks, series: number[][][], stacked = false): StatDrawData {
  return {
    mode: "bar", valueLabel: "y", groupLabel: "g", stacked, marks: marks("bar", m),
    data: {
      seriesLabels: series[0].map((_, i) => `s${i}`),
      groups: series.map((row, gi) => ({ label: `c${gi}`, series: row.map((v) => seriesStat(v)) })),
    },
  };
}

describe("figureErrorNote", () => {
  it("box: only with the MEAN marker, naming the chosen kind", () => {
    expect(figureErrorNote(boxDraw({}), null)).toBeNull(); // no summary marker
    expect(figureErrorNote(boxDraw({ summary: "median" }), null)).toBeNull();
    expect(figureErrorNote(boxDraw({ summary: "mean" }), null)).toBe("Error bars: 95% CI of the mean");
    expect(figureErrorNote(boxDraw({ summary: "mean", errorBars: "sd" }), null)).toBe("Error bars: SD");
    expect(figureErrorNote(boxDraw({ summary: "mean", errorBars: "se" }), null)).toBe("Error bars: SE of the mean");
    expect(figureErrorNote(boxDraw({ summary: "mean", errorBars: "none" }), null)).toBeNull();
  });

  it("says nothing when no group has a bar to draw (every n < 2)", () => {
    const single = boxDraw({ summary: "mean", errorBars: "sd" }, [[1], [4]]);
    expect(drawsErrorBars(single)).toBe(false);
    expect(figureErrorNote(single, null)).toBeNull();
    // One group with a bar is enough.
    expect(figureErrorNote(boxDraw({ summary: "mean", errorBars: "sd" }, [[1], [4, 6]]), null)).toBe("Error bars: SD");
  });

  it("strip reads the same mean-marker rule; violin never carries one", () => {
    const strip: StatDrawData = {
      mode: "strip", boxes: [box("a", [1, 2, 4])], points: [], valueLabel: "y", groupLabel: "g",
      marks: marks("strip", { summary: "mean", errorBars: "se" }),
    };
    expect(figureErrorNote(strip, null)).toBe("Error bars: SE of the mean");
    const violin: StatDrawData = {
      mode: "violin", violins: [], valueLabel: "y", groupLabel: "g", marks: marks("violin", { errorBars: "sd" }),
    };
    expect(figureErrorNote(violin, null)).toBeNull();
  });

  it("bar: on by default (SE), off for none or when every cell has n < 2", () => {
    expect(figureErrorNote(barDraw({}, [[[1, 2, 3]], [[2, 4]]]), null)).toBe("Error bars: SE of the mean");
    expect(figureErrorNote(barDraw({ errorBars: "ci95" }, [[[1, 2, 3]]]), null)).toBe("Error bars: 95% CI of the mean");
    expect(figureErrorNote(barDraw({ errorBars: "none" }, [[[1, 2, 3]]]), null)).toBeNull();
    expect(figureErrorNote(barDraw({}, [[[1]], [[2]]]), null)).toBeNull();
  });

  it("stacked bar: only the TOP segment's whisker counts (statRenderBar's rule)", () => {
    // Lower series has a spread, the top one a single value: no whisker drawn.
    expect(drawsErrorBars(barDraw({}, [[[1, 2, 3], [5]]], true))).toBe(false);
    expect(drawsErrorBars(barDraw({}, [[[1], [5, 6]]], true))).toBe(true);
    // Clustered, the same data draws the lower series' whisker.
    expect(drawsErrorBars(barDraw({}, [[[1, 2, 3], [5]]], false))).toBe(true);
  });

  it("faceted: one note for the grid when ANY panel draws a bar", () => {
    const panel = (label: string, groups: number[][]): FacetDraw =>
      ({ label, draw: boxDraw({ summary: "mean", errorBars: "se" }, groups) });
    expect(figureErrorNote(null, [panel("f0", [[1]]), panel("f1", [[1, 3]])])).toBe("Error bars: SE of the mean");
    expect(figureErrorNote(null, [panel("f0", [[1]]), panel("f1", [[2]])])).toBeNull();
    expect(figureErrorNote(null, null)).toBeNull();
  });
});
