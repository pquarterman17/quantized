// Peaks workshop ▸ Advanced ▸ Finder: the derivative finder modes and their
// smoothing window reach /api/peaks/find only when chosen (opt-in).

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

describe("PeaksPanel ▸ derivative finder modes", () => {
  it("offers the finder, shows the smoothing window only for a derivative mode, and sends both", async () => {
    render(<PeaksPanel />);
    await waitFor(() => expect(detectedRows()).toHaveLength(2));
    vi.mocked(findPeaks).mockResolvedValue({ peaks: [peak(3)], background: [] });

    const finder = await screen.findByLabelText("Finder");
    expect(finder).toHaveValue("residual");
    expect(screen.queryByLabelText("Smoothing window")).toBeNull();
    fireEvent.change(finder, { target: { value: "derivative2" } });
    fireEvent.change(screen.getByLabelText("Smoothing window"), { target: { value: "11" } });
    fireEvent.blur(screen.getByLabelText("Smoothing window"));
    fireEvent.click(screen.getByRole("button", { name: "Find again" }));
    await waitFor(() => expect(detectedRows()).toHaveLength(1));
    const { x: _x, y: _y, ...extras } = vi.mocked(findPeaks).mock.calls.at(-1)![0];
    expect(extras).toEqual({ finder: "derivative2", smooth_window: 11 });
  });

  it("Defaults returns to the residual finder and sends {x, y} only", async () => {
    render(<PeaksPanel />);
    await waitFor(() => expect(detectedRows()).toHaveLength(2));
    fireEvent.change(await screen.findByLabelText("Finder"), { target: { value: "derivative1" } });
    fireEvent.click(screen.getByRole("button", { name: "Find again" }));
    await waitFor(() => expect(vi.mocked(findPeaks).mock.calls.at(-1)![0]).toMatchObject({ finder: "derivative1" }));
    fireEvent.click(screen.getByRole("button", { name: "Defaults" }));
    await waitFor(() => expect(Object.keys(vi.mocked(findPeaks).mock.calls.at(-1)![0]).sort()).toEqual(["x", "y"]));
    expect(screen.getByLabelText("Finder")).toHaveValue("residual");
  });
});
