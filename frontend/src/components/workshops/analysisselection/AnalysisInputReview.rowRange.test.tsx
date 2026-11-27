// The "Rows from / to" fields of the shared analysis-input block (R1 of
// ROW_RANGE_CONTRACT): 1-based source rows, both blank = every row, an invalid
// entry is not applied and says so, and the summary line states the window.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ROW_POLICY } from "../../../lib/analysisInputs";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { shiftRowRangesForDelete } from "../../../store/rowRangeShift";
import { useApp } from "../../../store/useApp";
import AnalysisInputReview from "./AnalysisInputReview";

const dataset: Dataset = {
  id: "d1",
  name: "experiment.csv",
  data: {
    time: Array.from({ length: 48 }, (_v, i) => i),
    values: Array.from({ length: 48 }, (_v, i) => [i * 10]),
    labels: ["Signal"], units: ["V"], metadata: {},
  },
  excludedRows: [22, 30, 40],
};

beforeEach(() => {
  useApp.setState({ datasets: [dataset], activeId: "d1", selectedIds: ["d1"], xKey: null, yKeys: [0] });
  useAnalysisSelection.setState({
    toolId: "curvefit",
    selection: captureAnalysisSelection({
      datasets: [dataset], activeId: "d1", selectedIds: ["d1"], xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "analysis-center"),
  });
});

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const itemRange = () => useAnalysisSelection.getState().selection!.items[0].rowRange;

describe("AnalysisInputReview row range fields", () => {
  it("typing 21 to 44 sets the window and the summary reads like the contract", () => {
    render(<AnalysisInputReview toolId="curvefit" singleY />);
    fireEvent.change(field("Rows from"), { target: { value: "21" } });
    expect(itemRange()).toBeUndefined(); // one end alone is not applied
    fireEvent.change(field("to"), { target: { value: "44" } });
    expect(itemRange()).toEqual({ from: 20, to: 43 });
    expect(screen.getByText(/Input: experiment\.csv · X: X · Y: Signal \(V\) · rows 21-44 · 21 of 24 rows \(3 excluded\)/)).toBeInTheDocument();
    expect(screen.getByText(/Limited to rows 21-44\./)).toBeInTheDocument();
  });

  it("an invalid entry is not applied: the previous window stays and the line says so", () => {
    render(<AnalysisInputReview toolId="curvefit" singleY />);
    fireEvent.change(field("Rows from"), { target: { value: "21" } });
    fireEvent.change(field("to"), { target: { value: "44" } });
    fireEvent.change(field("to"), { target: { value: "10" } });
    expect(itemRange()).toEqual({ from: 20, to: 43 });
    expect(screen.getByText(/Not applied: enter both rows \(1 to 48\), from at most to\. Still using rows 21-44\./)).toBeInTheDocument();
  });

  it("clearing both fields returns to every row", () => {
    render(<AnalysisInputReview toolId="curvefit" singleY />);
    fireEvent.change(field("Rows from"), { target: { value: "5" } });
    fireEvent.change(field("to"), { target: { value: "9" } });
    fireEvent.change(field("Rows from"), { target: { value: "" } });
    fireEvent.change(field("to"), { target: { value: "" } });
    expect(itemRange()).toBeNull();
    expect(screen.getByText(/· 45 of 48 rows$/)).toBeInTheDocument();
  });

  it("follows a row delete and shows a vanished range as removed, never as every row", () => {
    render(<AnalysisInputReview toolId="curvefit" singleY />);
    fireEvent.change(field("Rows from"), { target: { value: "5" } });
    fireEvent.change(field("to"), { target: { value: "6" } });
    act(() => shiftRowRangesForDelete("d1", new Set([0, 1])));
    expect(field("Rows from").value).toBe("3");
    expect(field("to").value).toBe("4");
    act(() => shiftRowRangesForDelete("d1", new Set([2, 3])));
    expect(screen.getByText("rows 3-4 no longer exist")).toBeInTheDocument();
    expect(screen.getByText(/rows 3-4 no longer exist/, { selector: "button span" })).toBeInTheDocument();
  });

  it("is not offered by a tool whose policy keeps its own rows", () => {
    render(<AnalysisInputReview toolId="curvefit" singleY policy={ROW_POLICY.fullWorksheet} />);
    expect(screen.queryByLabelText("Rows from")).toBeNull();
  });
});
