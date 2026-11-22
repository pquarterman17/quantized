// The ODR section on the workbench shell (lane WB4): a result whose inputs
// changed says "Out of date"; refusals and request failures render through
// WorkbenchMessage with their own kind.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { odrFit, type OdrResult } from "../../../lib/api/fitStats";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import OdrSection from "./OdrSection";

vi.mock("../../../lib/api/fitStats", () => ({ odrFit: vi.fn() }));

const DS: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [0, 1, 2],
    values: [[1, 0.1, 3, 5], [2, 0.1, 5, 6], [3, 0.2, 7, 7]],
    labels: ["x", "ex", "y", "y2"],
    units: ["", "", "", ""],
    metadata: {},
  },
  errorRoles: [{ channel: 1, target: -1, axis: "x", side: "both" }],
};
const FIT: OdrResult = { slope: 2, intercept: 1, slopeErr: 0.1, interceptErr: 0.2, lambda: 1, rss: 0.1, rmse: 0.1, n: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(odrFit).mockResolvedValue(FIT);
  useApp.setState({ datasets: [DS], activeId: "d1", xKey: 0, yKeys: [2], seriesOrder: null, errKeys: {}, fitOverlay: null });
});

const run = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Fit line (ODR)" }));
  await screen.findByText("slope");
};

describe("OdrSection", () => {
  it("marks the result Out of date when the plotted channel changes, and a refit clears it", async () => {
    render(<OdrSection />);
    await run();
    expect(screen.queryByText(/Out of date/)).toBeNull();
    act(() => useApp.setState({ yKeys: [3] }));
    expect(await screen.findByText(/Out of date/)).toBeInTheDocument();
    expect(screen.getByText("slope")).toBeInTheDocument();
    await run();
    expect(screen.queryByText(/Out of date/)).toBeNull();
  });

  it("a request failure is an error alert, a bad X-error column a refusal alert", async () => {
    vi.mocked(odrFit).mockRejectedValueOnce(new Error("server down"));
    render(<OdrSection />);
    fireEvent.click(screen.getByRole("button", { name: "Fit line (ODR)" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("server down");
    expect(alert).toHaveAttribute("data-kind", "error");

    const zero = structuredClone(DS);
    zero.data.values[0]![1] = 0;
    act(() => useApp.setState({ datasets: [zero] }));
    fireEvent.click(screen.getByRole("button", { name: "Fit line (ODR)" }));
    expect(await screen.findByText(/non-positive/)).toHaveAttribute("data-kind", "refusal");
  });
});
