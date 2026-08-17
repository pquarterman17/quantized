import { describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import {
  assignQuickFigureColumn,
  assignmentFor,
  initialQuickFigureMapping,
  mappingReady,
  useAcquisitionAxis,
} from "./quickFigureMapping";

const dataset: Dataset = {
  id: "d1",
  name: "xyerr.csv",
  data: {
    time: [0, 1],
    values: [[2, .1, 4], [3, .2, 5]],
    labels: ["signal", "signal_err", "other"],
    units: ["V", "V", "A"],
    metadata: {},
  },
};

describe("Quick Figure Builder mapping draft", () => {
  it("seeds defensible error inference without plotting the error as Y", () => {
    const mapping = initialQuickFigureMapping(dataset);
    expect(mapping.yKeys).toEqual([0, 2]);
    expect(mapping.errorBindings).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    expect(assignmentFor(mapping, 1).role).toBe("error");
    expect(mappingReady(mapping)).toBe(true);
  });

  it("keeps roles exclusive and drops bindings whose target stops being Y", () => {
    const initial = initialQuickFigureMapping(dataset);
    const x = assignQuickFigureColumn(initial, 0, { role: "x" });
    expect(x.xKey).toBe(0);
    expect(x.yKeys).toEqual([2]);
    expect(x.errorBindings).toEqual([]);
    const ignored = assignQuickFigureColumn(x, 0, { role: "ignore" });
    expect(ignored.xKey).toBeNull();
    expect(ignored.ignoredKeys).toContain(0);
  });

  it("supports explicit asymmetric Y and X error assignments", () => {
    let mapping = assignQuickFigureColumn(initialQuickFigureMapping(dataset), 1, {
      role: "error", target: 2, axis: "y", side: "+",
    });
    expect(mapping.errorBindings).toContainEqual({ channel: 1, target: 2, axis: "y", side: "+" });
    mapping = assignQuickFigureColumn(mapping, 0, { role: "error", target: -1, axis: "x", side: "-" });
    expect(mapping.errorBindings).toContainEqual({ channel: 0, target: -1, axis: "x", side: "-" });
    expect(mappingReady(mapping)).toBe(true);
  });

  it("can restore the immutable acquisition axis after choosing a value column as X", () => {
    const alternate = assignQuickFigureColumn(initialQuickFigureMapping(dataset), 2, { role: "x" });
    expect(useAcquisitionAxis(alternate).xKey).toBeNull();
  });
});
