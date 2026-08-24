// Panel-level coverage for the UX-R6 "Label peaks" entry point (MY RULING
// 7): the button text names which peak set it will use, and clicking it
// creates one annotation per peak, matching the peak centers. The behavioral
// guts (template rendering, placement, group identity, one undo entry,
// source immutability) are covered at the hook level in usePeaks.test.ts —
// this file only exercises the actual button a user clicks.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks, fitMultiPeak } from "../../../lib/api/peaks";
import { askParams } from "../../overlays/ParamDialog";
import type { DataStruct } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import PeaksPanel from "./PeaksPanel";

vi.mock("../../../lib/api", () => ({
  fetchBookData: vi.fn(),
  reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/peaks", () => ({
  findPeaks: vi.fn(),
  fitMultiPeak: vi.fn(),
  fitPeak: vi.fn(),
}));
vi.mock("../../overlays/ParamDialog", () => ({
  askParams: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[1], [5], [2], [6], [2], [1]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useApp.setState({
    datasets: [{ id: "d1", name: "x.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    peakOverlay: null,
    annotations: [],
    history: [],
    future: [],
    peaksOpen: true,
  });
  vi.mocked(findPeaks).mockResolvedValue({
    peaks: [
      { center: 1, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: null },
      { center: 3, height: 6, fwhm: 0.9, prominence: 1, localSNR: 10, area: null },
    ],
    background: [],
  });
});

describe("PeaksPanel — Label peaks entry point", () => {
  it("labels which peak set it will use, and disables when there are none", async () => {
    vi.mocked(findPeaks).mockResolvedValue({ peaks: [], background: [] });
    render(<PeaksPanel />);
    await waitFor(() => expect(screen.getByText(/No peaks found/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Label all/ })).not.toBeInTheDocument();
  });

  it("clicking 'Label all N detected peaks…' creates N annotations matching the peak centers", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    render(<PeaksPanel />);

    const btn = await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(btn);

    await waitFor(() => expect(useApp.getState().annotations).toHaveLength(2));
    const xs = useApp.getState().annotations.map((a) => a.x).sort((a, b) => a - b);
    expect(xs).toEqual([1, 3]);
  });

  it("once a fit result exists, the button switches to naming the FITTED set", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue({
      peaks: [
        { center: 1.1, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, status: "fitted(global)", model: "Lorentzian" },
        { center: 3.1, fwhm: 0.9, height: 6, bg: 1, eta: null, area: 5, status: "fitted(global)", model: "Lorentzian" },
      ],
      bgCoeffs: [1, 0],
      R2: 0.99,
      rmse: 0.02,
      nPeaks: 2,
      model: "Lorentzian",
    });
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });

    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    await screen.findByRole("button", { name: "Label all 2 fitted peaks…" });

    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Label all 2 fitted peaks…" }));

    await waitFor(() => expect(useApp.getState().annotations).toHaveLength(2));
    const xs = useApp.getState().annotations.map((a) => a.x).sort((a, b) => a - b);
    expect(xs).toEqual([1.1, 3.1]);
  });
});
