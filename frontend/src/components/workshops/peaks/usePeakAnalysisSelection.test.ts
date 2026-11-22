import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { usePeakAnalysisSelection } from "./usePeakAnalysisSelection";

const sheet = (id: string): Dataset => ({
  id, name: id, data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["y"], units: [""], metadata: {} },
});

beforeEach(() => {
  const datasets = [sheet("a"), sheet("b")];
  useApp.setState({ datasets, activeId: "b", selectedIds: [], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {} });
  useAnalysisSelection.setState({
    toolId: "peaks",
    selection: captureAnalysisSelection({
      datasets, activeId: "a", selectedIds: ["a"], xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "analysis-center"),
  });
});

describe("usePeakAnalysisSelection — shared dataset precedence", () => {
  it("analyses the handoff's worksheet, not the active one", () => {
    const { result } = renderHook(() => usePeakAnalysisSelection());
    expect(result.current.activeId).toBe("a");
  });

  it("refuses (no dataset) when the handoff's worksheet is deleted, instead of swapping in the active one", () => {
    useApp.setState({ datasets: [sheet("b")] });
    const { result } = renderHook(() => usePeakAnalysisSelection());
    expect(result.current.active).toBeNull();
  });
});
