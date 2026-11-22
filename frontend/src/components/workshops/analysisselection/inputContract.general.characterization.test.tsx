// Characterization of how Baseline and Optical gap resolve their inputs, pinned
// BEFORE they moved onto the shared resolver (lib/analysisInputs) and kept
// after: Baseline estimates over every row of the plotted channels (excluded
// and filtered rows included); Optical gap fits the analysis view of its own
// X / Y picks (excluded and filtered rows left out).
//
// Fixture: four rows, row 1 manually excluded, row 3 filtered out (time <= 3.5).

import type { ReactNode } from "react";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { baselineALS } from "../../../lib/api/baseline";
import { subtractMagBackground } from "../../../lib/api/magnetometry";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useBaseline } from "../baseline/useBaseline";
import { useMagTools } from "../magtools/useMagTools";
import OpticalGapPanel from "../opticalgap/OpticalGapPanel";

const { taucMock } = vi.hoisted(() => ({ taucMock: vi.fn() }));
vi.mock("../../../lib/api/analysisExtras", () => ({ taucFit: taucMock }));
vi.mock("../../../lib/api/baseline", () => ({
  baselineALS: vi.fn(), baselineAnchor: vi.fn(), baselineEstimate: vi.fn(), baselineModPoly: vi.fn(),
  baselineRegion: vi.fn(), baselineRollingBall: vi.fn(), baselineShirley: vi.fn(), baselineXrdLowAngle: vi.fn(),
}));
vi.mock("../../../lib/api/magnetometry", () => ({
  subtractMagBackground: vi.fn(), subtractHysteresisBackground: vi.fn(), normalizeMagMoment: vi.fn(), demagCorrectField: vi.fn(),
}));
vi.mock("../SmallUPlot", () => ({ default: () => <div /> }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));

const SHEET: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [2, 2.5, 3, 3.5],
    values: [[1e3], [1e4], [5e4], [9e4]],
    labels: ["alpha"],
    units: ["1/cm"],
    metadata: { x_column_name: "Energy", x_column_unit: "eV" },
  },
  excludedRows: [1],
  filter: [{ col: -1, kind: "range", max: 3.2 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(baselineALS).mockResolvedValue({ baseline: [0, 0, 0, 0] });
  taucMock.mockResolvedValue({
    kind: "direct", label: "Direct allowed", gamma: 2, eg: 2.35, eg_se: 0.01, eg_se_fit: 0.01, eg_window_sd: null, eg_lcl: 2.3, eg_ucl: 2.4,
    level: 0.95, slope: 1, intercept: 0, r2: 0.99, n_fit: 3, e_min: 2, e_max: 3, auto_window: true,
    energy: [2, 3], tauc: [0, 1], alpha: [0, 1], fit_energy: [2, 3], fit_tauc: [0, 1],
  });
  useApp.setState({
    datasets: [SHEET], activeId: "d1", status: "", baselineOverlay: null, baselineAnchorEdit: null,
    plotTool: "zoom", regionPicked: null, xKey: null, yKeys: null, seriesOrder: null,
  });
});

describe("Baseline input", () => {
  it("estimates over every row of the plotted channel, excluded and filtered rows included", async () => {
    const { result } = renderHook(() => useBaseline());
    await act(async () => { await result.current.compute(); });
    expect(vi.mocked(baselineALS).mock.calls[0][0]).toMatchObject({ y: [1e3, 1e4, 5e4, 9e4] });
  });
});

describe("Optical gap input", () => {
  it("fits the analysis view of X axis + first column: excluded and filtered rows never reach the fit", async () => {
    render(<OpticalGapPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Fit gap" }));
    await screen.findByText(/Eg = /);
    expect(taucMock.mock.calls[0][0]).toMatchObject({ x: [2, 3], y: [1e3, 5e4] });
  });
});

describe("Magnetometry tools input", () => {
  it("the background subtraction converts every worksheet row, excluded and filtered rows included", async () => {
    vi.mocked(subtractMagBackground).mockResolvedValue({ corrected: [0, 0, 0, 0], slope: 0, intercept: 0 });
    useApp.setState({
      datasets: [{
        ...SHEET,
        data: { ...SHEET.data, time: [2, 100, 200, 300], values: [[5], [2], [1.5], [1]], metadata: { x_column_name: "Temperature", x_column_unit: "K" } },
      }],
    });
    const { result } = renderHook(() => useMagTools());
    await act(async () => { await result.current.subtractBackground(); });
    expect(vi.mocked(subtractMagBackground).mock.calls[0][0]).toMatchObject({ temperature: [2, 100, 200, 300], moment: [5, 2, 1.5, 1] });
  });
});
