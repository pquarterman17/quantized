// Characterization of how Surface fit, Ellipse fit, Peak wizard, Tabulate, Pie
// and Ternary read their rows, pinned BEFORE each shows the shared input
// summary and kept after: every one of them works on the ANALYSIS VIEW (manual
// exclusions and Data Filter rows left out); none reads the selected rows or
// the plot X range.
//
// Fixture: row 1 manually excluded, row 3 filtered out (time > 3.5).

import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import EllipseFitPanel from "../implicitfit/EllipseFitPanel";
import { usePeakWizard } from "../peakwizard/usePeakWizard";
import { usePie } from "../pie/usePie";
import SurfaceFitPanel from "../surfacefit/SurfaceFitPanel";
import { useTabulate } from "../tabulate/useTabulate";
import { useTernary } from "../ternary/useTernary";

const { modelsMock, guessMock, fitMock, ellipseMock } = vi.hoisted(() => ({
  modelsMock: vi.fn(), guessMock: vi.fn(), fitMock: vi.fn(), ellipseMock: vi.fn(),
}));
vi.mock("../../../lib/api/analysisExtras", () => ({
  surfaceModels: modelsMock, surfaceGuess: guessMock, surfaceFit: fitMock, ellipseFit: ellipseMock,
}));

const SHEET: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [1, 2, 3, 4, 5, 6],
    values: [[0.2, 0.3, 0.5], [0.1, 0.2, 0.7], [0.4, 0.4, 0.2], [0.3, 0.3, 0.4], [0.6, 0.2, 0.2], [0.2, 0.2, 0.6]],
    labels: ["a", "b", "c"],
    units: ["", "", ""],
    metadata: { x_column_name: "t", x_column_unit: "s" },
  },
  excludedRows: [1],
  filter: [{ col: -1, kind: "range", max: 5.5 }],
};
// Analysis view: times 1, 3, 4, 5 (row 1 excluded, row 5 filtered out).
const VIEW_TIMES = [1, 3, 4, 5];

beforeEach(() => {
  vi.clearAllMocks();
  modelsMock.mockResolvedValue([{ name: "Plane", param_names: ["a", "b", "c"], description: "plane" }]);
  guessMock.mockResolvedValue({ param_names: ["a", "b", "c"], p0: [1, 1, 1] });
  fitMock.mockRejectedValue(new Error("stop"));
  ellipseMock.mockRejectedValue(new Error("stop"));
  useApp.setState({ datasets: [SHEET], activeId: "d1", status: "", xKey: null, yKeys: null, seriesOrder: null, selection: null });
});

describe("Surface fit input", () => {
  it("fits the analysis view: X axis and the next two channels, excluded and filtered rows left out", async () => {
    render(<SurfaceFitPanel />);
    await waitFor(() => expect(screen.getByLabelText("Start a")).toHaveValue("1"));
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    await waitFor(() => expect(fitMock.mock.calls.length).toBe(1));
    expect(fitMock.mock.calls[0][0]).toMatchObject({ x: VIEW_TIMES, y: [0.2, 0.4, 0.3, 0.6], z: [0.3, 0.4, 0.3, 0.2] });
  });
});

describe("Ellipse fit input", () => {
  it("fits the analysis view of X axis + first channel", async () => {
    render(<EllipseFitPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Fit ellipse" }));
    await screen.findByRole("alert");
    expect(ellipseMock.mock.calls[0][0]).toMatchObject({ x: VIEW_TIMES, y: [0.2, 0.4, 0.3, 0.6] });
  });
});

describe("Peak wizard input", () => {
  it("works on the analysis view segment of the plotted channel", () => {
    const { result } = renderHook(() => usePeakWizard());
    expect(result.current.points).toBe(VIEW_TIMES.length);
  });
});

describe("Tabulate input", () => {
  it("summarises the analysis view", () => {
    const { result } = renderHook(() => useTabulate());
    const total = result.current.rows.reduce((n, row) => n + row.values[0].count, 0);
    expect(total).toBe(VIEW_TIMES.length);
  });
});

// Rows an aux figure cannot draw (negative values) sit ONLY in the excluded row 1
// and the filtered-out row 5: none is counted while they are left out of the view.
const BAD = [-1, -1, -1];
const withBadRows = (over: Partial<Dataset> = {}): Dataset => ({
  ...SHEET,
  data: { ...SHEET.data, values: SHEET.data.values.map((row, i) => (i === 1 || i === 5 ? BAD : row)) },
  ...over,
});

describe("Pie input", () => {
  it("draws the analysis view: rows left out of it are never counted as dropped", () => {
    useApp.setState({ datasets: [withBadRows()] });
    const { result } = renderHook(() => usePie());
    expect(result.current.hasData).toBe(true);
    expect(result.current.notice).toBeNull();
    expect(result.current.problem).toBeNull();
  });

  it("control: with the rows back in the view they are dropped and said so", () => {
    useApp.setState({ datasets: [withBadRows({ excludedRows: undefined, filter: undefined })] });
    const { result } = renderHook(() => usePie());
    expect(result.current.notice).toMatch(/2 of 6 rows/);
  });
});

describe("Ternary input", () => {
  it("draws the analysis view: rows left out of it are never counted as dropped", () => {
    useApp.setState({ datasets: [withBadRows()] });
    const { result } = renderHook(() => useTernary());
    expect(result.current.hasData).toBe(true);
    expect(result.current.notice).toBeNull();
  });

  it("control: with the rows back in the view they are dropped and said so", () => {
    useApp.setState({ datasets: [withBadRows({ excludedRows: undefined, filter: undefined })] });
    const { result } = renderHook(() => useTernary());
    expect(result.current.notice).not.toBeNull();
  });
});
