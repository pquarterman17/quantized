// "Open in <tool>" for committed outputs (lane RO). Per tool: the reopened tool
// starts from the RECORDED settings on the RECORDED source (seed round-trip),
// its commit replaces the old output in ONE undo step (or adds new when asked),
// a missing or changed source opens with a notice, and a producer that cannot
// reopen is disabled with the reason (result workspace and Library menu).

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EllipseResult, SurfaceFitResult, TaucResult } from "../../../lib/api/analysisExtras";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { buildLibraryHierarchy } from "../../../lib/libraryHierarchy";
import type { DataStruct } from "../../../lib/types";
import { commitAnalysisOutput, type AnalysisOutputCommit } from "../../../store/analysisOutputCommit";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import { buildArtifactMenu, type ArtifactNode } from "../../Library/artifactContextActions";
import type { ContextMenuItem } from "../../overlays/ContextMenu";
import ReopenInToolButton from "../analysisresults/ReopenInToolButton";
import { useBaseline } from "../baseline/useBaseline";
import EllipseFitPanel from "../implicitfit/EllipseFitPanel";
import OpticalGapPanel from "../opticalgap/OpticalGapPanel";
import SurfaceFitPanel from "../surfacefit/SurfaceFitPanel";
import { useTabulate } from "../tabulate/useTabulate";
import { useAnalysisCommit } from "./useAnalysisCommit";

