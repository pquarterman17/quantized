// Review #8 (lanes C/K): after a reopen the fit curve is back on the canvas
// (from the figure, or redrawn from its saved parameters) while the Curve Fit
// panel holds no in-memory result. Remove fit must still be reachable.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import CurveFitResults from "./CurveFitResults";

const DS: Dataset = {
  id: "d", name: "decay.csv",
  data: { time: [0, 1], values: [[1], [2]], labels: ["signal"], units: ["V"], metadata: {} },
  fitSpec: { model: "ExpDec1", xKey: null, yKey: 0, params: [1, 2, 3] },
};

function show(active: Dataset, onRemoveFit = vi.fn()) {
  render(
    <CurveFitResults
      active={active} modelName="ExpDec1" paramNames={[]} result={null} fitData={null} guessOnly={false}
      stale={false} xRange={null} reporting={false} onReport={() => {}} cornerBusy={false} onCornerPlot={() => {}}
      onRemoveFit={onRemoveFit}
    />,
  );
  return onRemoveFit;
}

describe("CurveFitResults with a saved fit but no in-memory result", () => {
  it("offers Remove fit without fitting again", () => {
    const remove = show(DS);
    expect(screen.getByText(/Saved ExpDec1 fit/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove fit" }));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("offers nothing for a worksheet without a saved fit", () => {
    show({ ...DS, fitSpec: undefined });
    expect(screen.queryByRole("button", { name: "Remove fit" })).toBeNull();
  });
});
