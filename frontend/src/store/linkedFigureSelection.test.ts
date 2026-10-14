import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../lib/types";
import { setLinkedFigureSourceSelection } from "./linkedFigureSelection";
import { useApp } from "./useApp";

const dataset = (id: string): Dataset => ({
  id, name: id,
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["Y"], units: [""], metadata: {} },
});

describe("setLinkedFigureSourceSelection", () => {
  beforeEach(() => useApp.setState({ datasets: [dataset("d1"), dataset("d2")], activeId: "d1", selection: null }));

  it("selects validated source rows without rebinding the focused dataset", () => {
    setLinkedFigureSourceSelection("d2", [2, 0, 2, -1, 9]);
    expect(useApp.getState().activeId).toBe("d1");
    expect(useApp.getState().selection).toEqual({ datasetId: "d2", rows: [0, 2] });
  });
});