const { ellipseMock, taucMock, surfaceMock } = vi.hoisted(() => ({
  ellipseMock: vi.fn(), taucMock: vi.fn(), surfaceMock: vi.fn(),
}));
vi.mock("../../../lib/api/analysisExtras", () => ({
  ellipseFit: ellipseMock,
  taucFit: taucMock,
  surfaceFit: surfaceMock,
  surfaceGuess: vi.fn(async () => ({ param_names: ["a", "b", "c"], p0: [0, 0, 0] })),
  surfaceModels: vi.fn(async () => [
    { name: "Plane", param_names: ["a", "b", "c"], description: "plane" },
    { name: "Paraboloid", param_names: ["a", "b", "c"], description: "paraboloid" },
  ]),
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
  kind: "indirect", label: "Indirect allowed", gamma: 0.5, eg: 2.35, eg_se: 0.01, eg_se_fit: 0.01, eg_window_sd: null, eg_lcl: 2.32, eg_ucl: 2.38, level: 0.95,
  slope: 100, intercept: -235, r2: 0.999, n_fit: 5, e_min: 2.6, e_max: 3.2, auto_window: false,
  energy: [2, 2.6, 3, 3.2], tauc: [0, 25, 65, 85], alpha: [0, 1, 2, 3], fit_energy: [2.35, 3.2], fit_tauc: [0, 85],
};
const SURFACE: SurfaceFitResult = {
  model_name: "Paraboloid", param_names: ["a", "b", "c"], params: [2, 1, 1], errors: [0.1, 0.2, 0.3],
  inference: [0, 1, 2].map(() => ({ value: 1, error: 0.1, t: 10, prob: 0.01, lcl: 0.8, ucl: 1.2 })),
  level: 0.95, fixed: [false, false, false], z_fit: [2, 3, 1, 5, 2, 6], residuals: [0, 0, 0, 0, 0, 0],
  r2: 0.9, rmse: 0.5, chi_sq_red: 0.25, n_points: 6, n_free: 3, dof: 3, exit_flag: 1,
};

const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "src");
const resultId = () => useApp.getState().analysisResults[0]!.id;

beforeEach(() => {
  vi.clearAllMocks();
  ellipseMock.mockResolvedValue(ELLIPSE);
  taucMock.mockResolvedValue(TAUC);
  surfaceMock.mockResolvedValue(SURFACE);
  useToolReopen.setState({ sessions: {} });
  useAnalysisExtras.setState({ open: [] });
  useApp.setState({
    datasets: [{ id: "src", name: "loop", data: XY }], activeId: "src", status: "", analysisResults: [],
    history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual", openAnalysisResultId: null,
    xKey: null, yKeys: null, seriesOrder: null, baselineOpen: false, tabulateOpen: false,
  });
});

/** Commit an ellipse fit with the ALGEBRAIC method through the panel, then close it. */
async function commitAlgebraicEllipse(): Promise<void> {
  const view = render(<EllipseFitPanel />);
  fireEvent.change(screen.getByLabelText("Method"), { target: { value: "algebraic" } });
  fireEvent.click(screen.getByRole("button", { name: "Fit ellipse" }));
  fireEvent.click(await screen.findByRole("button", { name: "Add fitted ellipse as dataset" }));
  expect(outputs()).toHaveLength(1);
  view.unmount();
}

describe("Ellipse fit: reopen, adjust, replace", () => {
  it("reopens on the recorded source with the recorded method", async () => {
    await commitAlgebraicEllipse();
    expect(useApp.getState().activeId).not.toBe("src");
    act(() => { expect(openCommittedResultInTool(resultId())).toBe(true); });
    expect(useApp.getState().activeId).toBe("src");
    expect(useAnalysisExtras.getState().open).toContain("ellipse-fit");
    render(<EllipseFitPanel />);
    expect(screen.getByLabelText("Method")).toHaveValue("algebraic");
    expect(screen.getByText(/Opened from the result/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Replace “loop \(fitted ellipse\)”/ })).toBeChecked();
  });

  it("a re-commit replaces the old output in ONE undo step; Undo restores it", async () => {
    await commitAlgebraicEllipse();
    const [old] = outputs();
    const oldResult = useApp.getState().analysisResults[0];
    act(() => { openCommittedResultInTool(resultId()); });
    render(<EllipseFitPanel />);
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "geometric" } });
    ellipseMock.mockResolvedValue({ ...ELLIPSE, curve_x: [9, 9, 9], curve_y: [8, 8, 8] });
    fireEvent.click(screen.getByRole("button", { name: "Fit ellipse" }));
    fireEvent.click(await screen.findByRole("button", { name: "Replace “loop (fitted ellipse)”" }));
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0]!.id).toBe(old!.id);
    expect(outputs()[0]!.data.time).toEqual([9, 9, 9]);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().analysisResults[0]!.parameters?.["settings"]).toMatchObject({ geometric: true });
    expect(useApp.getState().history).toHaveLength(2);
    act(() => useApp.getState().undo());
    expect(outputs()[0]!.data).toEqual(old!.data);
    expect(useApp.getState().analysisResults).toEqual([oldResult]);
  });

  it("Add as new keeps the old output and adds a second result", async () => {
    await commitAlgebraicEllipse();
    act(() => { openCommittedResultInTool(resultId()); });
    render(<EllipseFitPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "Add as a new output" }));
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "geometric" } });
    fireEvent.click(screen.getByRole("button", { name: "Fit ellipse" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add fitted ellipse as dataset" }));
    expect(outputs()).toHaveLength(2);
    expect(useApp.getState().analysisResults).toHaveLength(2);
  });

  it("survives StrictMode's double mount: the session and the seeded values stand", async () => {
    await commitAlgebraicEllipse();
    act(() => { openCommittedResultInTool(resultId()); });
    render(<StrictMode><EllipseFitPanel /></StrictMode>);
    await act(async () => { await Promise.resolve(); });
    expect(Object.keys(useToolReopen.getState().sessions)).toEqual(["ellipse-fit"]);
    expect(screen.getByLabelText("Method")).toHaveValue("algebraic");
    expect(screen.getByRole("radio", { name: /Replace/ })).toBeChecked();
  });

  it("a switch to Add as new while a commit is pending is honoured", async () => {
    await commitAlgebraicEllipse();
    act(() => { openCommittedResultInTool(resultId()); });
    const source = useApp.getState().datasets.find((d) => d.id === "src")!;
    const { result } = renderHook(() => useAnalysisCommit({
      producer: { id: "ellipse-fit", label: "Ellipse fit", version: 1 }, sourceId: "src",
      computedOn: analysisDataFingerprint(source), settings: { geometric: true, other: 1 },
      output: (s) => ({ name: `${s.name} (other)`, data: XY }),
    }));
    expect(result.current.replacing).toBe("loop (fitted ellipse)");
    let release: (value: AnalysisOutputCommit["output"]) => void = () => undefined;
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.commitAsync(() => new Promise((resolve) => { release = resolve; }));
    });
    act(() => useToolReopen.getState().setMode("ellipse-fit", "new"));
    await act(async () => { release((s) => ({ name: `${s.name} (other)`, data: XY })); await pending; });
    expect(outputs()).toHaveLength(2);
  });

  it("a missing source opens the tool with a notice, no settings and no replace", async () => {
    await commitAlgebraicEllipse();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "src") })));
    act(() => { openCommittedResultInTool(resultId()); });
    render(<EllipseFitPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent("no longer exists");
    expect(screen.queryByRole("radio", { name: /Replace/ })).toBeNull();
    expect(screen.getByText(/not this result’s source/)).toBeInTheDocument();
  });

  it("a changed source opens seeded, with a notice to run it again", async () => {
    await commitAlgebraicEllipse();
    act(() => useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "src" ? { ...d, data: { ...d.data, time: [0, 1, 2, 3, 4, 9] } } : d)),
    })));
    act(() => { openCommittedResultInTool(resultId()); });
    render(<EllipseFitPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent("changed after this result was computed");
    expect(screen.getByLabelText("Method")).toHaveValue("algebraic");
  });

  it("closing the tool ends the session: a plain reopen starts from the defaults", async () => {
    await commitAlgebraicEllipse();
    act(() => { openCommittedResultInTool(resultId()); });
    const view = render(<EllipseFitPanel />);
    view.unmount();
    await act(async () => { await Promise.resolve(); }); // the end is deferred one microtask
    expect(useToolReopen.getState().sessions).toEqual({});
    render(<EllipseFitPanel />);
    expect(screen.getByLabelText("Method")).toHaveValue("geometric");
  });
});

