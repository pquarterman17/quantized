// ODR section, "Weighting: per-point errors (York)": selectable only with an
// X-error AND a Y-error column bound; Deming stays the default.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { odrFit, yorkFit, type OdrResult, type YorkResult } from "../../../lib/api/fitStats";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import OdrSection from "./OdrSection";

vi.mock("../../../lib/api/fitStats", () => ({ odrFit: vi.fn(), yorkFit: vi.fn() }));

const DS: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [0, 1, 2],
    values: [[1, 0.1, 3, 0.3], [2, 0.1, 5, 0.2], [3, 0.2, 7, 0.4]],
    labels: ["x", "ex", "y", "ey"],
    units: ["", "", "", ""],
    metadata: {},
  },
  errorRoles: [{ channel: 1, target: -1, axis: "x", side: "both" }],
};
const DEMING: OdrResult = { slope: 2, intercept: 1, slopeErr: 0.1, interceptErr: 0.2, lambda: 1, rss: 0.1, rmse: 0.1, n: 3 };
const YORK: YorkResult = {
  slope: 2.5, intercept: 0.5, slopeErr: 0.05, interceptErr: 0.07, slopeErrScaled: 0.06, interceptErrScaled: 0.08,
  chiSq: 1.2, mswd: 1.2, dof: 1, n: 3, nIter: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(odrFit).mockResolvedValue(DEMING);
  vi.mocked(yorkFit).mockResolvedValue(YORK);
  useApp.setState({ datasets: [DS], activeId: "d1", xKey: 0, yKeys: [2], seriesOrder: null, errKeys: { 2: 3 }, fitOverlay: null });
});

describe("OdrSection - York weighting", () => {
  it("defaults to Deming", async () => {
    render(<OdrSection />);
    expect(screen.getByRole("combobox", { name: "Weighting" })).toHaveValue("deming");
    fireEvent.click(screen.getByRole("button", { name: "Fit line (ODR)" }));
    await screen.findByText("slope");
    expect(odrFit).toHaveBeenCalledTimes(1);
    expect(yorkFit).not.toHaveBeenCalled();
  });

  it("posts each point's own X and Y error and shows MSWD", async () => {
    render(<OdrSection />);
    fireEvent.change(screen.getByRole("combobox", { name: "Weighting" }), { target: { value: "york" } });
    fireEvent.click(screen.getByRole("button", { name: "Fit line (York)" }));
    await screen.findByText("reduced χ² (MSWD)");
    expect(yorkFit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(yorkFit).mock.calls[0]![0]).toMatchObject({ x_error: [0.1, 0.1, 0.2], y_error: [0.3, 0.2, 0.4] });
    expect(odrFit).not.toHaveBeenCalled();
  });

  it("is disabled with a reason when the plotted Y has no error column", () => {
    useApp.setState({ errKeys: {} });
    render(<OdrSection />);
    expect(screen.getByRole("combobox", { name: "Weighting" })).toBeDisabled();
    expect(screen.getByText(/York needs a Y-error column/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fit line (ODR)" })).toBeInTheDocument();
  });
});
