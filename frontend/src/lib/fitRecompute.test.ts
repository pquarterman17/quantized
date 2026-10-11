import { describe, expect, it } from "vitest";

import { fitOverlayValues } from "./fitRecompute";
import type { Dataset } from "./types";

const dataset: Dataset = {
  id: "d", name: "d.csv",
  data: { time: [0, 1, 2, 3], values: [[1], [2], [3], [4]], labels: ["Y"], units: [""], metadata: {} },
};

describe("fitOverlayValues shared-selection alignment", () => {
  it("restores gap positions then maps the subset to original worksheet rows", () => {
    expect(fitOverlayValues(dataset, { x: [0, 2], y: [1, 3], keep: [0, 2], n: 3, complete: false }, [10, 30], [1, 2, 3]))
      .toEqual([null, 10, Number.NaN, 30]);
  });
});
