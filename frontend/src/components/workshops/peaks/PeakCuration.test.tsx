import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks, fitMultiPeak } from "../../../lib/api/peaks";
import type { DataStruct, Peak } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { askParams } from "../../overlays/ParamDialog";
import PeaksPanel from "./PeaksPanel";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn(), reportEmit: vi.fn() }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn(), fitMultiPeak: vi.fn(), fitPeak: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[1], [5], [2], [6], [2], [1]],
  labels: ["I"], units: ["cps"], metadata: {},
};
const peak = (center: number, height: number): Peak => ({
  center, height, fwhm: 0.8, prominence: height, localSNR: 10, area: null, bg: 0,
});
const rows = () => within(screen.getByRole("table", { name: "detected peaks" })).getAllByRole("row").slice(1);

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "x.dat", data: DATA }],
    activeId: "d1", xKey: null, yKeys: null, seriesOrder: null,
    peakOverlay: null, peakWizardEdit: null, peakWizardOpen: false, peaksOpen: true,
  });
  vi.mocked(findPeaks).mockResolvedValue({
    peaks: [peak(1, 5), peak(3, 6)],
    background: [0, 0, 0, 0, 0, 0],
  });
});

describe("PeaksPanel — detected peak curation", () => {
  it("removes selected automatic peaks before fitting", async () => {
    render(<PeaksPanel />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(rows()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Label all 1 detected peak…" })).toBeInTheDocument();
  });

  it("adds a candidate by approximate x and refreshes the marker overlay", async () => {
    vi.mocked(askParams).mockResolvedValue({ center: 4.8 });
    render(<PeaksPanel />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Add peak…" }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(useApp.getState().peakOverlay?.y.filter((v) => v !== null)).toHaveLength(3);
  });

  it("edits directly on the plot through the shared marker bridge", async () => {
    render(<PeaksPanel />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Edit peaks on plot" }));
    expect(useApp.getState().peakWizardEdit).not.toBeNull();

    act(() => useApp.getState().peakWizardEdit?.addPeakAt(4.8));
    expect(rows()).toHaveLength(3);
    act(() => useApp.getState().peakWizardEdit?.removePeak(0));
    expect(rows()).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Stop plot editing" }));
    expect(useApp.getState().peakWizardEdit).toBeNull();
  });

  it("does not let Delete change the snapshotted candidates during a fit", async () => {
    vi.mocked(fitMultiPeak).mockReturnValue(new Promise<never>(() => {}));
    render(<PeaksPanel />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(rows()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Fit all together" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Fitting…" })).toBeDisabled());
    fireEvent.keyDown(rows()[0], { key: "Delete" });
    expect(rows()).toHaveLength(2);
  });
});
