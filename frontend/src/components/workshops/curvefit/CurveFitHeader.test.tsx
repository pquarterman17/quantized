// The Fit button names the batch when several worksheets are in scope (UX9-C).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import CurveFitHeader from "./CurveFitHeader";

const sheet = (id: string): Dataset => ({
  id, name: `${id}.csv`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["Y"], units: [""], metadata: {} },
});
const seed = (ids: string[]) => {
  const datasets = ids.map(sheet);
  useAnalysisSelection.setState({
    toolId: "curvefit",
    selection: captureAnalysisSelection({
      datasets, activeId: ids[0]!, selectedIds: ids, xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
};
const fit = () => ({
  disabled: false, fitting: false, onGuess: vi.fn(), onFit: vi.fn(), onTab: vi.fn(),
  status: { text: "", tone: "dim" as const }, tab: "setup" as const,
});

beforeEach(() => useAnalysisSelection.setState({ toolId: null, selection: null }));

describe("CurveFitHeader", () => {
  it("reads 'Fit N worksheets' and opens the batch for a multi-worksheet scope", () => {
    seed(["a", "b", "c", "d", "e"]);
    const f = fit();
    render(<CurveFitHeader modelPicker={null} fit={f} />);
    fireEvent.click(screen.getByRole("button", { name: "Fit 5 worksheets" }));
    expect(f.onTab).toHaveBeenCalledWith("advanced");
    expect(f.onFit).not.toHaveBeenCalled();
  });

  it("keeps a plain Fit for one worksheet", () => {
    seed(["a"]);
    const f = fit();
    render(<CurveFitHeader modelPicker={null} fit={f} />);
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(f.onFit).toHaveBeenCalled();
  });

  it("offers 'Fit active only' beside the batch button, and both read Fitting\u2026 while busy", () => {
    seed(["a", "b"]);
    const f = fit();
    const { rerender } = render(<CurveFitHeader modelPicker={null} fit={f} />);
    fireEvent.click(screen.getByRole("button", { name: "Fit active only" }));
    expect(f.onFit).toHaveBeenCalledOnce();
    expect(f.onTab).not.toHaveBeenCalled();
    rerender(<CurveFitHeader modelPicker={null} fit={{ ...f, fitting: true }} />);
    expect(screen.getAllByRole("button", { name: "Fitting\u2026" })).toHaveLength(2);
  });

  it("asks to expand the batch section when 'Fit N worksheets' is clicked", () => {
    seed(["a", "b"]);
    const onOpenBatch = vi.fn();
    render(<CurveFitHeader modelPicker={null} fit={{ ...fit(), onOpenBatch }} />);
    fireEvent.click(screen.getByRole("button", { name: "Fit 2 worksheets" }));
    expect(onOpenBatch).toHaveBeenCalledOnce();
  });

  it("has no 'Fit active only' for a single worksheet", () => {
    seed(["a"]);
    render(<CurveFitHeader modelPicker={null} fit={fit()} />);
    expect(screen.queryByRole("button", { name: "Fit active only" })).toBeNull();
  });
});
