// The tools migrated onto the shared commit contract (lane RL): Ellipse fit,
// Optical gap and Surface fit "Add … as dataset". Fail-before: returning to the
// source and clicking Add again used to write a second identical worksheet, the
// output was not one undo step with any Library result, and nothing marked it
// stale when the source changed.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EllipseResult, SurfaceFitResult, TaucResult } from "../../../lib/api/analysisExtras";
import type { DataStruct } from "../../../lib/types";
import { recalculateAnalysisResult } from "../../../store/analysisResultActions";
import { useApp } from "../../../store/useApp";
import AnalysisResultToolbar from "../analysisresults/AnalysisResultToolbar";
import EllipseFitPanel from "../implicitfit/EllipseFitPanel";
import OpticalGapPanel from "../opticalgap/OpticalGapPanel";
import SurfaceFitPanel from "../surfacefit/SurfaceFitPanel";

const { ellipseMock, taucMock, surfaceMock } = vi.hoisted(() => ({
  ellipseMock: vi.fn(), taucMock: vi.fn(), surfaceMock: vi.fn(),
}));
vi.mock("../../../lib/api/analysisExtras", () => ({
  ellipseFit: ellipseMock,
  taucFit: taucMock,
  surfaceFit: surfaceMock,
  surfaceGuess: vi.fn(async () => ({ param_names: ["a", "b", "c"], p0: [0, 0, 0] })),
  surfaceModels: vi.fn(async () => [{ name: "Plane", param_names: ["a", "b", "c"], description: "z = a·x + b·y + c" }]),
}));
vi.mock("../SmallUPlot", () => ({ default: ({ label }: { label: string }) => <div role="img" aria-label={label} /> }));

const XY: DataStruct = {
  time: [0, 1, 2, 3, 4, 5], values: [[1, 2], [2, 3], [3, 1], [4, 5], [5, 2], [6, 6]],
  labels: ["y", "z"], units: ["eV", ""], metadata: { x_column_name: "x", x_column_unit: "eV" },
};

const ELLIPSE: EllipseResult = {
  n_points: 6, geometric: true, converged: true, center_x: 3, center_y: -2, semi_major: 5, semi_minor: 2, angle_deg: 30,
  center_x_se: 0.01, center_y_se: 0.02, semi_major_se: 0.03, semi_minor_se: 0.04, angle_deg_se: 0.5, rms: 0.05, arc_coverage_deg: 350,
  algebraic: { center_x: 3, center_y: -2, semi_major: 5, semi_minor: 2, angle_deg: 30 }, residuals: [0, 0, 0, 0, 0, 0],
  curve_x: [1, 2, 3, 1], curve_y: [1, 2, 0, 1],
};
const TAUC: TaucResult = {
  kind: "direct", label: "Direct allowed", gamma: 2, eg: 2.35, eg_se: 0.01, eg_se_fit: 0.01, eg_window_sd: null, eg_lcl: 2.32, eg_ucl: 2.38, level: 0.95,
  slope: 100, intercept: -235, r2: 0.999, n_fit: 5, e_min: 2.6, e_max: 3.2, auto_window: false,
  energy: [2, 2.6, 3, 3.2], tauc: [0, 25, 65, 85], alpha: [0, 1, 2, 3], fit_energy: [2.35, 3.2], fit_tauc: [0, 85],
};

const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "src");

beforeEach(() => {
  vi.clearAllMocks();
  ellipseMock.mockResolvedValue(ELLIPSE);
  taucMock.mockResolvedValue(TAUC);
  useApp.setState({
    datasets: [{ id: "src", name: "loop", data: XY }], activeId: "src", status: "", analysisResults: [],
    history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual",
  });
});

