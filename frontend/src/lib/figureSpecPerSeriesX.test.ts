// Origin gap audit 2 #2, export half: T1,R1,T2,R2 with T2 "Set As X" must
// export R1 against T1 and R2 against T2 -- the same segment-concatenated
// view the canvas draws (Stage/usePlotPayload.perSeriesX.test.ts), with the
// non-monotonic T2 sweep (5 -> 3 -> 9) kept in row order.

import { describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { defaultPlotView } from "./plotview";
import type { Dataset } from "./types";

const sheet: Dataset = {
  id: "mx",
  name: "multix.csv",
  data: {
    time: [1, 2, 3],
    values: [
      [10, 5, 100],
      [20, 3, 200],
      [30, 9, 300],
    ],
    labels: ["R1", "T2", "R2"],
    units: ["ohm", "K", "ohm"],
    metadata: { x_column_name: "T1", x_column_unit: "K" },
  },
  columnDesignations: { 1: "X" },
};

/** (x, y) pairs a wire series draws: rows where both are finite. */
function pairs(spec: ReturnType<typeof buildFigureSpecFromDocument>, label: string): number[][] {
  const ds = spec.dataset as { time: number[]; values: number[][]; labels: string[] };
  const c = ds.labels.indexOf(label);
  return ds.time.flatMap((x, r) => (Number.isFinite(ds.values[r][c]) ? [[x, ds.values[r][c]]] : []));
}

describe("export: each Y on its own X", () => {
  for (const xKey of [null, 1]) {
    it(`R1 on T1, R2 on T2, in row order (plot X = ${xKey === null ? "T1" : "T2"})`, () => {
      const document = createFigureDocument({
        id: "f", name: "multix", datasetId: "mx",
        view: { ...defaultPlotView(), xKey, yKeys: null, hiddenChannels: [1] },
      });
      const spec = buildFigureSpecFromDocument(document, sheet, "multix");
      expect(spec.x_key).toBeUndefined();
      expect(spec.y_keys).toEqual([0, 2]);
      expect(pairs(spec, "R1")).toEqual([[1, 10], [2, 20], [3, 30]]);
      expect(pairs(spec, "R2")).toEqual([[5, 100], [3, 200], [9, 300]]);
    });
  }
});
