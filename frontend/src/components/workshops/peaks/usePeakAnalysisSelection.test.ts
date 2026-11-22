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

  it("a live plot capture whose worksheet is gone follows the active one without its rows or roles", () => {
    const datasets = [sheet("a"), sheet("b")];
    useAnalysisSelection.setState({
      toolId: "peaks",
      selection: captureAnalysisSelection({
        datasets, activeId: "a", selectedIds: [], xKey: null, yKeys: [0],
        seriesOrder: null, errKeys: {}, selection: { datasetId: "a", rows: [1] }, range: null,
      }, "tool-default"),
    });
    useApp.setState({ datasets: [sheet("b")] });
    // The first render (before the mount effect re-seeds from sheet b) must
    // not carry sheet a's selected row 1 or roles onto sheet b.
    const seen: { activeId: string | null; selectedFor: string | null }[] = [];
    const { result } = renderHook(() => {
      const value = usePeakAnalysisSelection();
      seen.push({ activeId: value.activeId, selectedFor: value.selected?.datasetId ?? null });
      return value;
    });
    expect(seen[0]).toEqual({ activeId: "b", selectedFor: null });
    expect(result.current.activeId).toBe("b");
    expect(result.current.selected?.datasetId ?? null).not.toBe("a");
  });
});
