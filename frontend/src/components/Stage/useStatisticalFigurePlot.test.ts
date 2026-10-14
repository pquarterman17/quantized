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

  it("refuses a brush callback retained across a source edit", () => {
    const { result } = renderHook(() => useStatisticalFigurePlot(source, figure(true)));
    const staleBrush = result.current.onRowsSelected;
    act(() => useApp.setState({ datasets: [{
      ...source, data: { ...source.data, values: [[200], [400]] },
    }] }));
    act(() => staleBrush([1]));
    expect(useApp.getState().selection).toBeNull();
    expect(useApp.getState().status).toContain("source changed");
  });

  it("rebuilds row identities when identical rows exchange exclusion state", () => {
    const duplicate: Dataset = {
      ...source, excludedRows: [0],
      data: { ...source.data, time: [0, 0], values: [[2], [2]] },
    };
    const fingerprint = analysisDataFingerprint(duplicate);
    const saved = createFigureDocument({
      id: "duplicate-figure", name: "Duplicate result", datasetId: null,
      view: { ...defaultPlotView(), yKeys: [0] },
      data: { mode: "frozen", snapshot: {
        time: [0], values: [[2]], labels: ["Y"], units: [""], metadata: {
          sourceDatasetId: duplicate.id, sourceFingerprint: fingerprint,
          analysisSourceLink: { kind: "direct", rows: [1] },
        },
      } },
    });
    useApp.setState({ datasets: [duplicate], activeId: duplicate.id, selection: null });
    const { result } = renderHook(() => useStatisticalFigurePlot(duplicate, saved));
    const staleBrush = result.current.onRowsSelected;
    act(() => useApp.setState({ datasets: [{ ...duplicate, excludedRows: [1] }] }));
    expect(analysisDataFingerprint(useApp.getState().datasets[0])).toBe(fingerprint);
    act(() => staleBrush([0]));
    expect(useApp.getState().selection).toBeNull();
    expect(useApp.getState().status).toContain("no source rows");
  });
});
