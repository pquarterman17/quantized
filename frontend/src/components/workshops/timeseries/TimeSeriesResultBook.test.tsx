// Time series as a saved result (owner decision 2026-11-25): Run -> Save
// result -> the book's Copy / Send to report / Open as worksheet act on the
// saved result; a data change makes the shown run stale; a Library reopen
// restores the tool, channel and options.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ tsCorrelogram: vi.fn(), tsStationarity: vi.fn(), tsDecompose: vi.fn(), tsChangepoint: vi.fn(), tsArima: vi.fn() }));
vi.mock("../../../lib/api/timeseries", () => api);
vi.mock("../SmallUPlot", () => ({ default: ({ label }: { label: string }) => <div data-testid="plot">{label}</div> }));
const { reportInline, copyTextMock, sent } = vi.hoisted(() => ({ reportInline: vi.fn(), copyTextMock: vi.fn(), sent: [] as [string, number][] }));
vi.mock("../../../store/analysisResultActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../store/analysisResultActions")>()),
  sendAnalysisInlineTableToReport: reportInline,
}));
vi.mock("../../../lib/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/clipboard")>()), copyText: copyTextMock,
}));

import { TIME_SERIES_RESULT } from "../../../lib/toolResultKinds";
import { tsSnapshot, tsSource } from "../../../lib/toolResultKinds.testkit";
import { useToolResultRequest } from "../../../store/toolResultRequest";
import { useApp } from "../../../store/useApp";
import TimeSeriesPanel from "./TimeSeriesPanel";

const correlogram = tsSnapshot().run.data;

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
  reportInline.mockImplementation(async (id: string, index: number) => { sent.push([id, index]); return true; });
  copyTextMock.mockResolvedValue(true);
  useToolResultRequest.setState({ timeSeries: null, doe: null, profiler: null });
  useApp.setState({
    datasets: [tsSource], activeId: tsSource.id, status: "", analysisResults: [], history: [], future: [],
    staleDatasets: [], staleFits: [], recalcMode: "manual", stageTab: "plot",
  });
  api.tsCorrelogram.mockResolvedValue(correlogram);
  api.tsStationarity.mockResolvedValue({ dt: 1, irregular: false, alpha: 0.05, verdict: "stationary",
    adf: { test: "adf", regression: "ct", statistic: -4.2, p_value: 0.001, p_bound: "interpolated", lags: 1, n: 23, critical_values: { "5%": -3.5 }, null: "unit root" } });
});

async function runAndSave() {
  render(<TimeSeriesPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await screen.findByText("lag 2");
  expect(screen.getByRole("button", { name: "Send to report: Correlogram" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save result" }));
  await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(1));
  return useApp.getState().analysisResults[0]!;
}

describe("Time series result book", () => {
  it("saves one result per run with its tables, provenance and algorithm version, once", async () => {
    const saved = await runAndSave();
    expect(saved).toMatchObject({
      producer: { id: TIME_SERIES_RESULT, version: 1 }, sources: [{ datasetId: "log" }], outputs: [],
      parameters: { recipe: { tool: "correlogram", col: 0, allowIrregular: false, options: { nlags: 0, alpha: 0.05 } },
        algorithm: { id: "time-series-correlogram", version: 1 }, inputs: { items: [{ datasetId: "log", includedRows: 24 }] } },
    });
    expect(saved.tables!.map((t) => t.title)).toEqual(["Correlogram", "Ljung–Box"]);
    expect(screen.getByRole("button", { name: "Save result" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save result" })).toHaveAttribute("title", "This time-series result is already saved.");
    // The existing worksheet commit is unchanged and still separate.
    expect(screen.getByRole("button", { name: "Add as worksheet" })).toBeEnabled();
  });

  it("offers Copy table, Send to report and Open as worksheet on the saved result", async () => {
    const saved = await runAndSave();
    fireEvent.click(screen.getByRole("button", { name: "Copy table: Ljung–Box" }));
    await waitFor(() => expect(useApp.getState().status).toMatch(/^copied /));
    expect(copyTextMock).toHaveBeenCalledWith(expect.stringContaining("9.5"));
    fireEvent.click(screen.getByRole("button", { name: "Send to report: Ljung–Box" }));
    await waitFor(() => expect(sent).toEqual([[saved.id, 1]]));
    fireEvent.click(screen.getByRole("button", { name: "Open as worksheet: Correlogram" }));
    await waitFor(() => expect(useApp.getState().datasets.some((d) => d.name.endsWith("Correlogram (frozen)"))).toBe(true));
  });

  it("no longer matches the saved result once the source changes (Save works again on a rerun)", async () => {
    await runAndSave();
    act(() => useApp.setState({ datasets: [{ ...tsSource, data: { ...tsSource.data, values: tsSource.data.values.map((r) => [r[0]! + 1, r[1]!]) } }] }));
    expect(await screen.findByText(/changed since the last run/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText("lag 2");
    expect(screen.getByRole("button", { name: "Save result" })).toBeEnabled();
  });

  it("restores the tool, channel and options from a Library reopen", async () => {
    act(() => useToolResultRequest.getState().request({ timeSeries: {
      tool: "stationarity", col: 0, allowIrregular: true, options: { tests: "adf", regression: "ct", alpha: 0.01, bogus: 3 },
    } }));
    render(<TimeSeriesPanel />);
    await waitFor(() => expect(useToolResultRequest.getState().timeSeries).toBeNull());
    expect(screen.getByRole("radio", { name: "Stationarity" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText("stationary");
    expect(api.tsStationarity).toHaveBeenCalledWith(expect.objectContaining({ tests: "adf", regression: "ct", alpha: 0.01, allow_irregular: true }));
    expect(api.tsStationarity.mock.calls[0]![0]).not.toHaveProperty("bogus");
  });
});
