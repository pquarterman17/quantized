import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { buildPlots2Request, guessPlots2Picks } from "./plots2Request";

function table(n = 20): DataStruct {
  const time: number[] = [];
  const values: number[][] = [];
  for (let i = 0; i < n; i++) {
    time.push(i);
    values.push([50 + i, 51 + i + (i % 3), i * 2]);
  }
  return { time, values, labels: ["A", "B", "C"], units: ["", "", ""], metadata: { x_column_name: "run" } };
}
const opts = { title: "t", filename: "f" };

describe("plots2 request", () => {
  it("guesses X-first picks and wires columns from the X column (0)", () => {
    const d = table();
    const g = guessPlots2Picks(d);
    expect(g.cols).toEqual([-1, 0, 1, 2]);
    const b = buildPlots2Request(d, "parallel", g, opts);
    expect(b.spec?.plots2).toMatchObject({ kind: "parallel", cols: [0, 1, 2, 3], normalize: "minmax" });
    expect(b.spec?.plots2?.color_col).toBeUndefined();
    expect(buildPlots2Request(d, "parallel", { ...g, colorBy: 2 }, opts).spec?.plots2?.color_col).toBe(3);
  });

  it("maps hexbin / kde2d onto density2d with the method", () => {
    const d = table();
    const g = { ...guessPlots2Picks(d), x: 0, y: 1 };
    expect(buildPlots2Request(d, "hexbin", g, opts).spec?.plots2).toMatchObject({ kind: "density2d", method: "hexbin", x_col: 1, y_col: 2, gridsize: 30 });
    const k = buildPlots2Request(d, "kde2d", g, opts).spec;
    expect(k?.plots2).toMatchObject({ method: "kde", bandwidth: "scott" });
    expect(k?.x_label).toBe("A");
  });

  it("maps Bland-Altman and Pareto columns", () => {
    const d = table();
    const g = { ...guessPlots2Picks(d), x: 0, y: 1, cat: -1, val: 2 };
    expect(buildPlots2Request(d, "blandAltman", g, opts).spec?.plots2).toMatchObject({ kind: "bland_altman", x_col: 1, y_col: 2, show_ci: true });
    expect(buildPlots2Request(d, "pareto", g, opts).spec?.plots2).toMatchObject({ kind: "pareto", cat_col: 0, value_col: 3 });
  });

  it("refuses unusable picks before a round trip and counts dropped rows", () => {
    const d = table();
    const g = guessPlots2Picks(d);
    expect(buildPlots2Request(d, "parallel", { ...g, cols: [0, 0] }, opts).problem).toMatch(/two different/);
    expect(buildPlots2Request(d, "blandAltman", { ...g, x: 1, y: 1 }, opts).problem).toMatch(/two different/);
    expect(buildPlots2Request(table(5), "hexbin", { ...g, x: 0, y: 1 }, opts).problem).toMatch(/at least 10/);
    const holes = table();
    holes.values[3]![0] = NaN;
    const b = buildPlots2Request(holes, "blandAltman", { ...g, x: 0, y: 1 }, opts);
    expect(b.dropped).toBe(1);
    expect(b.spec).not.toBeNull();
  });
});