describe.each([
  { tool: "Ellipse fit", Panel: EllipseFitPanel, run: "Fit ellipse", add: "Add fitted ellipse as dataset" },
  { tool: "Optical gap", Panel: OpticalGapPanel, run: "Fit gap", add: "Add Tauc data as dataset" },
])("$tool commits through the shared contract", ({ tool, Panel, run, add }) => {
  it("a repeat Add on the same computation creates no duplicate", async () => {
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: run }));
    fireEvent.click(await screen.findByRole("button", { name: add }));
    expect(outputs()).toHaveLength(1);
    // Back on the source, the same computation is shown again: Add says why it
    // is unavailable, and a click (or a programmatic call) adds nothing.
    act(() => useApp.getState().setActive("src"));
    const again = await screen.findByRole("button", { name: add });
    expect(again).toBeDisabled();
    expect(again).toHaveAttribute("title", expect.stringContaining(`Already added as “${outputs()[0].name}”`));
    fireEvent.click(again);
    expect(outputs()).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().analysisResults[0].producer.label).toBe(tool);
  });

  it("is one undo step with its Library result, and Undo re-enables Add", async () => {
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: run }));
    fireEvent.click(await screen.findByRole("button", { name: add }));
    expect(useApp.getState().history).toHaveLength(1);
    act(() => useApp.getState().undo());
    expect(outputs()).toHaveLength(0);
    expect(useApp.getState().analysisResults).toHaveLength(0);
    act(() => useApp.getState().setActive("src"));
    expect(await screen.findByRole("button", { name: add })).toBeEnabled();
  });

  it("marks the committed output stale when its source changes", async () => {
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: run }));
    fireEvent.click(await screen.findByRole("button", { name: add }));
    const outputId = outputs()[0].id;
    act(() => {
      useApp.setState((s) => ({ datasets: s.datasets.map((d) => d.id === "src" ? { ...d, data: { ...d.data, time: [0, 1, 2, 3, 4, 9] } } : d) }));
      useApp.getState().touchDataset("src");
    });
    expect(useApp.getState().staleDatasets).toEqual([outputId]);
  });
});

describe("Surface fit commits through the shared contract", () => {
  it("a repeat Add on the same fit creates no duplicate", async () => {
    const fit: SurfaceFitResult = {
      model_name: "Plane", param_names: ["a", "b", "c"], params: [2, 1, 1], errors: [0.1, 0.2, 0.3],
      inference: [
        { value: 2, error: 0.1, t: 20, prob: 0.001, lcl: 1.7, ucl: 2.3 },
        { value: 1, error: 0.2, t: 5, prob: 0.01, lcl: 0.4, ucl: 1.6 },
        { value: 1, error: 0.3, t: 3, prob: 0.05, lcl: 0.1, ucl: 1.9 },
      ],
      level: 0.95, fixed: [false, false, false], z_fit: [2, 3, 1, 5, 2, 6], residuals: [0, 0, 0, 0, 0, 0],
      r2: 0.9, rmse: 0.5, chi_sq_red: 0.25, n_points: 6, n_free: 3, dof: 3, exit_flag: 1,
    };
    surfaceMock.mockResolvedValue(fit);
    render(<SurfaceFitPanel />);
    await waitFor(() => expect(screen.getByLabelText("Start a")).toHaveValue("0"));
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    const add = "Add fitted surface as dataset";
    fireEvent.click(await screen.findByRole("button", { name: add }));
    act(() => useApp.getState().setActive("src"));
    fireEvent.click(await screen.findByRole("button", { name: add }));
    expect(outputs()).toHaveLength(1);
    expect(useApp.getState().analysisResults.map((r) => r.producer.id)).toEqual(["surface-fit"]);
  });
});

describe("a committed output in the result workspace", () => {
  it("offers no in-place Recalculate and says how to replace it", () => {
    render(<AnalysisResultToolbar result={{
      version: 1, id: "r", name: "Ellipse fit · loop", producer: { id: "ellipse-fit", label: "Ellipse fit", version: 1 },
      sources: [{ datasetId: "src", role: "input" }], outputs: [{ datasetId: "out", role: "linked-worksheet" }],
      parameters: { commitKey: "k" }, warnings: [], createdAt: "2026-11-22T00:00:00Z",
    }} source={useApp.getState().datasets[0]} status="Out of date" busy={null} mode="linked"
      snapshotState="current" recipeReady={false} hasReflFit={false} hasFitSpec={false} fitReplayable={false}
      hasOutput outputHasRecipe={false} outputRecomputable={false} setBusy={() => undefined}
      onOpenSource={() => undefined} onOpenOutput={() => undefined} onEdit={() => undefined} onRecalculate={() => undefined}
      onRerun={() => undefined} onDuplicate={() => undefined} onReport={() => undefined} onRename={() => undefined}
      onRemove={() => undefined} />);
    const recalc = screen.getByRole("button", { name: "Recalculate" });
    expect(recalc).toBeDisabled();
    expect(recalc).toHaveAttribute("title", expect.stringContaining("Run the tool again to replace it"));
  });

  it("refuses a programmatic recalculate with the producer named", async () => {
    render(<EllipseFitPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Fit ellipse" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add fitted ellipse as dataset" }));
    const [result] = useApp.getState().analysisResults;
    expect(await recalculateAnalysisResult(result.id)).toBe(false);
    expect(useApp.getState().status).toContain("run Ellipse fit again to replace it");
  });
});
