// BaselinePanel — DOM smoke test for the optional 2-D y-box (MATLAB
// `onBGMouseUp` parity, GAP #96/#20): the "region" method's box-edge fields
// double as its readout, so a store-picked y-range must actually render, not
// just live in the hook's params. Uses the REAL useApp/useBaseline stores,
// the same pattern useBaseline.test.ts and LevelOrderPanel.test.tsx use.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { baselineRegion } from "../../../lib/api/baseline";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import BaselinePanel from "./BaselinePanel";

vi.mock("../../../lib/api/baseline", () => ({
  baselineALS: vi.fn(),
  baselineAnchor: vi.fn(),
  baselineEstimate: vi.fn(),
  baselineModPoly: vi.fn(),
  baselineRegion: vi.fn(),
  baselineRollingBall: vi.fn(),
  baselineShirley: vi.fn(),
  baselineXrdLowAngle: vi.fn(),
}));

const raw: DataStruct = {
  time: [1, 2, 3, 4],
  values: [[10], [12], [11], [13]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};

function boxMinMax(): [HTMLInputElement, HTMLInputElement, HTMLInputElement, HTMLInputElement] {
  const xMin = screen.getByText("Box x-min").nextElementSibling as HTMLInputElement;
  const xMax = screen.getByText("Box x-max").nextElementSibling as HTMLInputElement;
  const yMin = screen.getByText("Box y-min").nextElementSibling as HTMLInputElement;
  const yMax = screen.getByText("Box y-max").nextElementSibling as HTMLInputElement;
  return [xMin, xMax, yMin, yMax];
}

function selectRegionMethod(): void {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "region" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: raw }],
    activeId: "d1",
    baselineOpen: true,
    baselineOverlay: null,
    baselineAnchorEdit: null,
    plotTool: "zoom",
    regionPicked: null,
    xKey: null,
    yKeys: null,
    seriesOrder: null,
  });
});

describe("BaselinePanel region box (y-box readout)", () => {
  it('shows empty y-min/y-max fields (placeholder "none") before any pick', () => {
    render(<BaselinePanel />);
    selectRegionMethod();

    const [, , yMin, yMax] = boxMinMax();
    expect(yMin.value).toBe("");
    expect(yMin.placeholder).toBe("none");
    expect(yMax.value).toBe("");
    expect(yMax.placeholder).toBe("none");
  });

  it("the readout shows the y-range once a 2-D box is picked on the plot", () => {
    render(<BaselinePanel />);
    selectRegionMethod();

    // Simulate the plot's rubber-band committing a genuine 2-D box.
    act(() => {
      useApp.getState().setRegionPicked({ x: [2, 3], yRange: [9, 12] });
    });

    const [xMin, xMax, yMin, yMax] = boxMinMax();
    expect(xMin.value).toBe("2");
    expect(xMax.value).toBe("3");
    expect(yMin.value).toBe("9");
    expect(yMax.value).toBe("12");
  });

  it("an x-only pick leaves the y-box fields empty (no stale y from a prior pick)", () => {
    render(<BaselinePanel />);
    selectRegionMethod();
    act(() => {
      useApp.getState().setRegionPicked({ x: [2, 3], yRange: [9, 12] });
    });
    act(() => {
      useApp.getState().setRegionPicked({ x: [1, 4] }); // re-drag, x-only
    });

    const [xMin, xMax, yMin, yMax] = boxMinMax();
    expect(xMin.value).toBe("1");
    expect(xMax.value).toBe("4");
    expect(yMin.value).toBe("");
    expect(yMax.value).toBe("");
  });

  it("estimating with an active y-box sends y_min/y_max to the region endpoint", async () => {
    vi.mocked(baselineRegion).mockResolvedValue({
      background: [5, 5, 5, 5], coeffs: [0, 5], n_points: 2,
      mean: 5, std: 0, min: 5, max: 5, order: 1,
    });
    render(<BaselinePanel />);
    selectRegionMethod();
    act(() => {
      useApp.getState().setRegionPicked({ x: [2, 3], yRange: [9, 12] });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /estimate/i }));
    });

    expect(baselineRegion).toHaveBeenCalledWith({
      x: [1, 2, 3, 4], y: [10, 12, 11, 13], x_min: 2, x_max: 3, y_min: 9, y_max: 12, order: 5,
    });
  });
});
