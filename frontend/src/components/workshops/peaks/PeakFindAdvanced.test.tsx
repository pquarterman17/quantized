// Peaks workshop ▸ Advanced: the detector's width/window/background settings
// reach /api/peaks/find, and an untouched panel still sends exactly {x, y}
// (the backend's 2θ-tuned defaults are unchanged).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks } from "../../../lib/api/peaks";
import type { DataStruct, Peak } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import PeaksPanel from "./PeaksPanel";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn(), reportEmit: vi.fn() }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn(), fitMultiPeak: vi.fn(), fitPeak: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[1], [5], [2], [6], [2], [1]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};

const peak = (center: number): Peak => ({
  center, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: null, bg: 0,
});

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
    peaksOpen: true,
  });
  vi.mocked(findPeaks).mockResolvedValue({ peaks: [peak(1), peak(3)], background: [] });
});

const detectedRows = () => screen.getByRole("table", { name: "detected peaks" }).querySelectorAll("tbody tr");

describe("PeaksPanel ▸ Advanced peak-find settings", () => {
  it("an untouched panel sends only x and y (defaults unchanged)", async () => {
    render(<PeaksPanel />);
    await waitFor(() => expect(detectedRows()).toHaveLength(2));
    expect(Object.keys(vi.mocked(findPeaks).mock.calls[0]![0]).sort()).toEqual(["x", "y"]);
  });

  it("edited widths, window and background method go on the next find, and only they do", async () => {
    render(<PeaksPanel />);
    await waitFor(() => expect(detectedRows()).toHaveLength(2));
    vi.mocked(findPeaks).mockResolvedValue({ peaks: [peak(3)], background: [] });

    // The disclosure is a lazy chunk: the first field access waits for it.
    fireEvent.change(await screen.findByLabelText("Max width"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Min width"), { target: { value: "0.05" } });
    fireEvent.change(screen.getByLabelText("Background"), { target: { value: "polynomial" } });
    fireEvent.change(screen.getByLabelText("Polynomial degree"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Find again" }));

    await waitFor(() => expect(detectedRows()).toHaveLength(1));
    const body = vi.mocked(findPeaks).mock.calls.at(-1)![0];
    const { x: _x, y: _y, ...extras } = body;
    expect(extras).toEqual({
      max_width_deg: 0.5,
      min_width_deg: 0.05,
      bg_method: "polynomial",
      bg_poly_degree: 2,
    });
  });

  it("Defaults restores the backend defaults and re-finds with {x, y} only", async () => {
    render(<PeaksPanel />);
    await waitFor(() => expect(detectedRows()).toHaveLength(2));
    vi.mocked(findPeaks).mockResolvedValue({ peaks: [peak(3)], background: [] });
    fireEvent.change(await screen.findByLabelText("SNIP window"), { target: { value: "0.3" } });
    fireEvent.click(screen.getByRole("button", { name: "Find again" }));
    await waitFor(() => expect(detectedRows()).toHaveLength(1));
    expect(vi.mocked(findPeaks).mock.calls.at(-1)![0]).toMatchObject({ max_window_deg: 0.3 });

    vi.mocked(findPeaks).mockResolvedValue({ peaks: [peak(1), peak(3)], background: [] });
    fireEvent.click(screen.getByRole("button", { name: "Defaults" }));
    await waitFor(() => expect(detectedRows()).toHaveLength(2));
    expect(Object.keys(vi.mocked(findPeaks).mock.calls.at(-1)![0]).sort()).toEqual(["x", "y"]);
    expect(screen.getByLabelText("SNIP window")).toHaveValue(2);
  });
});
