import { beforeEach, describe, expect, it } from "vitest";

import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
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
    expect(setLinkedFigureSourceSelection("d2", [2, 0, 2, -1, 9], analysisDataFingerprint(dataset("d2"))))
      .toBe(true);
    expect(useApp.getState().activeId).toBe("d1");
    expect(useApp.getState().selection).toEqual({ datasetId: "d2", rows: [0, 2] });
  });

  it("refuses a mapping retained across a source-data change", () => {
    const before = useApp.getState().datasets[1];
    const fingerprint = analysisDataFingerprint(before);
    useApp.setState({ datasets: [useApp.getState().datasets[0], {
      ...before, data: { ...before.data, values: [[10], [20], [30]] },
    }] });
    expect(setLinkedFigureSourceSelection("d2", [1], fingerprint)).toBe(false);
    expect(useApp.getState().selection).toBeNull();
  });
});