describe("Optical gap and Surface fit seed round-trip", () => {
  it("Optical gap restores the X quantity, transition and fit window (not re-guessed)", async () => {
    const view = render(<OpticalGapPanel />);
    // Let the panel's own unit guess settle before overriding it.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    fireEvent.change(screen.getByLabelText("X quantity"), { target: { value: "nm" } });
    fireEvent.change(screen.getByLabelText("Transition type"), { target: { value: "indirect" } });
    fireEvent.change(screen.getByLabelText("Fit range minimum (eV)"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Fit gap" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Tauc data as dataset" }));
    view.unmount();
    act(() => { openCommittedResultInTool(resultId()); });
    render(<OpticalGapPanel />);
    // The unit guess (eV from the column unit) would run on mount; the record holds.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.getByLabelText("X quantity")).toHaveValue("nm");
    expect(screen.getByLabelText("Transition type")).toHaveValue("indirect");
    expect(screen.getByLabelText("Fit range minimum (eV)")).toHaveValue("2.5");
  });

  it("Surface fit restores the columns, the model and the start values", async () => {
    const view = render(<SurfaceFitPanel />);
    await waitFor(() => expect(screen.getByLabelText("Start a")).toHaveValue("0"));
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "Paraboloid" } });
    await waitFor(() => expect(screen.getByLabelText("Start a")).toHaveValue("0"));
    fireEvent.change(screen.getByLabelText("Start a"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add fitted surface as dataset" }));
    view.unmount();
    act(() => { openCommittedResultInTool(resultId()); });
    render(<SurfaceFitPanel />);
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("Paraboloid"));
    expect(screen.getByLabelText("Start a")).toHaveValue("5");
  });
});

