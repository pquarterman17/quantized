// GlobalFitSection on the workbench shell (lane WB4): an out-of-date global fit
// says so and withholds Report / Show / the exportable table; refusals and job
// failures are distinct alerts.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { globalFitJob, type GlobalFitResult } from "../../../lib/api/globalFit";
import { reportEmit } from "../../../lib/api/report";
import { pollJob } from "../../../lib/jobs";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import GlobalFitSection from "./GlobalFitSection";
import type { GlobalModel } from "./useGlobalFit";

vi.mock("../../../lib/api/globalFit", () => ({ globalFitJob: vi.fn(), compareDatasetsJob: vi.fn() }));
vi.mock("../../../lib/api/report", () => ({ reportEmit: vi.fn() }));
vi.mock("../../../lib/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/jobs")>()),
  pollJob: vi.fn(),
  cancelJob: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2], values: [[1, 2], [3, 5], [5, 8]], labels: ["A", "B"], units: ["", ""], metadata: {},
};
const MODEL: GlobalModel = { name: "Linear", paramNames: ["m", "b"], p0: [1, 0], lb: [null, null], ub: [null, null] };
const FIT: GlobalFitResult = {
  paramNames: ["m", "b"], params: [[2, 1], [3, 1]], errors: [[0.25, 0.5], [0.125, 0.5]],
  shared: [{ name: "b", paramIdx: 1, datasets: [0, 1], value: 1, error: 0.5 }],
  yFit: [[1, 3, 5], [2, 5, 8]], R2: [0.75, 0.5], RMSE: [0.1, 0.2], chiSqRed: 1, nTotal: 6, nFree: 3, exitFlag: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(globalFitJob).mockResolvedValue({ job_id: "j1" });
  vi.mocked(pollJob).mockResolvedValue(FIT);
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1", selectedIds: ["d1"], xKey: null, yKeys: [0, 1], seriesOrder: null, fitOverlay: null, reports: [],
  });
});

describe("GlobalFitSection freshness", () => {
  it("ticking a shared parameter after a fit marks it Out of date and withholds Report and Show", async () => {
    render(<GlobalFitSection model={MODEL} />);
    fireEvent.click(screen.getByRole("button", { name: "Fit globally" }));
    await screen.findByRole("table", { name: "Global fit per series" });
    expect(screen.queryByText(/Out of date/)).toBeNull();
    expect(screen.getByRole("button", { name: "→ Report" })).toBeEnabled();

    fireEvent.click(screen.getByLabelText("Share m across all series"));
    expect(await screen.findByText(/Out of date/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "→ Report" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Show A fit" })).toBeDisabled();
    expect(reportEmit).not.toHaveBeenCalled();
    expect(globalFitJob).toHaveBeenCalledTimes(1); // an edit never refits

    fireEvent.click(screen.getByRole("button", { name: "Fit globally" }));
    await waitFor(() => expect(screen.queryByText(/Out of date/)).toBeNull());
    expect(screen.getByRole("button", { name: "→ Report" })).toBeEnabled();
  });

  it("fewer than two series is a refusal alert; a failed job is an error alert", async () => {
    render(<GlobalFitSection model={MODEL} />);
    fireEvent.click(screen.getByLabelText("Fit A"));
    fireEvent.click(screen.getByRole("button", { name: "Fit globally" }));
    expect(await screen.findByRole("alert")).toHaveAttribute("data-kind", "refusal");
    fireEvent.click(screen.getByLabelText("Fit A"));
    vi.mocked(pollJob).mockRejectedValueOnce(new Error("unconverged"));
    fireEvent.click(screen.getByRole("button", { name: "Fit globally" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveAttribute("data-kind", "error"));
    expect(screen.getByRole("alert")).toHaveTextContent("unconverged");
  });
});
