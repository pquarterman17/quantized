import { describe, expect, it } from "vitest";

import { plotSvgBody } from "./thumbnailSvg";
import type { DataStruct } from "./types";

const data: DataStruct = {
  time: [0, 1, 2],
  values: [[1, 2, 3], [2, 3, 4], [3, 4, 5]],
  labels: ["a", "b", "c"],
  units: ["", "", ""],
  metadata: {},
};

describe("plotSvgBody selection", () => {
  it("null/undefined yKeys previews the 3-channel default", () => {
    expect((plotSvgBody(data, null, null).match(/<polyline/g) ?? []).length).toBe(3);
  });
  it("an explicit empty selection previews empty, not phantom data", () => {
    const body = plotSvgBody(data, null, []);
    expect(body).not.toContain("<polyline");
    expect(body).toContain("No plottable data");
  });
});
