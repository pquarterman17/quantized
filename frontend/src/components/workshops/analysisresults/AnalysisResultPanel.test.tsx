import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset } from "../../../lib/types";

const { rerun, recalculate, recalculateFit, sendReport, exportInline, reportInline } = vi.hoisted(() => ({
  rerun: vi.fn(), recalculate: vi.fn(), recalculateFit: vi.fn(), sendReport: vi.fn(), exportInline: vi.fn(), reportInline: vi.fn(),
}));
vi.mock("../../../store/signalWorksheetCommand", () => ({ createSignalWorksheetFromApp: rerun }));
vi.mock("../../../store/analysisResultActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../store/analysisResultActions")>()),
  recalculateAnalysisResult: recalculate,
  recalculateFitAnalysisResult: recalculateFit,
  sendAnalysisResultPlotToReport: sendReport,
  exportAnalysisInlineTables: exportInline,
  sendAnalysisInlineTableToReport: reportInline,
}));
vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import AnalysisResultPanel from "./AnalysisResultPanel";
import { fitAnalysisResult } from "../../../lib/fitAnalysisResult";
import { reflectivityFitAnalysisResult } from "../../../lib/reflFitAnalysisResult";
import { statisticalTestAnalysisResult } from "../../../lib/statisticalTestAnalysisResult";
import { distributionAnalysisResult } from "../../../lib/distributionAnalysisResult";
import { fitYByXAnalysisResult } from "../../../lib/fitYByXAnalysisResult";
import { variabilityAnalysisResult } from "../../../lib/variabilityAnalysisResult";
import { DEFAULT_PARAMS, DEFAULT_SELECTION } from "../../../lib/statsTests";
import { publishFitResult } from "../../../store/peakTables";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useDistributionRequestStore } from "../../../store/distribution";
import { useFitYByXStore } from "../../../store/fitYByX";
import { useVariabilityStore } from "../../../store/variability";
import { useApp } from "../../../store/useApp";
import { encodeRecord } from "../reflectivity/reflFitRecord";
import { makeDataset, makeRecord } from "../reflectivity/reflFit.testkit";

const appState = useApp.getState;

const source: Dataset = {
  id: "source",
  name: "Raw trace",
  data: { time: [0, 1], values: [[1], [2]], labels: ["Signal"], units: ["V"], metadata: { xLabel: "Time" } },
};
const output: Dataset = {
  id: "output",
  name: "Smoothed trace",
  data: { time: [0, 1], values: [[1.1], [1.9]], labels: ["Signal"], units: ["V"], metadata: { xLabel: "Time" } },
  derivedFrom: { datasetId: "source", pipeline: "Smooth" },
  analysisRecipe: {
    kind: "signal-correction", version: 1, operation: "Smooth", xUnit: "s",
    channels: [{ index: 0, label: "Signal", unit: "V" }],
    params: { signalChannels: [0], smoothEnabled: true, smoothMethod: "moving", smoothWindow: 2 },
  },
};
const result: AnalysisResult = {
  version: 1,
  id: "result",
  name: "Smooth · Raw trace",
  producer: { id: "signal-processing", label: "Signal Processing", version: 1 },
  sources: [{ datasetId: "source", role: "input" }],
  outputs: [{ datasetId: "output", role: "linked-worksheet" }],
  selection: { datasetId: "source", channels: [{ index: 0, label: "Signal", unit: "V" }] },
  settingsRef: { datasetId: "output", field: "analysisRecipe" },
  tableRefs: [{ datasetId: "output", label: "Smoothed trace" }],
  plotBindings: [{ datasetId: "output", channels: [0] }],
  warnings: [],
  createdAt: "2026-10-08T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  rerun.mockResolvedValue("copy");
  useStatsTestsStore.setState({ open: false, request: null });
  useDistributionRequestStore.setState({ request: null });
  useFitYByXStore.setState({ open: false, request: null });
  useVariabilityStore.setState({ open: false, request: null });
  useApp.setState({
    datasets: [source, output],
    activeId: "source",
    analysisResults: [result],
    openAnalysisResultId: "result",
    staleDatasets: [],
    history: [],
    future: [],
    quickFigureBuilderDatasetId: null,
    quickFigureBuilderSeed: null,
    yKeys: null,
    stageTab: "worksheet",
  });
});

