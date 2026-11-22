// The own-pick statistics tools (Distribution, Outlier screening, Fit Y by X,
// Multivariate, Variability, Statistical tests, Test chooser) carry a "Review
// inputs" card: the shared input line + row-policy note, then the tool's own
// picks and settings AS THE NEXT RUN WILL READ THEM. A refusal (lazy preview,
// failed load, a pick not made) shows its reason and is never guessed over.

import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData } from "../../../lib/api";
import { resetBookTransportForTests } from "../../../lib/bookData";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import DistributionPanel from "../distribution/DistributionPanel";
import FitYByXPanel from "../fityx/FitYByXPanel";
import MultivarPanel from "../multivar/MultivarPanel";
import OutlierScreeningPanel from "../outliers/OutlierScreeningPanel";
import StatsChooserPanel from "../statschooser/StatsChooserPanel";
import StatsTestsPanel from "../statstests/StatsTestsPanel";
import VariabilityChartPanel from "../variability/VariabilityChartPanel";

vi.mock("../../../lib/api", async (importOriginal) => {
  const never = () => vi.fn(() => new Promise(() => {}));
  return {
    ...(await importOriginal<typeof import("../../../lib/api")>()),
    statsHistogram: never(), statsShapiro: never(), statsFitDistributions: never(), statsGrubbs: never(),
    statsRosner: never(), statsDixonQ: never(), statsMadOutliers: never(),
    statsRegression: never(), statsAnova: never(), statsCorrelation: never(), statsPCA: never(),
    statsNestedAnova: never(), statsVarianceComponents: never(), statsVariabilitySummary: never(), statsRecommend: never(),
    fetchBookData: never(),
  };
});
vi.mock("../../../lib/api/statsDescriptive", () => ({ statsDescriptive: vi.fn(() => new Promise(() => {})) }));
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
    time: [0, 1, 2, 3, 4, 5, 6, 7],
    values: [[10, 1], [20, 2], [30, 3], [40, 4], [50, 5], [60, 6], [70, 7], [80, 8]],
    labels: ["v", "w"], units: ["V", "A"],
    metadata: { x_column_name: "T" },
  },
  excludedRows: [1],
};
const LAZY: Dataset = { ...SHEET, pending: { kind: "upload", bookId: "b1", rows: 400, cols: 2, previewSampled: true } };

const card = () => screen.getByRole("region", { name: "Review analysis inputs" });
/** The card's picks/settings as { label: value }. */
function rows(): Record<string, string> {
  const list = within(card()).getByLabelText("Tool picks and settings");
  return Object.fromEntries([...list.querySelectorAll("div")].map((row) => [row.querySelector("dt")!.textContent!, row.querySelector("dd")!.textContent!]));
}
const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  resetBookTransportForTests();
  vi.clearAllMocks();
  useApp.setState({
    datasets: [SHEET], activeId: "d1", selectedIds: [], selection: null, status: "", reports: [],
    analysisResults: [], history: [], future: [],
  });
});

describe("every own-pick statistics tool has the Review inputs card", () => {
  const PANELS: [string, () => ReactNode][] = [
    ["Distribution", () => <DistributionPanel />],
    ["Outlier screening", () => <OutlierScreeningPanel />],
    ["Fit Y by X", () => <FitYByXPanel />],
    ["Multivariate", () => <MultivarPanel />],
    ["Variability chart", () => <VariabilityChartPanel />],
    ["Statistical tests", () => <StatsTestsPanel />],
    ["Test chooser", () => <StatsChooserPanel />],
  ];

  it.each(PANELS)("%s shows the shared line, policy note and its own picks", (_name, panel) => {
    render(panel());
    const line = within(card()).getByLabelText("Analysis input");
    expect(line).toHaveTextContent("Input: run.dat");
    expect(line).toHaveTextContent("7 of 8 rows");
    expect(line).toHaveTextContent("Excluded and filtered-out rows are left out (1 excluded row, 0 filtered-out rows). Selected rows are not used. The plot X range is not applied.");
    expect(Object.keys(rows()).length).toBeGreaterThan(1);
  });

  it.each(PANELS)("%s collapses and reopens the card", (_name, panel) => {
    render(panel());
    fireEvent.click(within(card()).getByRole("button", { name: /Review inputs/ }));
    expect(screen.queryByLabelText("Analysis input")).toBeNull();
    fireEvent.click(within(card()).getByRole("button", { name: /Review inputs/ }));
    expect(screen.getByLabelText("Analysis input")).toBeInTheDocument();
  });

  it.each(PANELS)("%s refuses a lazy Origin preview in the card and requests the full load", async (_name, panel) => {
    useApp.setState({ datasets: [LAZY] });
    render(panel());
    expect(within(card()).getByLabelText("Analysis input")).toHaveAttribute("data-refusal", "pending");
    expect(within(card()).getByRole("button", { name: /Review inputs/ })).toHaveTextContent("blocked");
    await waitFor(() => expect(vi.mocked(fetchBookData).mock.calls.length).toBeGreaterThan(0));
  });

  it.each(PANELS)("%s shows a failed lazy load as its own refusal with the reason", async (_name, panel) => {
    useApp.setState({ datasets: [LAZY] });
    vi.mocked(fetchBookData).mockRejectedValueOnce(new Error("source moved"));
    render(panel());
    const line = within(card()).getByLabelText("Analysis input");
    await waitFor(() => expect(line).toHaveAttribute("data-refusal", "load-failed"));
    expect(line).toHaveTextContent("could not be loaded (source moved)");
  });
});

