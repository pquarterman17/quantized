// CurveFitPanel — component test for the "By" grouping UI (JMP_GAP_PLAN J7
// residual). The fit/weighting/params flows are already covered by
// useCurveFit.test.ts; this just proves the panel actually surfaces the
// hook's new by* fields end-to-end.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listFitModels } from "../../../lib/api/curvefit";
import { fitModel } from "../../../lib/api";
import { appendCustomModels, deleteCustomModel, saveCustomModel } from "../../../lib/fitmodels";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
  fetchBookData: vi.fn(),
  reportEmit: vi.fn(),
}));
// autoGuess/listFitModels/bootstrapFit and exportCornerFigure moved to their
// own siblings (R8 bundle-diet pass) — mock them at their real import paths.
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

// Same fixture as useCurveFit.test.ts's By-grouping block: col0 "grp"
// (2-level nominal), col1 "y" (continuous, plotted).
const BY_DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [0, 10], [0, 20], [0, 30], [0, 40], [0, 50], [0, 60],
    [1, 15], [1, 25], [1, 35], [1, 45], [1, 55], [1, 65],
  ],
  labels: ["grp", "y"],
  units: ["", ""],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({
    models: [{ name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] }],
  });
  vi.mocked(fitModel).mockResolvedValue({ params: [2, 1], errors: [0.1, 0.2], R2: 0.98, RMSE: 0.5, yFit: [0] });
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: BY_DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: [1],
    seriesOrder: null,
    errKeys: {},
    fitOverlay: null,
    curveFitOpen: true,
  });
});

describe("CurveFitPanel — By grouping (JMP_GAP_PLAN J7 residual)", () => {
  it("shows the By selector once a categorical column is available", async () => {
    render(<CurveFitPanel />);
    expect(await screen.findByLabelText("By (optional)")).toBeInTheDocument();
  });

  it("picking a By level renders one collapsible section per level and hides the single-fit table", async () => {
    render(<CurveFitPanel />);
    fireEvent.change(await screen.findByLabelText("By (optional)"), { target: { value: "0" } });
    await waitFor(() => expect(screen.getAllByText(/n=6/)).toHaveLength(2));
  });

  it("weights each By level with the panel's weighting (Poisson: dy = sqrt(max(|y|,1)) per level)", async () => {
    render(<CurveFitPanel />);
    fireEvent.change(await screen.findByLabelText("Weighting"), { target: { value: "poisson" } });
    fireEvent.change(screen.getByLabelText("By (optional)"), { target: { value: "0" } });
    await waitFor(() => expect(screen.getAllByText(/n=6/)).toHaveLength(2));
    expect(screen.queryByText(/fit unweighted/)).toBeNull();
    const calls = vi.mocked(fitModel).mock.calls.map((c) => c[0]).filter((r) => r.y.length === 6).slice(-2);
    expect(calls).toHaveLength(2);
    expect(calls.every((r) => r.dy)).toBe(true);
    for (const req of calls) expect(req.dy).toEqual(req.y.map((v) => Math.sqrt(Math.max(Math.abs(v), 1))));
  });

  it("takes each level's own sigma column rows for Y-error weighting and fails a bad level closed", async () => {
    const data: DataStruct = {
      time: BY_DATA.time,
      values: BY_DATA.values.map((r, i) => [r[0], r[1], r[0] === 1 && i === 8 ? 0 : 1 + r[0] + i * 0.1]),
      labels: ["grp", "y", "sy"],
      units: ["", "", ""],
      metadata: {},
    };
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data }], errKeys: { 1: 2 } });
    render(<CurveFitPanel />);
    fireEvent.change(await screen.findByLabelText("Weighting"), { target: { value: "yerr" } });
    fireEvent.change(screen.getByLabelText("By (optional)"), { target: { value: "0" } });
    await waitFor(() => expect(screen.getAllByText(/n=6/)).toHaveLength(2));
    const ok = vi.mocked(fitModel).mock.calls.map((c) => c[0]).filter((r) => r.dy);
    expect(ok).toHaveLength(1); // level 1 holds a zero sigma: refused, never fitted unweighted
    expect(ok[0].dy).toEqual(data.values.slice(0, 6).map((r) => r[2]));
    expect(await screen.findByText(/non-positive or invalid/)).toBeInTheDocument();
  });
});

// PR #432 review: the picker read the library ONCE (`useState`) and stayed
// stale while another surface — the Recipe Library, a project open merging
// models in — wrote it.
describe("CurveFitPanel — saved-model picker stays current", () => {
  const model = (name: string) => ({ version: 1 as const, name, equation: "y = a", params: ["a"], guesses: [1], lower: [null], upper: [null] });
  // Scoped to the model picker: Compare models lists the same options.
  const option = (name: string) => within(screen.getByLabelText("Model")).queryByRole("option", { name: `ƒ ${name}` });

  beforeEach(() => localStorage.clear());

  it("lists a model saved, appended (a project open) or deleted elsewhere while the panel is open", async () => {
    render(<CurveFitPanel />);
    await screen.findByLabelText("By (optional)");
    expect(option("Elsewhere")).toBeNull();
    act(() => {
      saveCustomModel(model("Elsewhere"));
    });
    expect(option("Elsewhere")).toBeInTheDocument();
    act(() => {
      appendCustomModels([model("From project")]);
    });
    expect(option("From project")).toBeInTheDocument();
    act(() => {
      deleteCustomModel("Elsewhere");
    });
    expect(option("Elsewhere")).toBeNull();
  });

  it("lists a model another WINDOW saved (the storage event) — review", async () => {
    render(<CurveFitPanel />);
    await screen.findByLabelText("By (optional)");
    // Another window's write: storage changes with no call into this module.
    localStorage.setItem("qz.customFitModels", JSON.stringify([model("Other window")]));
    expect(option("Other window")).toBeNull();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "qz.customFitModels" }));
    });
    expect(option("Other window")).toBeInTheDocument();
  });

  it("deleting the LOADED model elsewhere falls the picker back to a blank equation (review)", async () => {
    saveCustomModel(model("Loaded"));
    render(<CurveFitPanel />);
    await screen.findByLabelText("By (optional)");
    const picker = () => screen.getByRole("option", { name: "Custom equation…" }).closest("select")!;
    fireEvent.change(picker(), { target: { value: "custom:Loaded" } });
    expect(picker()).toHaveValue("custom:Loaded");
    act(() => {
      deleteCustomModel("Loaded"); // e.g. from the Recipe Library
    });
    expect(picker()).toHaveValue("custom:");
  });
});
