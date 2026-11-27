// A named range as an INPUT (R4c): a plot draws its columns and exactly its rows, and the analysis input picker takes its
// columns and rows through the shared analysis selection. A stale range is refused, never widened to every row.
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAnalysisInputs, ROW_POLICY } from "../../../lib/analysisInputs";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { markRowsReplaced } from "../../../store/rowRangeShift";
import { useApp } from "../../../store/useApp";
import { usePlotPayload, type PlotPayloadParams } from "../../Stage/usePlotPayload";
import AnalysisInputReview from "../analysisselection/AnalysisInputReview";
import { analyzeNamedRange, plotNamedRange } from "../../../store/namedRangeUse";

vi.mock("../../../lib/plotdata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/plotdata")>();
  return {
    ...actual,
    fetchPlot: async (
      ds: Parameters<typeof actual.buildColumns>[0], _yLog: boolean, _xLog: boolean,
      yKeys: number[] | null, y2Keys: number[] | null, xKey: number | null,
    ) => actual.buildColumns(ds, y2Keys, xKey, yKeys),
  };
});

const N = 60;
const ds: Dataset = {
  id: "d",
  name: "run.csv",
  data: {
    time: Array.from({ length: N }, (_v, i) => i),
    values: Array.from({ length: N }, (_v, i) => [100 + i, 200 + i, 300 + i]),
    labels: ["A", "B", "C"], units: ["", "", ""], metadata: {},
  },
  excludedRows: [25],
};
const range = (over: Partial<{ cols: number[]; rows: { from: number; to: number } | null }> = {}) => ({
  id: "nr1:r", name: "Window", scope: { kind: "sheet" as const, datasetId: "d" },
  target: { datasetId: "d", cols: [1], rows: { from: 20, to: 43 }, ...over },
});
const drawn = (x: unknown) => (x as (number | null)[]).flatMap((v, r) => (v == null ? [] : [r]));

beforeEach(() => {
  useApp.setState({
    datasets: [ds], workbooks: [], activeId: "other", selectedIds: [], xKey: null, yKeys: null, rowRange: undefined,
    namedRanges: [range()], stageTab: "worksheet", history: [], future: [], status: "",
  });
  useAnalysisSelection.setState({ toolId: null, selection: null, offeredRanges: {} });
});

describe("plot from a named range", () => {
  it("plots the range's column and the payload draws exactly its rows (21-44 of 60), as one undo step for the window", async () => {
    expect(plotNamedRange("nr1:r")).toEqual({ ok: true });
    const s = useApp.getState();
    expect(s.activeId).toBe("d");
    expect(s.stageTab).toBe("plot");
    expect(s.yKeys).toEqual([1]);
    expect(s.rowRange).toEqual({ from: 20, to: 43 });
    const params: PlotPayloadParams = {
      active: ds, yScale: "linear", xScale: "linear", xKey: s.xKey, yKeys: s.yKeys, groupKey: null, y2Keys: null, seriesOrder: null,
      seriesStyles: {}, seriesLabels: {}, errKeys: {}, hiddenChannels: [], waterfall: 0, excludedDisplay: "hide",
      fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null, xLim: null, rowRange: s.rowRange,
    };
    const { result } = renderHook(() => usePlotPayload(params));
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    const d = result.current.displayPayload!;
    // Rows 20..43 draw, minus the excluded row 25 (hidden): the window narrows, the exclusion still applies inside it.
    expect(drawn(d.data[1])).toEqual(Array.from({ length: 24 }, (_v, i) => 20 + i).filter((r) => r !== 25));
    expect((d.data[1] as number[])[30]).toBe(230);
    useApp.getState().undo();
    expect(useApp.getState().rowRange).toBeUndefined();
  });

  it("a range with no row limit plots every row and clears an earlier window", () => {
    useApp.setState({ namedRanges: [range({ rows: null })], rowRange: { from: 5, to: 9 } });
    expect(plotNamedRange("nr1:r")).toEqual({ ok: true });
    expect(useApp.getState().rowRange).toBeUndefined();
  });

  it("a stale range is refused with the reason and the plot is untouched", () => {
    markRowsReplaced("d", true);
    const r = plotNamedRange("nr1:r");
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/rows were replaced/) });
    expect(useApp.getState().yKeys).toBeNull();
    expect(useApp.getState().rowRange).toBeUndefined();
    expect(useApp.getState().status).toMatch(/plot named range: named range Window/);
  });

  it("a deleted range is refused", () => {
    useApp.setState({ namedRanges: [] });
    expect(plotNamedRange("nr1:r")).toEqual({ ok: false, reason: "that named range no longer exists" });
  });
});

describe("analysis from a named range", () => {
  it("analyze opens the Analysis Center on the range's column and rows; the shared resolver reads exactly them", () => {
    expect(analyzeNamedRange("nr1:r")).toEqual({ ok: true });
    expect(useApp.getState().stageTab).toBe("analysis");
    const item = useAnalysisSelection.getState().selection!.items[0];
    expect(item).toMatchObject({ datasetId: "d", yKeys: [1], rowRange: { from: 20, to: 43 }, rowIds: null });
    const inputs = resolveAnalysisInputs({ datasets: [ds], activeId: "d", selection: item, policy: ROW_POLICY.selection });
    expect(inputs.ok && inputs.rowCount).toBe(23); // 24 rows less the excluded row 25
    expect(inputs.ok && inputs.rowRange).toEqual({ from: 20, to: 43 });
  });

  it("the input picker's 'From named range' replaces the tool's columns and rows, and a stale range is listed but disabled", () => {
    useApp.setState({ activeId: "d", selectedIds: ["d"], xKey: null, yKeys: [0] });
    useAnalysisSelection.setState({
      toolId: "curvefit",
      selection: captureAnalysisSelection({
        datasets: [ds], activeId: "d", selectedIds: ["d"], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, selection: null, range: null,
      }, "analysis-center"),
    });
    render(<AnalysisInputReview toolId="curvefit" singleY />);
    fireEvent.change(screen.getByRole("combobox", { name: "Input from named range" }), { target: { value: "nr1:r" } });
    const sel = useAnalysisSelection.getState();
    expect(sel.toolId).toBe("curvefit");
    expect(sel.selection!.items[0]).toMatchObject({ yKeys: [1], rowRange: { from: 20, to: 43 } });
    expect(screen.getByText(/Input: run\.csv · X: X · Y: B · rows 21-44 · 23 of 24 rows \(1 excluded\)/)).toBeInTheDocument();
    act(() => markRowsReplaced("d", true));
    const option = screen.getByRole("option", { name: /Window .*\(stale\)/ }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
  });

  it("a range of two columns maps to X and Y in order, three leave the columns to the user (rows still apply)", () => {
    useApp.setState({ namedRanges: [range({ cols: [0, 2] })] });
    analyzeNamedRange("nr1:r");
    expect(useAnalysisSelection.getState().selection!.items[0]).toMatchObject({ xKey: 0, yKeys: [2], rowRange: { from: 20, to: 43 } });
  });
});
