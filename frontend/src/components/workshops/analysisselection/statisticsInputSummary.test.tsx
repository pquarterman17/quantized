// The statistics tools (Fit Y by X, Multivariate, Variability, Statistical
// tests, Test chooser) state their input and row policy through the shared
// summary, and fail closed on a lazy Origin preview (lib/analysisInputs).

import type { ReactNode } from "react";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData, statsAnova, statsCorrelation, statsNestedAnova, statsRecommend, statsRegression } from "../../../lib/api";
import { runStatsTest } from "../../../lib/api/statsTests";
import { resetBookTransportForTests } from "../../../lib/bookData";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import FitYByXPanel from "../fityx/FitYByXPanel";
import MultivarPanel from "../multivar/MultivarPanel";
import StatsChooserPanel from "../statschooser/StatsChooserPanel";
import StatsTestsPanel from "../statstests/StatsTestsPanel";
import { useStatsTests } from "../statstests/useStatsTests";
import VariabilityChartPanel from "../variability/VariabilityChartPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsRegression: vi.fn(() => new Promise(() => {})),
  statsAnova: vi.fn(() => new Promise(() => {})),
  statsCorrelation: vi.fn(() => new Promise(() => {})),
  statsPCA: vi.fn(() => new Promise(() => {})),
  statsNestedAnova: vi.fn(() => new Promise(() => {})),
  statsVariabilitySummary: vi.fn(() => new Promise(() => {})),
  statsRecommend: vi.fn(() => new Promise(() => {})),
  fetchBookData: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));

const SHEET: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [0, 1, 2, 3],
    values: [[10, 1], [20, 2], [30, 3], [40, 4]],
    labels: ["v", "w"],
    units: ["V", "A"],
    metadata: { x_column_name: "T" },
  },
  excludedRows: [1],
};
const LAZY: Dataset = { ...SHEET, pending: { kind: "upload", bookId: "b1", rows: 400, cols: 2, previewSampled: true } };

const PANELS: [string, () => ReactNode][] = [
  ["Fit Y by X", () => <FitYByXPanel />],
  ["Multivariate", () => <MultivarPanel />],
  ["Variability chart", () => <VariabilityChartPanel />],
  ["Statistical tests", () => <StatsTestsPanel />],
  ["Test chooser", () => <StatsChooserPanel />],
];

beforeEach(() => {
  resetBookTransportForTests();
  vi.clearAllMocks();
  useApp.setState({
    datasets: [SHEET], activeId: "d1", selection: null, status: "", reports: [],
    analysisResults: [], history: [], future: [],
  });
});

describe("statistics tools show the shared summary", () => {
  it.each(PANELS)("%s states its input and the analysis-view row policy", (_name, panel) => {
    render(panel());
    const line = screen.getByLabelText("Analysis input");
    expect(line).toHaveTextContent("Input: run.dat");
    expect(line).toHaveTextContent("3 of 4 rows");
    expect(line).toHaveTextContent("Excluded and filtered-out rows are left out (1 excluded row, 0 filtered-out rows). Selected rows are not used. The plot X range is not applied.");
    expect(line).not.toHaveClass("blocked");
  });

  it("Statistical tests shows no summary for the data-free power test", () => {
    const { result } = renderHook(() => useStatsTests());
    act(() => result.current.setTestId("power"));
    expect(result.current.inputs).toBeNull();
  });

  it("a lazy Origin preview is refused by every tool: nothing is computed and the full load is requested", async () => {
    useApp.setState({ datasets: [LAZY] });
    render(<>{PANELS.map(([name, panel]) => <div key={name}>{panel()}</div>)}</>);
    const lines = screen.getAllByLabelText("Analysis input");
    expect(lines).toHaveLength(PANELS.length);
    for (const line of lines) expect(line).toHaveAttribute("data-refusal", "pending");
    await waitFor(() => expect(vi.mocked(fetchBookData).mock.calls.length).toBeGreaterThan(0));
    for (const fn of [statsRegression, statsAnova, statsCorrelation, statsNestedAnova, statsRecommend, runStatsTest]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe("a failed lazy load", () => {
  it("is a distinct refusal that names the reason and is not analysed", async () => {
    useApp.setState({ datasets: [LAZY] });
    vi.mocked(fetchBookData).mockRejectedValueOnce(new Error("source moved"));
    render(<FitYByXPanel />);
    const line = screen.getByLabelText("Analysis input");
    await waitFor(() => expect(line).toHaveAttribute("data-refusal", "load-failed"));
    expect(line).toHaveTextContent("could not be loaded (source moved)");
    expect(line).toHaveClass("blocked");
    expect(statsRegression).not.toHaveBeenCalled();
  });

  it("clears when the book is replaced by a loaded one", async () => {
    useApp.setState({ datasets: [LAZY] });
    vi.mocked(fetchBookData).mockRejectedValueOnce(new Error("source moved"));
    render(<FitYByXPanel />);
    const line = screen.getByLabelText("Analysis input");
    await waitFor(() => expect(line).toHaveAttribute("data-refusal", "load-failed"));
    act(() => useApp.setState({ datasets: [SHEET] }));
    expect(line).not.toHaveAttribute("data-refusal");
  });
});

describe("Statistical tests Run resolves the contract on the loaded worksheet", () => {
  it("refuses with the resolver's reason when the picked column no longer exists", async () => {
    const { result } = renderHook(() => useStatsTests());
    act(() => result.current.setSel({ x: 7 }));
    await act(async () => { await result.current.run(); });
    expect(result.current.error).toBe("A selected response column no longer exists.");
    expect(runStatsTest).not.toHaveBeenCalled();
  });

  it("a lazy preview is loaded first and the test runs on the full analysis view", async () => {
    useApp.setState({ datasets: [LAZY] });
    const FULL = { ...SHEET.data, time: [0, 1, 2, 3, 4], values: [[10, 1], [20, 2], [30, 3], [40, 4], [50, 5]] };
    vi.mocked(fetchBookData).mockResolvedValueOnce(FULL);
    vi.mocked(runStatsTest).mockResolvedValueOnce({} as never);
    const { result } = renderHook(() => useStatsTests());
    await act(async () => { await result.current.run(); });
    expect(vi.mocked(runStatsTest).mock.calls.at(-1)![0]).toMatchObject({ id: "anderson", body: { x: [10, 20, 30, 40, 50] } });
  });
});
