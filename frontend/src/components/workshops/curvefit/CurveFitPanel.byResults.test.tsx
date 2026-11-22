// Curve fit By: characterization of what a By run shows (one collapsible
// section per level with its parameter table and R² / RMSE; the single-fit
// results hidden), pinned before "Save By result" was added so the display is
// provably unchanged, then the Save option itself: one analysis-batch result
// with a row per level, a duplicate refused, Undo, and Out of date.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { snapshotResultState } from "../../../lib/analysisResultFreshness";
import { fitModel } from "../../../lib/api";
import { listFitModels } from "../../../lib/api/curvefit";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
  fetchBookData: vi.fn(),
  reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  autoGuess: vi.fn(),
  listFitModels: vi.fn(),
  bootstrapFit: vi.fn(),
}));
vi.mock("../../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/figures")>()),
  exportCornerFigure: vi.fn(),
}));

// col0 "grp" (two levels of six rows), col1 "y" (plotted).
const DATA: DataStruct = {
  time: Array.from({ length: 12 }, (_, i) => i),
  values: Array.from({ length: 12 }, (_, i) => [i < 6 ? 0 : 1, (i < 6 ? 10 : 15) + 10 * (i % 6)]),
  labels: ["grp", "y"],
  units: ["", ""],
  metadata: {},
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({
    models: [{ name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] }],
  });
  // The first x of a level identifies it: level A -> slope 2, level B -> slope 3.
  vi.mocked(fitModel).mockImplementation((async (req: { x: number[] }) => ({
    params: [req.x[0] === 0 ? 2 : 3, 1], errors: [0.1, 0.2], R2: 0.98, RMSE: 0.5, yFit: [0],
  })) as never);
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", xKey: null, yKeys: [1], seriesOrder: null, errKeys: {},
    fitOverlay: null, curveFitOpen: true,
    status: "", selection: null, analysisResults: [], openAnalysisResultId: null, history: [], future: [],
  });
});

const pickGroup = async () => {
  fireEvent.change(await screen.findByLabelText("By (optional)"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("tab", { name: "Results" }));
};

describe("Curve fit By display (characterization)", () => {
  it("shows one section per level with its parameter table and goodness of fit", async () => {
    render(<CurveFitPanel />);
    await pickGroup();
    await waitFor(() => expect(screen.getAllByText(/n=6/)).toHaveLength(2));
    expect(screen.getAllByText("R² 0.98 · RMSE 0.5")).toHaveLength(2);
    const tables = screen.getAllByRole("table").filter((t) => within(t).queryByText("± err"));
    expect(tables).toHaveLength(2);
    expect(within(tables[0]!).getAllByRole("row")[1]!.textContent).toContain("m");
    expect(within(tables[0]!).getAllByRole("row")[1]!.textContent).toContain("2");
    expect(within(tables[1]!).getAllByRole("row")[1]!.textContent).toContain("3");
  });

  it("re-fits every level when the weighting changes, and never records a result by itself", async () => {
    render(<CurveFitPanel />);
    await pickGroup();
    await waitFor(() => expect(screen.getAllByText(/n=6/)).toHaveLength(2));
    vi.mocked(fitModel).mockClear();
    fireEvent.change(screen.getByLabelText("Weighting"), { target: { value: "poisson" } });
    await waitFor(() => expect(vi.mocked(fitModel).mock.calls.filter((c) => c[0].dy)).toHaveLength(2));
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });
});

describe("Curve fit Save By result", () => {
  it("is offered only once a By column is picked", async () => {
    render(<CurveFitPanel />);
    await screen.findByLabelText("By (optional)");
    expect(screen.queryByRole("button", { name: "Save By result" })).toBeNull();
  });

  it("saves one row per level, refuses a duplicate, and saves again after Undo", async () => {
    render(<CurveFitPanel />);
    await pickGroup();
    const save = await screen.findByRole("button", { name: "Save By result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    fireEvent.click(save);
    const results = useApp.getState().analysisResults;
    expect(results).toHaveLength(1);
    const [result] = results;
    expect(result!.producer).toEqual({ id: "analysis-batch", label: "Curve fit", version: 1 });
    expect(result!.parameters).toMatchObject({ toolId: "curvefit", byColumn: "grp", model: "Linear" });
    expect(result!.tables![0]!.columns).toEqual(["Level", "Status", "Rows", "m", "m ± err", "b", "b ± err", "R²", "RMSE", "Warnings"]);
    expect(result!.tables![0]!.rows).toEqual([
      ["0", "Completed", 6, 2, 0.1, 1, 0.2, 0.98, 0.5, null],
      ["1", "Completed", 6, 3, 0.1, 1, 0.2, 0.98, 0.5, null],
    ]);
    await waitFor(() => expect(save).toBeDisabled());
    expect(screen.getByText("This By result is already saved.")).toBeInTheDocument();

    useApp.getState().undo();
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(0));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save By result" })).toBeEnabled());
  });

  it("records a level that could not be fitted as a Failed row", async () => {
    vi.mocked(fitModel).mockImplementation((async (req: { x: number[] }) => {
      if (req.x[0] !== 0) throw new Error("singular");
      return { params: [2, 1], errors: [0.1, 0.2], R2: 0.98, RMSE: 0.5, yFit: [0] };
    }) as never);
    render(<CurveFitPanel />);
    await pickGroup();
    const save = await screen.findByRole("button", { name: "Save By result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    const [result] = useApp.getState().analysisResults;
    expect(result!.tables![0]!.rows[1]).toEqual(["1", "Failed", 6, null, null, null, null, null, null, "singular"]);
    expect(result!.warnings).toEqual(["1: singular"]);
  });

  it("goes out of date once the worksheet changes", async () => {
    render(<CurveFitPanel />);
    await pickGroup();
    const save = await screen.findByRole("button", { name: "Save By result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    const [saved] = useApp.getState().analysisResults;
    expect(snapshotResultState(saved!, useApp.getState().datasets)).toBe("current");
    useApp.setState({ datasets: [{ ...useApp.getState().datasets[0]!, excludedRows: [2] }] });
    expect(snapshotResultState(saved!, useApp.getState().datasets)).toBe("out-of-date");
  });
});
