// "Save By result" for the shared-byrun tools that opted in (Find peaks, Peak
// analyzer, Baseline, Surface fit, Optical gap, Ellipse fit; Signal processing
// is in signalBySave.test.tsx): each saves exactly the per-level rows it shows,
// refuses a duplicate, allows saving again after Undo, and the result goes out
// of date when the worksheet changes.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { snapshotResultState } from "../../../lib/analysisResultFreshness";
import { baselineALS } from "../../../lib/api/baseline";
import { ellipseFit, surfaceFit, surfaceGuess, taucFit } from "../../../lib/api/analysisExtras";
import { findPeaks } from "../../../lib/api/peaks";
import { DEFAULT_RECIPE } from "../../../lib/peakwizard";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import BaselineByLevel from "../baseline/BaselineByLevel";
import EllipseFitByLevel from "../implicitfit/EllipseFitByLevel";
import OpticalGapByLevel from "../opticalgap/OpticalGapByLevel";
import { DEFAULT_PEAK_FIND } from "../peaks/peakFindParams";
import PeakByLevelSection from "../peaks/PeakByLevelSection";
import PeakWizardByLevel from "../peakwizard/PeakWizardByLevel";
import SurfaceFitByLevel from "../surfacefit/SurfaceFitByLevel";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn() }));
vi.mock("../../../lib/api/baseline", () => ({
  baselineALS: vi.fn(), baselineAnchor: vi.fn(), baselineEstimate: vi.fn(), baselineModPoly: vi.fn(),
  baselineRegion: vi.fn(), baselineRollingBall: vi.fn(), baselineShirley: vi.fn(), baselineXrdLowAngle: vi.fn(),
}));
vi.mock("../../../lib/api/analysisExtras", () => ({
  ellipseFit: vi.fn(), surfaceFit: vi.fn(), surfaceGuess: vi.fn(), taucFit: vi.fn(),
}));

// Column 0 = Group (two levels of six rows), 1 = Signal / Y, 2 = Z.
const DATA: DataStruct = {
  time: Array.from({ length: 12 }, (_, i) => i),
  values: Array.from({ length: 12 }, (_, i) => [i < 6 ? 0 : 1, (i < 6 ? 1 : 11) + (i % 6), i * 3]),
  labels: ["Group", "Signal", "Z"],
  units: ["", "cps", ""],
  metadata: {},
};

// NaN region bounds: the saved parameters must survive them.
const ALS = { lam: 1e6, p: 0.01, radius: 100, order: 5, maxWindowDeg: 2, regionXMin: NaN, regionXMax: NaN, regionYMin: NaN, regionYMax: NaN, maxIter: 50, anchorMethod: "pchip" };
const TAUC = { xUnit: "eV", signal: "alpha", percent: false, thickness: "", kind: "direct", eMin: "", eMax: "" } as const;
const SURFACE_MODEL = { name: "Plane", description: "", param_names: ["a"] } as never;

interface Case { tool: string; toolId: string; ui: () => ReactElement; arrange: () => void }

