import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData, statsGrubbs, statsHistogram } from "../../../lib/api";
import { resolveAnalysisInputs, ROW_POLICY } from "../../../lib/analysisInputs";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import DistributionPanel from "../distribution/DistributionPanel";
import OutlierScreeningPanel from "../outliers/OutlierScreeningPanel";
import AnalysisInputSummary from "./AnalysisInputSummary";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsHistogram: vi.fn(() => new Promise(() => {})),
  statsShapiro: vi.fn(() => new Promise(() => {})),
  statsFitDistributions: vi.fn(() => new Promise(() => {})),
  statsGrubbs: vi.fn(() => new Promise(() => {})),
  fetchBookData: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../../lib/api/statsDescriptive", () => ({ statsDescriptive: vi.fn(() => new Promise(() => {})) }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));

const SHEET: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [0, 1, 2, 3],
    values: [[10], [20], [30], [40]],
    labels: ["v"],
    units: ["V"],
    metadata: { x_column_name: "T" },
  },
  excludedRows: [1],
};
const LAZY: Dataset = { ...SHEET, pending: { kind: "upload", bookId: "b1", rows: 400, cols: 1, previewSampled: true } };

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [SHEET], activeId: "d1", selection: null, status: "", reports: [],
    analysisResults: [], history: [], future: [],
  });
});

describe("AnalysisInputSummary", () => {
  it("renders the input line and the explicit row policy", () => {
    render(<AnalysisInputSummary inputs={resolveAnalysisInputs({ datasets: [SHEET], activeId: "d1", yKeys: [0], policy: ROW_POLICY.analysisView })} />);
    const line = screen.getByLabelText("Analysis input");
    expect(line).toHaveTextContent("Input: run.dat · X: T · Y: v (V) · 3 of 4 rows");
    expect(line).toHaveTextContent("Excluded and filtered-out rows are left out (1 excluded row, 0 filtered-out rows). Selected rows are not used.");
    expect(line).not.toHaveClass("blocked");
  });

  it("omits X when the tool declares it has none, and keeps it otherwise", () => {
    const base = { datasets: [SHEET], activeId: "d1", yKeys: [0], policy: ROW_POLICY.analysisView };
    const { rerender } = render(<AnalysisInputSummary inputs={resolveAnalysisInputs({ ...base, noX: true })} />);
    expect(screen.getByLabelText("Analysis input")).toHaveTextContent(/^Input: run\.dat · Y: v \(V\) · 3 of 4 rows/);
    rerender(<AnalysisInputSummary inputs={resolveAnalysisInputs(base)} />);
    expect(screen.getByLabelText("Analysis input")).toHaveTextContent("Input: run.dat · X: T · Y: v (V)");
  });

  it("renders a refusal as its reason, marked blocked", () => {
    render(<AnalysisInputSummary inputs={resolveAnalysisInputs({ datasets: [], activeId: null, yKeys: [0], policy: ROW_POLICY.analysisView })} />);
    const line = screen.getByLabelText("Analysis input");
    expect(line).toHaveTextContent("Input: none · No worksheet is selected.");
    expect(line).toHaveClass("blocked");
    expect(line).toHaveAttribute("data-refusal", "no-dataset");
  });
});

describe("migrated tools show the shared summary", () => {
  it("Distribution states its input and policy", () => {
    render(<DistributionPanel />);
    // Distribution has no X axis, so the line omits "X:" (deliberate change).
    const line = screen.getByLabelText("Analysis input");
    expect(line).toHaveTextContent("Input: run.dat · Y: v (V) · 3 of 4 rows");
    expect(line).not.toHaveTextContent("X: T");
  });

  it("Outlier screening states its input and policy", () => {
    render(<OutlierScreeningPanel />);
    expect(screen.getByLabelText("Analysis input")).toHaveTextContent("Selected rows are not used. The plot X range is not applied.");
  });

  it("a lazy Origin preview is refused (not profiled or screened) and its full load is requested", async () => {
    useApp.setState({ datasets: [LAZY] });
    render(<><DistributionPanel /><OutlierScreeningPanel /></>);
    for (const line of screen.getAllByLabelText("Analysis input")) {
      expect(line).toHaveAttribute("data-refusal", "pending");
    }
    await waitFor(() => expect(vi.mocked(fetchBookData).mock.calls.length).toBeGreaterThan(0));
    expect(statsHistogram).not.toHaveBeenCalled();
    expect(statsGrubbs).not.toHaveBeenCalled();
  });
});
