// The histogram's rug: stamped on a settled draw (no refetch), one tick per
// finite value per column, drawn by the same painter the CDF uses, and posted
// on the histogram export request.
import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../lib/types";
import { draw, type StatDrawData } from "./statRender";
import { withRug } from "./statSampleDraw";

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[1, 5], [2, Number.NaN], [2, 7], [4, 8]],
  labels: ["a", "b"],
  units: ["", ""],
  metadata: {},
};
const HIST: StatDrawData = { mode: "histogram", edges: [1, 2.5, 4], counts: [3, 1], density: false, valueLabel: "a" };

describe("withRug on a histogram draw", () => {
  it("is a no-op while the rug is off, and for other modes", () => {
    expect(withRug(HIST, DATA, [], 0, undefined)).toBe(HIST);
    expect(withRug(HIST, DATA, [], 0, { length: 0.1 })).toBe(HIST);
    const qq: StatDrawData = { mode: "qq", theo: [], obs: [], slope: 1, intercept: 0, dist: "norm", valueLabel: "a" };
    expect(withRug(qq, DATA, [], 0, { on: true })).toBe(qq);
  });
  it("carries the finite values of every binned column", () => {
    const d = withRug(HIST, DATA, [1], 0, { on: true, length: 0.1, opacity: 0.3 });
    if (d?.mode !== "histogram") throw new Error("expected a histogram draw");
    expect(d.rug?.opts).toEqual({ length: 0.1, opacity: 0.3 });
    expect(d.rug?.columns).toEqual([[1, 2, 2, 4], [5, 7, 8]]); // the NaN is not a tick
  });
  it("paints one tick per value in the rug opacity", () => {
    const d = withRug(HIST, DATA, [], 0, { on: true, opacity: 0.25 });
    const paths: { n: number; alpha: number }[] = [];
    let n = 0;
    let alpha = 1;
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(_t, k: string) {
        if (k === "beginPath") return () => { n = 0; };
        if (k === "moveTo" || k === "lineTo") return () => { n++; };
        if (k === "stroke") return () => paths.push({ n, alpha });
        if (k === "globalAlpha") return alpha;
        return () => {};
      },
      set(_t, k: string, v) {
        if (k === "globalAlpha") alpha = v as number;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    draw({ getContext: () => ctx } as unknown as HTMLCanvasElement, { clientWidth: 600, clientHeight: 400 } as HTMLElement, d);
    const rug = paths.filter((p) => p.alpha === 0.25);
    expect(rug).toHaveLength(1);
    expect(rug[0].n).toBe(8); // 4 values x (move + line)
  });
});
