import { describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { selectedFitData } from "./fitSelection";

const dataset: Dataset = {
  id: "d",
  name: "multi.dat",
  data: {
    time: [0, 1, 2, 3],
    values: [[100, 10, 5], [200, 20, 6], [300, 30, 7], [400, 40, 8]],
    labels: ["field", "moment", "aux"],
    units: ["Oe", "emu", ""],
    metadata: {},
  },
  excludedRows: [1],
};

describe("selectedFitData", () => {
  it("uses the plot X and first effective Y after series ordering", () => {
    expect(selectedFitData(dataset, 0, [2, 1], [1, 2])).toEqual({
      x: [100, 300, 400],
      y: [10, 30, 40],
      yKey: 1,
    });
  });

  it("does not select an ignored or X-role channel as Y", () => {
    const roled = { ...dataset, channelRoles: { 1: "ignore" as const } };
    expect(selectedFitData(roled, 0, [0, 1, 2], null)?.yKey).toBe(2);
  });
});
