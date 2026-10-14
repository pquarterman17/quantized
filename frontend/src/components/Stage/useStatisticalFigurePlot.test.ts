import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { analysisDataFingerprint } from "../../lib/analysisResultFreshness";
import { createFigureDocument } from "../../lib/figureDocument";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { useStatisticalFigurePlot } from "./useStatisticalFigurePlot";

const source: Dataset = {
  id: "source", name: "Source",
  data: { time: [0, 1], values: [[2], [4]], labels: ["Y"], units: [""], metadata: {} },
};

const figure = (linked: boolean) => createFigureDocument({
  id: "figure", name: "Saved result", datasetId: null, view: { ...defaultPlotView(), yKeys: [0] },
  data: { mode: "frozen", snapshot: {
    time: [0, 1], values: [[20], [40]], labels: ["Mean"], units: [""],
    metadata: linked ? {
      sourceDatasetId: source.id,
      sourceFingerprint: analysisDataFingerprint(source),
      analysisSourceLink: { kind: "direct", rows: [0, 1] },
    } : {},
  } },
});

describe("useStatisticalFigurePlot", () => {
  beforeEach(() => useApp.setState({ datasets: [source], activeId: source.id, selection: null }));

  it("maps a frozen-figure brush to its live source rows", () => {
    const { result } = renderHook(() => useStatisticalFigurePlot(source, figure(true)));
    act(() => result.current.onRowsSelected([1]));
    expect(useApp.getState().selection).toEqual({ datasetId: source.id, rows: [1] });
  });

  it("never applies unlinked snapshot row numbers to the active worksheet", () => {
    useApp.setState({ selection: { datasetId: source.id, rows: [0] } });
    const { result } = renderHook(() => useStatisticalFigurePlot(source, figure(false)));
    expect(result.current.displaySelection).toBeNull();
    act(() => result.current.onRowsSelected([1]));
    expect(useApp.getState().selection).toEqual({ datasetId: source.id, rows: [0] });
  });
});