describe("Baseline and Tabulate seed round-trip", () => {
  it("Baseline restores the method, its knobs and the plotted channel", () => {
    const source = useApp.getState().datasets[0]!;
    const out = commitAnalysisOutput({
      producer: { id: "baseline-subtract", label: "Baseline subtract", version: 1 }, sourceId: "src",
      computedOn: analysisDataFingerprint(source),
      settings: {
        method: "snip", anchors: null, n: 6, sum: 3,
        params: { lam: 1e6, p: 0.01, radius: 100, order: 5, maxWindowDeg: 7, regionXMin: Number.NaN, regionXMax: Number.NaN, regionYMin: Number.NaN, regionYMax: Number.NaN, maxIter: 50, anchorMethod: "pchip" },
        binding: { datasetId: "src", xKey: null, yKey: 1, xLabel: "x", yLabel: "z" },
      },
      output: (s) => ({ name: `${s.name} (bg-sub)`, data: s.data }),
    });
    expect(out.kind).toBe("created");
    act(() => { openCommittedResultInTool(resultId()); });
    expect(useApp.getState()).toMatchObject({ baselineOpen: true, activeId: "src", yKeys: [1], stageTab: "plot" });
    // Re-plotting the recorded channel is ONE undoable step, and said.
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["add Baseline subtract output", "plot the recorded Baseline channel"]);
    expect(useApp.getState().status).toContain("plotted “z”");
    const { result } = renderHook(() => useBaseline());
    expect(result.current.method).toBe("snip");
    expect(result.current.params.maxWindowDeg).toBe(7);
    expect(result.current.params.regionXMin).toBeNaN(); // recorded as null, read back as "no bound"
  });

  it("Tabulate restores the group and value columns, the stats and the total row", () => {
    const source = useApp.getState().datasets[0]!;
    commitAnalysisOutput({
      producer: { id: "tabulate", label: "Tabulate", version: 1 }, sourceId: "src",
      computedOn: analysisDataFingerprint(source),
      settings: { groupCols: [1], valueCols: [0, -1], statKeys: ["max", "count"], grandTotal: true, rows: 6 },
      output: () => ({ name: "y by z", data: XY }),
    });
    act(() => { openCommittedResultInTool(resultId()); });
    expect(useApp.getState().tabulateOpen).toBe(true);
    const { result } = renderHook(() => useTabulate());
    expect(result.current.groupCols).toEqual([1]);
    expect(result.current.valueCols).toEqual([0, -1]);
    expect(result.current.statKeys).toEqual(["count", "max"]); // catalog order
    expect(result.current.grandTotal).toBe(true);
  });
});

describe("a result saved before its settings were recorded (producer version 1)", () => {
  const batch = {
    version: 1 as const, id: "b1", name: "Fit band · loop", producer: { id: "fit-band", label: "Fit band", version: 1 },
    sources: [{ datasetId: "src", role: "input" as const }],
    outputs: [{ datasetId: "out", role: "linked-worksheet" as const }],
    parameters: { commitKey: "k", settings: {} }, warnings: [], createdAt: "2026-11-22T00:00:00Z",
  };

  it("is disabled with the reason in the result workspace", () => {
    render(<ReopenInToolButton result={batch} disabled={false} />);
    const button = screen.getByRole("button", { name: "Open in Curve Fit" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringContaining("saved before its settings were recorded"));
    expect(openCommittedResultInTool("b1")).toBe(false); // unknown id here: refuses, opens nothing
  });

  it("is disabled with the reason in the Library menu", () => {
    useApp.setState({ analysisResults: [batch] });
    const hierarchy = buildLibraryHierarchy({ folders: [], workbooks: [], datasets: [], analysisResults: [batch] });
    const node = hierarchy.byKey.get("analysis-result:b1") as Extract<ArtifactNode, { kind: "analysis-result" }>;
    const item = buildArtifactMenu(node).find((i): i is Extract<ContextMenuItem, { label: string }> => "label" in i && i.label === "Open in Curve Fit");
    expect(item).toMatchObject({ disabled: true });
    expect(item && "title" in item ? item.title : "").toContain("saved before its settings were recorded");
    expect(openCommittedResultInTool("b1")).toBe(false);
    expect(useApp.getState().status).toContain("saved before its settings were recorded");
    expect(useToolReopen.getState().sessions).toEqual({});
  });
});
