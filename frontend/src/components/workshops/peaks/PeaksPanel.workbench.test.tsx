// Peaks panel fits on the workbench shell's out-of-date pattern (lane WB4).
// Characterization first: Fit all together / Fit each stay buttons with the
// same defaults and the same publish path. A fit records the find settings it
// was made under; applying different ones ("Find again") marks the fit
// out of date, and an out-of-date fit is not reported, exported or labeled.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reportEmit } from "../../../lib/api";
import { findPeaks, fitMultiPeak, fitPeak } from "../../../lib/api/peaks";
import type { DataStruct, MultiFitResult, Peak } from "../../../lib/types";
import { askConfirm } from "../../../store/confirmDialog";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import PeaksPanel from "./PeaksPanel";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn(), reportEmit: vi.fn() }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn(), fitMultiPeak: vi.fn(), fitPeak: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[1], [5], [2], [6], [2], [1]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};
const peak = (center: number): Peak => ({ center, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: null, bg: 0 });
const FIT: MultiFitResult = {
  peaks: [{ center: 1.02, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, status: "fitted(global)", model: "Lorentzian" }],
  bgCoeffs: [1, 0], R2: 0.999, rmse: 0.01, nPeaks: 1, model: "Lorentzian",
};

const detectedRows = () => screen.getByRole("table", { name: "detected peaks" }).querySelectorAll("tbody tr");
const OUT_OF_DATE = /Out of date/;

async function fitTogether() {
  await waitFor(() => expect(detectedRows()).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "Fit all together" }));
  await screen.findByRole("table", { name: "fitted peaks" });
}
async function findAgain(width: string) {
  fireEvent.change(await screen.findByLabelText("Max width"), { target: { value: width } });
  fireEvent.blur(screen.getByLabelText("Max width")); // commits on blur (one write per edit)
  fireEvent.click(screen.getByRole("button", { name: "Find again" }));
}

/** The find a settings change started has settled (the panel says "Finding peaks…" while it runs). */
const refound = () => waitFor(() => expect(screen.queryByText("Finding peaks…")).toBeNull());

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useApp.setState({
    datasets: [{ id: "d1", name: "x.dat", data: DATA }],
    activeId: "d1", xKey: null, yKeys: null, seriesOrder: null,
    peakOverlay: null, annotations: [], history: [], future: [], peaksOpen: true, reports: [],
  });
  vi.mocked(findPeaks).mockResolvedValue({ peaks: [peak(1), peak(3)], background: [] });
  vi.mocked(fitMultiPeak).mockResolvedValue(FIT);
  vi.mocked(askConfirm).mockResolvedValue(true);
  vi.mocked(reportEmit).mockResolvedValue({ report: {} } as never);
});

describe("Peaks panel fits: characterization", () => {
  it("Fit all together stays a button: nothing fits until it is clicked, with the controls' defaults", async () => {
    render(<PeaksPanel />);
    await waitFor(() => expect(detectedRows()).toHaveLength(2));
    expect(fitMultiPeak).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Fit all together" }));
    await screen.findByRole("table", { name: "fitted peaks" });
    expect(fitMultiPeak).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fitMultiPeak).mock.calls[0]![0]).toMatchObject({
      model: "Lorentzian", bg_degree: 1, constrain: false, link_mode: "None",
    });
    expect(useApp.getState().datasets[0]!.peakTable?.provenance.method).toBe("simultaneous");
    expect(screen.queryByText(OUT_OF_DATE)).toBeNull();
  });

  it("a failed fit shows its error and no result", async () => {
    vi.mocked(fitMultiPeak).mockRejectedValue(new Error("singular matrix"));
    render(<PeaksPanel />);
    await waitFor(() => expect(detectedRows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Fit all together" }));
    expect(await screen.findByText(/singular matrix/)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "fitted peaks" })).toBeNull();
  });
});

describe("Peaks panel fits: out of date after the find settings change", () => {
  it("applying different find settings after a fit marks it Out of date (fail-before: it showed as current)", async () => {
    render(<PeaksPanel />);
    await fitTogether();
    expect(screen.queryByText(OUT_OF_DATE)).toBeNull();
    await findAgain("0.5");
    await refound();
    expect(findPeaks).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(OUT_OF_DATE)).toBeInTheDocument();
  });

  it("applying the SAME settings does not mark it", async () => {
    render(<PeaksPanel />);
    await fitTogether();
    fireEvent.click(await screen.findByRole("button", { name: "Find again" }));
    await refound();
    expect(findPeaks).toHaveBeenCalledTimes(2);
    await screen.findByRole("table", { name: "fitted peaks" });
    expect(screen.queryByText(OUT_OF_DATE)).toBeNull();
  });

  it("an out-of-date fit is not reported, and the reason is on the control", async () => {
    render(<PeaksPanel />);
    await fitTogether();
    await findAgain("0.5");
    await screen.findByText(OUT_OF_DATE);
    const report = screen.getByRole("button", { name: "→ Report" });
    expect(report).toBeDisabled();
    expect(report.getAttribute("title")).toMatch(/Fit again/);
    fireEvent.click(report);
    expect(reportEmit).not.toHaveBeenCalled();
  });

  it("fitting again clears the marker and re-enables the report", async () => {
    render(<PeaksPanel />);
    await fitTogether();
    await findAgain("0.5");
    await screen.findByText(OUT_OF_DATE);
    fireEvent.click(screen.getByRole("button", { name: "Fit all together" }));
    await waitFor(() => expect(screen.queryByText(OUT_OF_DATE)).toBeNull());
    expect(fitMultiPeak).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "→ Report" })).toBeEnabled();
  });

  it("Fit each gets the same marker", async () => {
    vi.mocked(fitPeak).mockResolvedValue({
      success: true, reason: "", center: 1, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4,
      params: [5, 1, 0.8, 1], model: "Lorentzian", window: [0, 2],
    });
    render(<PeaksPanel />);
    await waitFor(() => expect(detectedRows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Fit each" }));
    await screen.findByRole("table", { name: "fitted peaks" });
    expect(screen.queryByText(OUT_OF_DATE)).toBeNull();
    await findAgain("0.5");
    expect(await screen.findByText(OUT_OF_DATE)).toBeInTheDocument();
  });
});
