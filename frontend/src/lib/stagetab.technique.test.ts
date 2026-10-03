import { describe, expect, it } from "vitest";

import { nextStageTab, plotIntentStageTab } from "./stagetab";
import type { Dataset } from "./types";

const dataset = (is2D = false): Dataset => ({
  id: "d1",
  name: "d1",
  data: {
    time: [0],
    values: [[1, 2, 3]],
    labels: ["x", "y", "z"],
    units: ["", "", ""],
    metadata: { is2D },
  },
});

describe("technique Stage routing", () => {
  it("follows passive dataset changes while an explicit technique workspace is open", () => {
    expect(nextStageTab(dataset(), "technique")).toBe("technique");
    expect(nextStageTab(dataset(true), "technique")).toBe("technique");
  });

  it("still leaves the workspace for an explicit plot intent", () => {
    expect(plotIntentStageTab(dataset())).toBe("plot");
    expect(plotIntentStageTab(dataset(true))).toBe("map");
  });
});
