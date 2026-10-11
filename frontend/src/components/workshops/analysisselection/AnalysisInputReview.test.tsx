import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import AnalysisInputReview from "./AnalysisInputReview";

const dataset: Dataset = {
  id: "d1",
  name: "experiment.csv",
  data: {
    time: [0, 1, 2],
    values: [[1, 10, 0.5, 0], [2, 20, 0.6, 1], [3, 30, 0.7, 0]],
    labels: ["X", "Signal", "Sigma", "Lot"],
    units: ["s", "V", "V", ""],
    metadata: {},
  },
  channelTypes: { 3: "nominal" },
  errorRoles: [
    { channel: 2, target: 1, axis: "y", side: "-" },
    { channel: 0, target: 1, axis: "y", side: "+" },
  ],
};

beforeEach(() => {
  useApp.setState({ datasets: [dataset], activeId: "d1", selectedIds: ["d1"], xKey: 0, yKeys: [1] });
  useAnalysisSelection.setState({
    toolId: "curvefit",
    selection: captureAnalysisSelection({
      datasets: [dataset], activeId: "d1", selectedIds: ["d1"], xKey: 0, yKeys: [1],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "analysis-center"),
  });
});

describe("AnalysisInputReview", () => {
  it("offers only categorical Run by columns and keeps primary plot roles in sync", () => {
    render(<AnalysisInputReview toolId="curvefit" singleY allowFactor supportsBatch />);

    const factor = screen.getByLabelText("Run by") as HTMLSelectElement;
    expect([...factor.options].map((option) => option.text)).toEqual(["No factor", "Lot"]);
    fireEvent.change(factor, { target: { value: "3" } });
    expect(useAnalysisSelection.getState().selection?.items[0].factorKeys).toEqual([3]);

    fireEvent.change(screen.getByLabelText("Y"), { target: { value: "2" } });
    expect(useApp.getState().yKeys).toEqual([2]);
    expect(useAnalysisSelection.getState().selection?.items[0].yKeys).toEqual([2]);
  });

  it("replaces conflicting asymmetric roles when a symmetric uncertainty is chosen", () => {
    render(<AnalysisInputReview toolId="curvefit" singleY allowFactor supportsBatch />);
    fireEvent.change(screen.getByLabelText("Y uncertainty"), { target: { value: "2" } });

    const item = useAnalysisSelection.getState().selection?.items[0];
    expect(item?.errorKeys).toEqual({ 1: 2 });
    expect(item?.errorBindings.filter((binding) => binding.axis === "y" && binding.target === 1)).toEqual([
      { channel: 2, target: 1, axis: "y", side: "both" },
    ]);
  });
});
