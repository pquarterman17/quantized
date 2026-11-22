// "By" (run once per level of a categorical column) for Surface fit, Optical
// gap and Ellipse fit, over the shared byrun section. The levels' own rows go
// to the API, the picked columns never offer themselves as the By column.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ellipseFit, surfaceFit, surfaceGuess, taucFit } from "../../../lib/api/analysisExtras";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import EllipseFitByLevel from "../implicitfit/EllipseFitByLevel";
import OpticalGapByLevel from "../opticalgap/OpticalGapByLevel";
import SurfaceFitByLevel from "../surfacefit/SurfaceFitByLevel";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/analysisExtras", () => ({
  ellipseFit: vi.fn(), surfaceFit: vi.fn(), surfaceGuess: vi.fn(), taucFit: vi.fn(),
}));

// Column 0 = Group (two levels of six rows), 1 = Y, 2 = Z; X is the time axis.
const DATA: DataStruct = {
  time: Array.from({ length: 12 }, (_, i) => i),
  values: Array.from({ length: 12 }, (_, i) => [i < 6 ? 0 : 1, i * 2, i * 3]),
  labels: ["Group", "Y", "Z"],
  units: ["", "", ""],
  metadata: {},
};

const pickGroup = () => fireEvent.change(screen.getByLabelText(/By \(optional\)/), { target: { value: "0" } });
const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", xKey: null, yKeys: [1], seriesOrder: null });
});

describe("Surface fit By", () => {
  const model = { name: "Plane", description: "", param_names: ["a"] } as never;
  it("fits each level on its own rows with a per-level start guess", async () => {
    vi.mocked(surfaceGuess).mockResolvedValue({ param_names: ["a"], p0: [1] });
    vi.mocked(surfaceFit).mockImplementation((async (req: { y: number[] }) => ({
      params: [req.y[0]], r2: 0.5, rmse: 0.25, n_points: req.y.length, exit_flag: 1, dof: 5,
    })) as never);
    render(<SurfaceFitByLevel f={{ model, lower: [""], upper: [""], xCol: -1, yCol: 1, zCol: 2 }} />);
    expect(surfaceFit).not.toHaveBeenCalled();
    pickGroup();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(vi.mocked(surfaceFit).mock.calls.map(([r]) => r.y)).toEqual([[0, 2, 4, 6, 8, 10], [12, 14, 16, 18, 20, 22]]);
    expect(cells(bodyRows()[1]!).slice(1)).toEqual(["6", "12", "0.5", "0.25", "6"]);
  });
});

describe("Optical gap By", () => {
  const settings = { xUnit: "eV", signal: "alpha", percent: false, thickness: "", kind: "direct", eMin: "", eMax: "" } as const;
  it("runs the Tauc fit per level and shows a refusal reason instead of results when settings are unusable", async () => {
    vi.mocked(taucFit).mockImplementation((async (req: { y: number[] }) => ({
      eg: req.y[0], eg_se: 0.5, e_min: 1, e_max: 2, r2: 0.99, n_fit: 4,
    })) as never);
    const { rerender } = render(<OpticalGapByLevel g={{ ...settings, xCol: -1, yCol: 1 }} />);
    pickGroup();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(cells(bodyRows()[1]!).slice(2, 4)).toEqual(["12", "0.5"]);
    vi.mocked(taucFit).mockClear();
    rerender(<OpticalGapByLevel g={{ ...settings, signal: "transmittance", xCol: -1, yCol: 1 }} />);
    await waitFor(() => expect(screen.getAllByText(/Enter the film thickness/).length).toBe(2));
    expect(taucFit).not.toHaveBeenCalled();
  });
});

describe("Ellipse fit By", () => {
  it("fits one ellipse per level and reports a thin level as an error row", async () => {
    vi.mocked(ellipseFit).mockImplementation((async () => ({
      center_x: 1, center_y: 2, semi_major: 3, semi_minor: 2, angle_deg: 4, rms: 0.1, arc_coverage_deg: 360, converged: true,
    })) as never);
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: { ...DATA, values: DATA.values.map((r, i) => [i < 8 ? 0 : 1, r[1]!, r[2]!]) } }] });
    render(<EllipseFitByLevel e={{ geometric: true, xCol: -1, yCol: 1 }} />);
    pickGroup();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(ellipseFit).toHaveBeenCalledOnce(); // the 4-row level never reaches the API
    expect(within(bodyRows()[1]!).getByText(/an ellipse needs 5/)).toBeInTheDocument();
    expect(cells(bodyRows()[0]!).slice(1, 4)).toEqual(["8", "1", "2"]);
  });
});