const CASES: Case[] = [
  {
    tool: "Find peaks", toolId: "peaks", ui: () => <PeakByLevelSection params={{ ...DEFAULT_PEAK_FIND }} />,
    arrange: () => { vi.mocked(findPeaks).mockResolvedValue({ peaks: [{ center: 3, prominence: 2, localSNR: 9 }], background: [] } as never); },
  },
  {
    tool: "Peak analyzer", toolId: "peak-wizard",
    ui: () => <PeakWizardByLevel recipe={{ ...DEFAULT_RECIPE, baseline: { ...DEFAULT_RECIPE.baseline, method: "als" as const, lam: 1e5, p: 0.02 } }} />,
    arrange: () => {
      vi.mocked(baselineALS).mockImplementation(async ({ y }) => ({ baseline: y.map(() => 1) }) as never);
      vi.mocked(findPeaks).mockResolvedValue({ peaks: [{ center: 3, prominence: 2, localSNR: 9 }], background: [] } as never);
    },
  },
  {
    tool: "Baseline", toolId: "baseline", ui: () => <BaselineByLevel b={{ method: "als", params: ALS }} />,
    arrange: () => { vi.mocked(baselineALS).mockImplementation(async ({ y }) => ({ baseline: y.map((v) => v - 2) }) as never); },
  },
  {
    tool: "Surface fit", toolId: "surface-fit",
    ui: () => <SurfaceFitByLevel f={{ model: SURFACE_MODEL, lower: [""], upper: [""], xCol: -1, yCol: 1, zCol: 2 }} />,
    arrange: () => {
      vi.mocked(surfaceGuess).mockResolvedValue({ param_names: ["a"], p0: [1] });
      vi.mocked(surfaceFit).mockImplementation((async (req: { y: number[] }) => ({
        params: [req.y[0]], r2: 0.5, rmse: 0.25, n_points: req.y.length, exit_flag: 1, dof: 5,
      })) as never);
    },
  },
  {
    tool: "Optical gap", toolId: "optical-gap", ui: () => <OpticalGapByLevel g={{ ...TAUC, xCol: -1, yCol: 1 }} />,
    arrange: () => {
      vi.mocked(taucFit).mockImplementation((async (req: { y: number[] }) => ({
        eg: req.y[0], eg_se: 0.5, e_min: 1, e_max: 2, r2: 0.99, n_fit: 4,
      })) as never);
    },
  },
  {
    tool: "Ellipse fit", toolId: "ellipse-fit", ui: () => <EllipseFitByLevel e={{ geometric: true, xCol: -1, yCol: 1 }} />,
    arrange: () => {
      vi.mocked(ellipseFit).mockImplementation((async () => ({
        center_x: 1, center_y: 2, semi_major: 3, semi_minor: 2, angle_deg: 4, rms: 0.1, arc_coverage_deg: 360, converged: true,
      })) as never);
    },
  },
];

const pickGroup = (tool: string) => fireEvent.change(screen.getByLabelText(`${tool} By (optional)`), { target: { value: "0" } });
const shownRows = (tool: string) => within(within(screen.getByRole("region", { name: `${tool} by level` })).getByRole("table")).getAllByRole("row").slice(1);

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", xKey: null, yKeys: [1], seriesOrder: null,
    status: "", selection: null, analysisResults: [], openAnalysisResultId: null, history: [], future: [],
  });
});

describe.each(CASES)("$tool: Save By result", ({ tool, toolId, ui, arrange }) => {
  it("is not offered until a By column is picked (display-only default)", () => {
    arrange();
    render(ui());
    expect(screen.queryByRole("button", { name: "Save By result" })).toBeNull();
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });

  it("saves exactly the rows shown, refuses a duplicate, and saves again after Undo", async () => {
    arrange();
    render(ui());
    pickGroup(tool);
    const save = await screen.findByRole("button", { name: "Save By result" });
    await waitFor(() => expect(save).toBeEnabled());
    const shown = shownRows(tool).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    fireEvent.click(save);
    fireEvent.click(save); // a second click in the same tick saves nothing more
    const results = useApp.getState().analysisResults;
    expect(results).toHaveLength(1);
    const [result] = results;
    expect(result!.producer).toEqual({ id: "analysis-batch", label: tool, version: 1 });
    expect(result!.parameters).toMatchObject({ toolId, byColumn: "Group" });
    const table = result!.tables![0]!;
    expect(table.rows.map((r) => [r[0], r[2]])).toEqual(shown.map((r) => [r[0], Number(r[1])]));
    expect(table.rows.map((r) => r[1])).toEqual(shown.map(() => "Completed"));
    await waitFor(() => expect(save).toBeDisabled());
    expect(screen.getByText("This By result is already saved.")).toBeInTheDocument();

    useApp.getState().undo();
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(0));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save By result" })).toBeEnabled());
  });

  it("goes out of date once the worksheet changes", async () => {
    arrange();
    render(ui());
    pickGroup(tool);
    const save = await screen.findByRole("button", { name: "Save By result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    const [saved] = useApp.getState().analysisResults;
    expect(snapshotResultState(saved!, useApp.getState().datasets)).toBe("current");
    useApp.setState({ datasets: [{ ...useApp.getState().datasets[0]!, excludedRows: [2] }] });
    expect(snapshotResultState(saved!, useApp.getState().datasets)).toBe("out-of-date");
  });
});
