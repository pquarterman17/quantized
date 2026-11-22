import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import PlotReadouts from "../Stage/PlotReadouts";
import { usePointLabelReadout } from "../Stage/usePointLabelLayout";
import PointLabelsCard from "./PointLabelsCard";
import type { PlotPayload } from "../../lib/plotdata";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

const DATASET = {
  id: "d1",
  name: "d1",
  data: {
    time: [0, 1, 2, 3],
    values: [[1, 0, 5], [4, 1, 6], [9, 0, 7], [16, 1, 8]],
    labels: ["y", "wafer", "id"],
    units: ["", "", ""],
    metadata: {},
    cat_levels: { 1: ["W1", "W2"] },
  },
} as unknown as Dataset;

beforeEach(() => {
  useApp.setState({
    datasets: [DATASET], activeId: "d1", pointLabels: null, xKey: null, yKeys: [0], y2Keys: null, groupKey: null, facetKey: null,
    xScale: "linear", yScale: "linear", exchangeXY: false, waterfall: 0, waterfallDx: 0, hiddenChannels: [], seriesStyles: {}, selection: null,
  });
});

describe("PointLabelsCard", () => {
  it("starts off, with the text column marked in the picker", () => {
    render(<PointLabelsCard />);
    fireEvent.click(screen.getByText("Point labels"));
    expect(screen.getByLabelText("Label column")).toHaveValue("");
    expect(screen.getByRole("option", { name: "wafer (text)" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Which points")).toBeNull();
    expect(useApp.getState().pointLabels).toBeNull();
  });

  it("picking a column turns labels on (Top N by default), 'None' turns them off, each one undo step", () => {
    render(<PointLabelsCard />);
    fireEvent.click(screen.getByText("Point labels"));
    fireEvent.change(screen.getByLabelText("Label column"), { target: { value: "1" } });
    expect(useApp.getState().pointLabels).toEqual({ key: 1, mode: "top", topN: 10 });
    fireEvent.change(screen.getByLabelText("Which points"), { target: { value: "all" } });
    expect(useApp.getState().pointLabels?.mode).toBe("all");
    useApp.getState().undo();
    expect(useApp.getState().pointLabels?.mode).toBe("top");
    fireEvent.change(screen.getByLabelText("Label column"), { target: { value: "" } });
    expect(useApp.getState().pointLabels).toBeNull();
  });

  it("Top N accepts 1..100 and ignores anything else", () => {
    useApp.setState({ pointLabels: { key: 1, mode: "top", topN: 10 } });
    render(<PointLabelsCard />);
    fireEvent.click(screen.getByText("Point labels"));
    const n = screen.getByLabelText("Top N");
    fireEvent.change(n, { target: { value: "3" } });
    expect(useApp.getState().pointLabels?.topN).toBe(3);
    fireEvent.change(n, { target: { value: "0" } });
    fireEvent.change(n, { target: { value: "101" } });
    expect(useApp.getState().pointLabels?.topN).toBe(3);
  });

  it("says why nothing is drawn: no selection, and a view that cannot carry labels", async () => {
    useApp.setState({ pointLabels: { key: 1, mode: "selected", topN: 10 } });
    render(<PointLabelsCard />);
    fireEvent.click(screen.getByText("Point labels"));
    // The layout code is a lazy chunk (eager-bundle budget): the message appears once it has loaded.
    expect(await screen.findByRole("status")).toHaveTextContent(/No rows selected/);
    act(() => useApp.setState({ exchangeXY: true }));
    expect(screen.getByRole("status")).toHaveTextContent(/Point labels are not drawn with exchanged/);
  });
});

describe("the hover readout", () => {
  const payload = { data: [[0, 1, 2, 3], [1, 4, 9, 16]], series: [{ label: "y", unit: "", axis: 0 }], xLabel: "x", xUnit: "" } as unknown as PlotPayload;

  it("shows the row number and the label value when a label column is set", () => {
    useApp.setState({ pointLabels: { key: 1, mode: "all", topN: 10 } });
    const { result } = renderHook(() => usePointLabelReadout(DATASET, payload, 2));
    expect(result.current).toEqual({ row: 3, label: "W1" });
    render(<PlotReadouts tool="cursor" readout={{ x: 2, rows: [{ label: "y", y: 9 }], idx: 2 }} measurement={null} stats={null} pointRow={result.current} />);
    expect(screen.getByText("row 3")).toBeInTheDocument();
    expect(screen.getByText("W1")).toBeInTheDocument();
  });

  it("shows nothing extra when labels are off, and maps a reduced payload through its row ids", () => {
    const { result: off } = renderHook(() => usePointLabelReadout(DATASET, payload, 2));
    expect(off.current).toBeNull();
    render(<PlotReadouts tool="cursor" readout={{ x: 2, rows: [{ label: "y", y: 9 }] }} measurement={null} stats={null} pointRow={off.current} />);
    expect(screen.queryByText(/^row /)).toBeNull();
    useApp.setState({ pointLabels: { key: 2, mode: "all", topN: 10 } });
    const thinned = { ...payload, data: [[0, 3], [1, 16]], rowIds: [0, 3] } as unknown as PlotPayload;
    const { result } = renderHook(() => usePointLabelReadout(DATASET, thinned, 1));
    expect(result.current).toEqual({ row: 4, label: "8" });
  });

  it("never guesses a row when the payload rows do not line up with the dataset", () => {
    useApp.setState({ pointLabels: { key: 1, mode: "all", topN: 10 } });
    const longer = { ...payload, data: [[0, 1, 2, 3, 4, 5, 6, 7], [1, 1, 1, 1, 1, 1, 1, 1]] } as unknown as PlotPayload;
    const { result } = renderHook(() => usePointLabelReadout(DATASET, longer, 5));
    expect(result.current).toBeNull();
  });
});
