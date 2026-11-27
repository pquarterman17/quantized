// Acceptance 7 W2: the on-screen legend swatch goes through the SAME resolver as the plotted line
// (`resolveSeriesStyle`), so "Subgroup size" colours the swatches exactly as it colours the curves.

import { describe, expect, it } from "vitest";

import type { PlotSeriesSpec } from "../../lib/plotdata";
import { displayPositions, resolveSeriesStyle } from "../../lib/seriesStyleCycle";
import { legendRowStyle } from "./legendRowStyle";

const N = 7;
const series = Array.from({ length: N }, (_, i) => ({ label: `s${i + 1}` }) as PlotSeriesSpec);

describe("legendRowStyle with a subgroup size", () => {
  it("each swatch is the colour its plotted line resolves to (N=3 on 7 series)", () => {
    const cycle = displayPositions(3, N);
    const rows = series.map((s, i) => legendRowStyle(s, i, undefined, cycle, true, undefined));
    expect(rows.map((r) => r.swatch)).toEqual([1, 1, 1, 2, 2, 2, 3].map((n) => `var(--series-${n})`));
    series.forEach((_, i) => {
      const line = resolveSeriesStyle(undefined, i, cycle);
      expect(rows[i].swatch).toBe(`var(${line?.color})`);
      expect(rows[i].sample).toMatchObject({ line: line?.line, markerShape: line?.markerShape });
    });
  });

  it("an explicit colour still wins, and with no subgroup the swatch cycles per series as before", () => {
    expect(legendRowStyle(series[4], 4, [, , , , { color: "--series-7" }], displayPositions(3, N), true, undefined).swatch).toBe("var(--series-7)");
    const plain = series.map((s, i) => legendRowStyle(s, i, undefined, displayPositions(true, N), true, undefined).swatch);
    expect(plain).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => `var(--series-${n})`));
    expect(legendRowStyle(series[5], 5, undefined, undefined, true, undefined).swatch).toBe("var(--series-6)");
  });
});