describe("AnalysisResultPanel", () => {
  it("opens a durable result with overview, tabular output, and provenance", () => {
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Raw trace")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    expect(screen.getByRole("columnheader", { name: "Time" })).toBeInTheDocument();
    expect(screen.getByText("1.9")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Provenance" }));
    expect(screen.getByText("output.analysisRecipe")).toBeInTheDocument();
  });

  it("opens the exact saved reflectivity fit from its durable result", () => {
    const base = makeRecord({ id: "rfit-selected", seq: 7 }, ["xrr", "other"]);
    const record = { ...base, request: {
      ...base.request,
      channels: base.request.channels.map((channel) => ({ ...channel, digest: "" })),
    } };
    // A partially restored project can retain the shared record on only one
    // of its channels. Opening must target the worksheet that actually owns
    // the record rather than the first merely-present source.
    const datasets = [makeDataset("xrr"), makeDataset("other", [encodeRecord(record)])];
    const reflectivityResult = reflectivityFitAnalysisResult(encodeRecord(record), datasets)!;
    useApp.setState({
      datasets,
      activeId: "xrr",
      analysisResults: [reflectivityResult],
      openAnalysisResultId: reflectivityResult.id,
      reflectivityOpen: false,
      reflectivityFitRecordId: null,
      stageTab: "worksheet",
    });

    render(<AnalysisResultPanel />);
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Reflectivity Fit")).toBeInTheDocument();
    expect(screen.queryByText(/Rerun as new preserves/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Diagnostics/ }));
    expect(screen.getByText(/parameters ended on a bound/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open fit workbench" }));

    expect(useApp.getState()).toMatchObject({
      activeId: "other",
      stageTab: "plot",
      reflectivityOpen: true,
      reflectivityFitRecordId: "rfit-selected",
      openAnalysisResultId: null,
    });
  });

  it("Open worksheet leaves the result workspace on the requested table", () => {
    useApp.setState({ stageTab: "plot" });
    render(<AnalysisResultPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: "Open worksheet" }));
    expect(useApp.getState()).toMatchObject({ activeId: "output", stageTab: "worksheet", openAnalysisResultId: null });
  });

  it("shows the selection from the output's recipe (the authority), not a stale envelope copy", () => {
    // bindSignalRecipe rewrites output.analysisRecipe when source columns are
    // renamed/rebound; the overview must follow it (PR #554 review).
    const rebound = {
      ...output,
      analysisRecipe: {
        ...output.analysisRecipe!,
        channels: [{ index: 0, label: "Rebound", unit: "V" }],
        params: { ...(output.analysisRecipe as { params: object }).params, xTrimMin: 0.25, xTrimMax: 0.75 },
      },
    } as Dataset;
    useApp.setState({ datasets: [source, rebound] });
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Rebound")).toBeInTheDocument();
    expect(screen.queryByText("Signal")).not.toBeInTheDocument();
    expect(screen.getByText("0.25 to 0.75")).toBeInTheDocument();
  });

  it("supports standard arrow-key navigation between result tabs", () => {
    render(<AnalysisResultPanel />);
    const overview = screen.getByRole("tab", { name: "Overview" });
    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("columnheader", { name: "Time" })).toBeInTheDocument();
  });

  it("shows recorded figure bindings and opens the editable figure workflow", async () => {
    render(<AnalysisResultPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Figures" }));
    expect(screen.getByRole("img", { name: "Preview of Smoothed trace" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Build figure" }));
    await waitFor(() => expect(useApp.getState().quickFigureBuilderDatasetId).toBe("output"));
    expect(useApp.getState().quickFigureBuilderSeed?.yKeys).toEqual([0]);
    expect(useApp.getState().openAnalysisResultId).toBeNull();
    expect(useApp.getState()).toMatchObject({ activeId: "source", yKeys: null, stageTab: "worksheet" });
    expect(useApp.getState().history).toEqual([]);
  });

  it("seeds Build figure with only the result's recorded series", async () => {
    const multi = {
      ...output,
      data: { ...output.data, values: [[1, 10], [2, 20]], labels: ["Other", "Result"], units: ["V", "V"] },
    };
    useApp.setState({
      datasets: [source, multi],
      analysisResults: [{ ...result, plotBindings: [{ datasetId: "output", channels: [1] }] }],
    });
    render(<AnalysisResultPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Figures" }));
    fireEvent.click(screen.getByRole("button", { name: "Build figure" }));
    await waitFor(() => expect(useApp.getState().quickFigureBuilderDatasetId).toBe("output"));
    expect(useApp.getState().quickFigureBuilderSeed).toMatchObject({ yKeys: [1], ignoredKeys: [0] });
  });

  it("duplicates the result with a separate linked output and guards repeated clicks", async () => {
    render(<AnalysisResultPanel />);
    const button = screen.getByRole("button", { name: "Duplicate" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(2));
    expect(useApp.getState().datasets).toHaveLength(3);
    expect(useApp.getState().analysisResults[1].outputs[0].datasetId).not.toBe("output");
  });

  it("guards repeated Send to report clicks while the first send is pending", async () => {
    let finish!: (value: boolean) => void;
    sendReport.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<AnalysisResultPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Figures" }));
    const button = screen.getByRole("button", { name: "Send to report…" });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: "Duplicate" })).toBeDisabled());
    fireEvent.click(button);
    expect(sendReport).toHaveBeenCalledTimes(1);
    finish(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Send to report…" })).not.toBeDisabled());
  });

  it("Recalculate runs this result's own recompute, never the project-wide recalcNow", async () => {
    const recalcNow = vi.fn(async () => {});
    useApp.setState({ recalcNow });
    recalculate.mockImplementation(async () => {
      useApp.setState({ status: "recalculated Smooth · Raw trace" });
      return true;
    });
    render(<AnalysisResultPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Recalculate" }));
    await waitFor(() => expect(appState().status).toBe("recalculated Smooth · Raw trace"));
    expect(recalculate).toHaveBeenCalledWith("result");
    expect(recalcNow).not.toHaveBeenCalled();
  });

  it("keeps a broken result inspectable and disables actions that require missing data", () => {
    useApp.setState({ datasets: [], analysisResults: [{ ...result, warnings: ["Saved warning"] }] });
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open worksheet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Recalculate" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: /Diagnostics/ }));
    expect(screen.getByText("Saved warning")).toBeInTheDocument();
    expect(screen.getByText(/Source worksheet source is missing/)).toBeInTheDocument();
  });

  it("presents a source-only peak result with its fitted values and an Edit / Re-fit path", () => {
    useApp.setState({ datasets: [source], activeId: "source", analysisResults: [], openAnalysisResultId: null });
    publishFitResult("source", {
      peaks: [{ center: 31.2, fwhm: 0.18, height: 120, bg: 4, eta: null, area: 23, status: "fitted", model: "Gaussian" }],
      bgCoeffs: [4], R2: 0.998, rmse: 0.2, nPeaks: 1, model: "Gaussian",
    }, "simultaneous", { bgDegree: 0, linkMode: "None", constrain: false, xKey: null, yKey: 0 });
    useApp.setState({ openAnalysisResultId: "analysis-peaks-source", peaksOpen: false });

    render(<AnalysisResultPanel />);
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("1 total · 0 excluded")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recalculate" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    expect(screen.getByRole("columnheader", { name: "Center ± 1σ" })).toBeInTheDocument();
    expect(screen.getByText("31.2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Figures" }));
    expect(screen.getByText(/plot the recorded source curve only/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build source figure" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit / Re-fit…" }));
    expect(useApp.getState()).toMatchObject({ activeId: "source", stageTab: "plot", peaksOpen: true, openAnalysisResultId: null });
  });

  it("keeps statistical interpretation and tables inspectable and flags edited source data", async () => {
    const stat = statisticalTestAnalysisResult(
      "stat", source, "anderson", { ...DEFAULT_SELECTION, x: 0 }, DEFAULT_PARAMS, ["Signal"],
      { sentence: "Signal is consistent with a normal distribution.", tables: [{ title: "Statistics", columns: ["statistic", "value"], rows: [["A²", 0.2]] }] },
      "2026-10-10T00:00:00Z",
    );
    const edited = { ...source, data: { ...source.data, values: [[1], [99]] } };
    useApp.setState({ datasets: [source], analysisResults: [stat], openAnalysisResultId: stat.id });
    exportInline.mockReturnValue(true);
    reportInline.mockResolvedValue(true);

    render(<AnalysisResultPanel />);
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Signal is consistent with a normal distribution.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    expect(screen.getByRole("cell", { name: "A²" })).toBeInTheDocument();
    const exportButton = screen.getByRole("button", { name: "Export all tables…" });
    fireEvent.click(exportButton);
    expect(exportButton).toBeDisabled();
    await waitFor(() => expect(exportButton).toBeEnabled());
    expect(exportInline).toHaveBeenCalledWith("stat");
    expect(screen.getByRole("button", { name: "Send summary to report" }).getAttribute("title")).toMatch(/Adds only the “.+” table/);
    fireEvent.click(screen.getByRole("button", { name: "Send summary to report" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send summary to report" })).toBeEnabled());
    expect(reportInline).toHaveBeenCalledWith("stat");
    useApp.setState({ datasets: [edited] });
    expect(await screen.findByText("Out of date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send summary to report" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: /Diagnostics/ }));
    expect(screen.getByText(/source data changed after this statistical test/)).toBeInTheDocument();
  });

  it("never reads a pending, unfingerprinted, or source-dropped statistical result as Current", () => {
    const stat = statisticalTestAnalysisResult(
      "stat", source, "anderson", { ...DEFAULT_SELECTION, x: 0 }, DEFAULT_PARAMS, ["Signal"],
      { sentence: "s", tables: [{ columns: ["statistic", "value"], rows: [["A²", 0.2]] }] },
    );
    const pending = { ...source, pending: { kind: "path", path: "p", book: "b" } } as unknown as Dataset;
    const { sourceFingerprint: _unused, ...unfingerprinted } = stat;
    const cases: [AnalysisResult, Dataset[], string, boolean, RegExp][] = [
      [{ ...stat, stale: true }, [pending], "Pending", false, /Load the full source worksheet/],
      [unfingerprinted, [source], "Out of date", true, /has no source fingerprint/],
      [{ ...stat, sources: [] }, [source], "Source missing", true, /no longer references its source/],
    ];
    for (const [item, datasets, status, editDisabled, diagnostic] of cases) {
      useApp.setState({ datasets, analysisResults: [item], openAnalysisResultId: item.id });
      const { unmount } = render(<AnalysisResultPanel />);
      expect(screen.getByText(status, { selector: ".qz-analysis-status" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send summary to report" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Edit / rerun…" }).hasAttribute("disabled")).toBe(editDisabled);
      expect(screen.queryByText("No worksheet required")).toBeNull();
      fireEvent.click(screen.getByRole("tab", { name: /Diagnostics/ }));
      expect(screen.getByText(diagnostic)).toBeInTheDocument();
      unmount();
    }
  });

  it("reopens a current statistical result with its exact saved question", () => {
    const stat = statisticalTestAnalysisResult(
      "stat", source, "anderson", { ...DEFAULT_SELECTION, x: 0 }, DEFAULT_PARAMS, ["Signal"],
      { sentence: "Current result.", tables: [{ columns: ["statistic", "value"], rows: [["A²", 0.2]] }] },
    );
    useApp.setState({ datasets: [source], analysisResults: [stat], openAnalysisResultId: stat.id });
    render(<AnalysisResultPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Edit / rerun…" }));
    expect(useStatsTestsStore.getState()).toMatchObject({
      open: true, request: { testId: "anderson", selection: { x: 0 }, params: { alpha: 0.05 } },
    });
    expect(useApp.getState()).toMatchObject({ activeId: "source", openAnalysisResultId: null });
  });

  it("inspects and reopens a current Distribution snapshot with its saved controls", () => {
    const distribution = distributionAnalysisResult(
      "distribution", source,
      { col: 0, byCol: null, fitDist: "none", compareOpen: false, percentileInput: 90 },
      { label: "Signal", byLabel: null, hist: { counts: [1], centers: [1.5], edges: [1, 2] },
        desc: { N: 2, mean: 1.5, median: 1.5, std: 0.5, min: 1, q1: 1.25, q3: 1.75, max: 2 },
        norm: null, normNote: "need ≥ 3 values", levels: [], totalLevels: 0, rankedFits: [],
        rankingMetric: "ks_p", quantiles: null, percentileValue: null, skipped: [] },
    );
    useApp.setState({ datasets: [source], analysisResults: [distribution], openAnalysisResultId: distribution.id, distributionOpen: false });
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Distribution")).toBeInTheDocument();
    expect(screen.queryByText(/Recalculate updates this output/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit / rerun…" }));
    expect(useDistributionRequestStore.getState().request).toEqual({
      col: 0, byCol: null, fitDist: "none", compareOpen: false, percentileInput: 90,
    });
    expect(useApp.getState()).toMatchObject({ activeId: "source", distributionOpen: true, openAnalysisResultId: null });
  });

  it("does not present a lazy Distribution source as verified current", () => {
    const distribution = distributionAnalysisResult(
      "distribution", source,
      { col: 0, byCol: null, fitDist: "none", compareOpen: false, percentileInput: 90 },
      { label: "Signal", byLabel: null, hist: { counts: [1], centers: [1.5], edges: [1, 2] },
        desc: { N: 2, mean: 1.5, median: 1.5, std: 0.5, min: 1, q1: 1.25, q3: 1.75, max: 2 },
        norm: null, normNote: "need ≥ 3 values", levels: [], totalLevels: 0, rankedFits: [],
        rankingMetric: "ks_p", quantiles: null, percentileValue: null, skipped: [] },
    );
    useApp.setState({
      datasets: [{ ...source, pending: { kind: "path", path: "source.opju", bookId: "source", rows: 2, cols: 1 } }],
      analysisResults: [distribution], openAnalysisResultId: distribution.id,
    });
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Pending", { selector: ".qz-analysis-status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send summary to report" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: /Diagnostics/ }));
    expect(screen.getByText(/Load the full source worksheet to verify this distribution analysis/)).toBeInTheDocument();
  });

  it("inspects and reopens a current Fit Y by X snapshot with its saved controls", () => {
    const fitYByX = fitYByXAnalysisResult(
      "fit-y-by-x", source,
      { xCol: -1, yCol: 0, byCol: null, order: 2, bandInterval: "prediction" },
      { mode: "bivariate", xLabel: "Time", yLabel: "Signal", byLabel: null, levels: [], totalLevels: 0,
        bivariate: { x: [0, 1], y: [1, 2], order: 2,
          regression: { N: 2, coeffs: [1, 1, 0], R2: 1, fPvalue: 0 }, band: null } },
    );
    useApp.setState({ datasets: [source], analysisResults: [fitYByX], openAnalysisResultId: fitYByX.id });
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Fit Y by X")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit / rerun…" }));
    expect(useFitYByXStore.getState()).toMatchObject({
      open: true,
      request: { xCol: -1, yCol: 0, byCol: null, order: 2, bandInterval: "prediction" },
    });
    expect(useApp.getState()).toMatchObject({ activeId: "source", openAnalysisResultId: null });
  });

  it("reopens a current Variability snapshot with its exact response and factor columns", () => {
    const variabilitySource: Dataset = {
      ...source,
      data: { ...source.data, values: [[1, 10], [2, 20]], labels: ["Signal", "Batch"], units: ["V", ""] },
    };
    const variability = variabilityAnalysisResult(
      "variability", variabilitySource, { responseCol: 0, factorACol: -1, factorBCol: 1 }, {
        responseLabel: "Signal", factorALabel: "Time", factorBLabel: "Batch", levelLabels: [],
        anova: { table: [], a_levels: 2, b_per_a: [], n_per_cell: [], n_total: 2, grand_mean: 1.5,
          alpha: 0.05, a_tested_against: "Error", b_within_a_estimable: false,
          error_estimable: false, balanced: false },
        summary: { cells: [], a_groups: [], grand_mean: 1.5, grand_n: 2, a_levels: 2, balanced: false },
        varComp: null, varCompNote: "not estimable",
      },
    );
    useApp.setState({ datasets: [variabilitySource], analysisResults: [variability], openAnalysisResultId: variability.id });
    render(<AnalysisResultPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Edit / rerun…" }));
    expect(useVariabilityStore.getState()).toMatchObject({
      open: true, request: { responseCol: 0, factorACol: -1, factorBCol: 1 },
    });
    expect(useApp.getState()).toMatchObject({ activeId: "source", openAnalysisResultId: null });
  });

  it("presents a saved curve fit with live status, recipe controls, and re-fit setup", async () => {
    const fitted = {
      ...source,
      fitSpec: {
        model: "Linear", xKey: null, yKey: 0, params: [2, 1], errors: [0.1, 0.2],
        R2: 0.99, nPoints: 2, fittedAt: "2026-10-09T00:00:00Z",
      },
    } satisfies Dataset;
    const fitResult = fitAnalysisResult(fitted, fitted.fitSpec);
    useApp.setState({
      datasets: [fitted], analysisResults: [fitResult], openAnalysisResultId: fitResult.id,
      staleFits: ["source"], curveFitOpen: false,
    });
    recalculateFit.mockImplementation(async () => {
      useApp.setState({ staleFits: [] });
      return true;
    });
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Out of date")).toBeInTheDocument();
    expect(screen.getByText("Linear")).toBeInTheDocument();
    expect(screen.getByText("0.99")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recalculate" }));
    await waitFor(() => expect(screen.getByText("Current")).toBeInTheDocument());
    expect(recalculateFit).toHaveBeenCalledWith(fitResult.id);
    fireEvent.click(screen.getByRole("button", { name: "Edit / Re-fit…" }));
    expect(useApp.getState()).toMatchObject({
      activeId: "source", stageTab: "plot", xKey: null, yKeys: [0], curveFitOpen: true, openAnalysisResultId: null,
    });
  });

  it("shows live fit warnings once rather than repeating envelope snapshots", () => {
    const fitted = {
      ...source, fitSpec: { model: "Linear", xKey: null, yKey: 0, exitFlag: 0 },
    } satisfies Dataset;
    const fitResult = fitAnalysisResult(fitted, fitted.fitSpec);
    useApp.setState({ datasets: [fitted], analysisResults: [fitResult], openAnalysisResultId: fitResult.id });
    render(<AnalysisResultPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Diagnostics (2)" }));
    expect(screen.getAllByText("The optimizer did not report convergence.")).toHaveLength(1);
    expect(screen.getAllByText("This legacy fit does not include fitted parameter values.")).toHaveLength(1);
  });

  it("detects edited fit data as out of date even when automatic recalculation is off", () => {
    const fitted = {
      ...source, fitSpec: { model: "Linear", xKey: null, yKey: 0, params: [2, 1] },
    } satisfies Dataset;
    const fitResult = fitAnalysisResult(fitted, fitted.fitSpec);
    const edited = { ...fitted, data: { ...fitted.data, values: [[1], [99]] } };
    useApp.setState({
      datasets: [edited], analysisResults: [fitResult], openAnalysisResultId: fitResult.id,
      staleFits: [], recalcMode: "off",
    });
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Out of date")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Diagnostics (1)" }));
    expect(screen.getByText("The source data changed after this fit. Recalculate or re-fit before using these values.")).toBeInTheDocument();
  });

  it("does not judge a lazy Origin preview stale before its worksheet loads", () => {
    const fitted = {
      ...source, fitSpec: { model: "Linear", xKey: null, yKey: 0, params: [2, 1] },
    } satisfies Dataset;
    const fitResult = fitAnalysisResult(fitted, fitted.fitSpec);
    const pending: Dataset = {
      ...fitted,
      pending: { kind: "path", path: "/source.opju", bookId: "Book1", rows: 2, cols: 1 },
      data: { ...fitted.data, values: [[99], [100]] },
    };
    useApp.setState({ datasets: [pending], analysisResults: [fitResult], openAnalysisResultId: fitResult.id, staleFits: [] });
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("keeps source-figure editing available but disables fitted output when the fit is missing", () => {
    const fitted = { ...source, fitSpec: { model: "Linear", xKey: null, yKey: 0, params: [2, 1] } } satisfies Dataset;
    const fitResult = fitAnalysisResult(fitted, fitted.fitSpec);
    useApp.setState({
      datasets: [source], analysisResults: [fitResult], openAnalysisResultId: fitResult.id,
    });
    render(<AnalysisResultPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Figures" }));
    expect(screen.getByRole("button", { name: "Open fitted plot" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Build source figure" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Send fitted plot to report…" })).toBeDisabled();
  });

  it("requires Edit / Re-fit when a legacy recipe has no exact channel bindings", () => {
    const fitted = { ...source, fitSpec: { model: "Linear", params: [2, 1] } } satisfies Dataset;
    const fitResult = fitAnalysisResult(fitted, fitted.fitSpec);
    useApp.setState({ datasets: [fitted], analysisResults: [fitResult], openAnalysisResultId: fitResult.id });
    render(<AnalysisResultPanel />);
    expect(screen.getByRole("button", { name: "Recalculate" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit / Re-fit…" })).toBeEnabled();
    fireEvent.click(screen.getByRole("tab", { name: "Diagnostics (1)" }));
    expect(screen.getByText("The fitted X axis is not recorded unambiguously.")).toBeInTheDocument();
  });
});