describe("the card reflects each tool's own picks and settings", () => {
  it("Distribution: column, By and fit follow the panel", () => {
    render(<DistributionPanel />);
    expect(rows()).toEqual({ Column: "v (V)", By: "none", "Fitted distribution": "none" });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "1" } });
    expect(rows().Column).toBe("w (A)");
    expect(within(card()).getByLabelText("Analysis input")).toHaveTextContent("Y: w (A)");
  });

  it("Outlier screening: only the settings the method reads", () => {
    render(<OutlierScreeningPanel />);
    expect(rows()).toEqual({ Column: "v (V)", Method: "grubbs", Alpha: "0.05" });
    pick("Method", "rosner");
    expect(rows()).toEqual({ Column: "v (V)", Method: "rosner", Alpha: "0.05", "Max outliers (k)": "2" });
    pick("Method", "mad");
    expect(rows()).toEqual({ Column: "v (V)", Method: "mad", Threshold: "3.5" });
    pick("Channel", "1");
    expect(rows().Column).toBe("w (A)");
  });

  it("Fit Y by X: X and Y picks, order and band", () => {
    render(<FitYByXPanel />);
    expect(rows()).toMatchObject({ "X (factor)": "v (V)", "Y (response)": "w (A)", "Polynomial order": "1", Band: "confidence", By: "none" });
    pick("Y (response)", "0");
    expect(rows()["Y (response)"]).toBe("v (V)");
    expect(within(card()).getByLabelText("Analysis input")).toHaveTextContent("Y: v (V)");
  });

  it("Multivariate: the picked columns, correlation method and standardize", () => {
    render(<MultivarPanel />);
    expect(rows()).toEqual({ Columns: "v (V), w (A)", Correlation: "pearson", "PCA standardize": "off" });
    fireEvent.click(screen.getByRole("checkbox", { name: "w" }));
    expect(rows().Columns).toBe("v (V)");
    expect(within(card()).getByLabelText("Analysis input")).toHaveTextContent("Y: v (V) ·");
  });

  it("Multivariate: no column picked is a refusal, not a guess", () => {
    render(<MultivarPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "w" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "v" }));
    expect(rows().Columns).toBe("not picked");
    expect(within(card()).getByLabelText("Analysis input")).toHaveAttribute("data-refusal", "no-response");
    expect(card()).toHaveTextContent("No response column is selected.");
  });

  it("Variability: response and both factors", () => {
    render(<VariabilityChartPanel />);
    pick("Response (Y)", "1");
    pick("Factor A (outer)", "0");
    expect(rows()).toEqual({ "Response (Y)": "w (A)", "Factor A (outer)": "v (V)", "Factor B (nested in A)": "v (V)" });
  });

  it("Statistical tests: roles follow the picked test; settings only when the test reads them", () => {
    render(<StatsTestsPanel />);
    expect(rows()).toEqual({ Test: "Anderson-Darling", Column: "v (V)" });
    pick("Test", "ks-two-sample");
    expect(rows()).toEqual({ Test: "Two-sample Kolmogorov-Smirnov", "First column": "v (V)", "Second column": "w (A)", Alpha: "0.05" });
    pick("Test", "dunnett");
    expect(rows()).toMatchObject({ "Group columns (first is control)": "v (V), w (A)", Alternative: "two-sided" });
    pick("Test", "stepwise");
    expect(rows()).toMatchObject({ Response: "v (V)", Criterion: "AIC", Direction: "forward" });
    expect(rows()).not.toHaveProperty("Alpha");
  });

  it("Statistical tests: a group test with no columns picked says so and the line refuses", () => {
    render(<StatsTestsPanel />);
    pick("Test", "friedman");
    fireEvent.click(screen.getByRole("checkbox", { name: "v" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "w" }));
    expect(rows().Columns).toBe("not picked");
    expect(within(card()).getByLabelText("Analysis input")).toHaveAttribute("data-refusal", "no-response");
  });

  it("Statistical tests: the data-free power test states that it reads no worksheet data", () => {
    render(<StatsTestsPanel />);
    pick("Test", "power");
    expect(screen.queryByLabelText("Analysis input")).toBeNull();
    expect(screen.getByTestId("review-no-data")).toHaveTextContent("reads no worksheet data");
    expect(rows()).toMatchObject({ Test: "t-test power / sample size", "Effect size d": "0.5", n: "solve" });
  });

  it("Test chooser: columns mode, then value-by-category with paired off", () => {
    render(<StatsChooserPanel />);
    expect(rows()).toEqual({ "Group columns": "v (V)", Paired: "off" });
    fireEvent.click(screen.getByRole("checkbox", { name: "w" }));
    expect(rows()["Group columns"]).toBe("v (V), w (A)");
    fireEvent.click(screen.getByRole("radio", { name: "Value by category" }));
    expect(rows()).toMatchObject({ Value: expect.any(String), "Groups by": expect.any(String), Paired: "off" });
    expect(Object.keys(rows())).not.toContain("Group columns");
  });

  it("a worksheet change re-reads the card (no stale picks from the previous sheet)", () => {
    render(<MultivarPanel />);
    const other: Dataset = { ...SHEET, id: "d2", name: "other.dat", data: { ...SHEET.data, labels: ["p", "q"] } };
    act(() => useApp.setState({ datasets: [SHEET, other], activeId: "d2" }));
    expect(within(card()).getByLabelText("Analysis input")).toHaveTextContent("Input: other.dat");
    expect(rows().Columns).toBe("p (V), q (A)");
  });
});
