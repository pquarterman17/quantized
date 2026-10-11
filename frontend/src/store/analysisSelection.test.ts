import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../lib/types";
import { seedWorksheetAnalysisSelection, useAnalysisSelection } from "./analysisSelection";
import { useApp } from "./useApp";

const dataset: Dataset = {
  id: "sheet", name: "sheet.csv",
  data: {
    time: [0, 1, 2], values: [[10, 1, 0], [20, 2, 1], [30, 3, 0]],
    labels: ["Field", "Signal", "Lot"], units: ["Oe", "emu", ""], metadata: {},
    cat_levels: { 2: ["A", "B"] },
  },
  errorRoles: [{ channel: 0, target: 1, axis: "y", side: "both" }],
};

beforeEach(() => {
  useApp.setState({ datasets: [dataset], activeId: "sheet", selectedIds: [] });
  useAnalysisSelection.setState({ toolId: null, selection: null });
});

describe("worksheet analysis handoff", () => {
  it("maps selected X/Y/factor columns and exact original rows into one selection", () => {
    const selection = seedWorksheetAnalysisSelection("sheet", [0, 1, 2], [0, 2]);
    expect(selection?.source).toBe("worksheet");
    expect(selection?.items[0]).toMatchObject({
      datasetId: "sheet", xKey: 0, yKeys: [1], factorKeys: [2], rowIds: [0, 2],
    });
    expect(useAnalysisSelection.getState().toolId).toBe("analysis-center");
  });

  it("does not dirty project history or invent a selection for a missing worksheet", () => {
    const before = useApp.getState().history;
    expect(seedWorksheetAnalysisSelection("missing", [0], [])).toBeNull();
    expect(useApp.getState().history).toBe(before);
  });
});
