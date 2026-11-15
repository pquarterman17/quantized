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
    // Review L4: the tooltip says what it removes, and what it does not.
    expect(screen.getByRole("button", { name: "Remove fit" }).title).toMatch(/its curve in this window \(other figures keep their saved copy/);
    fireEvent.click(screen.getByRole("button", { name: "Remove fit" }));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("shows the saved parameters (lane K acceptance 1), named when the picker is on that model", () => {
    render(
      <CurveFitResults
        active={{ ...DS, fitSpec: { ...DS.fitSpec!, errors: [0.1, null, 0.3] } }} modelName="ExpDec1" paramNames={["y0", "A", "tau"]}
        result={null} fitData={null} guessOnly={false} stale={false} xRange={null} reporting={false}
        onReport={() => {}} cornerBusy={false} onCornerPlot={() => {}} onRemoveFit={() => {}}
      />,
    );
    expect(screen.getByRole("cell", { name: "tau" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "3" })).toBeInTheDocument();
  });

  it("offers nothing for a worksheet without a saved fit", () => {
    show({ ...DS, fitSpec: undefined });
    expect(screen.queryByRole("button", { name: "Remove fit" })).toBeNull();
  });
});
