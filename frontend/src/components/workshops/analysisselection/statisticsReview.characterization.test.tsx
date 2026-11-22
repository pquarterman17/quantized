// Characterization of the seven own-pick statistics tools' input line, pinned
// BEFORE the "Review inputs" card was added around it: each panel shows ONE
// shared input line (aria-label "Analysis input") with the default picks below.
// The Review inputs card keeps this line and these defaults; it only adds the
// tool's own picks and settings next to it.

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const PANELS: [string, () => ReactNode, string][] = [
  ["Distribution", () => <DistributionPanel />, "Input: run.dat · Y: v (V) · 7 of 8 rows"],
  ["Outlier screening", () => <OutlierScreeningPanel />, "Input: run.dat · Y: v (V) · 7 of 8 rows"],
  ["Fit Y by X", () => <FitYByXPanel />, "Input: run.dat · X: v (V) · Y: w (A) · 7 of 8 rows"],
  ["Multivariate", () => <MultivarPanel />, "Input: run.dat · Y: v (V), w (A) · 7 of 8 rows"],
  ["Variability chart", () => <VariabilityChartPanel />, "Input: run.dat · Y: w (A), v (V), v (V) · 7 of 8 rows"],
  ["Statistical tests", () => <StatsTestsPanel />, "Input: run.dat · Y: v (V) · 7 of 8 rows"],
  ["Test chooser", () => <StatsChooserPanel />, "Input: run.dat · Y: v (V) · 7 of 8 rows"],
];

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [SHEET], activeId: "d1", selectedIds: [], xKey: null, yKeys: [0], seriesOrder: null,
    selection: { datasetId: "d1", rows: [0, 2] },
    status: "", reports: [], analysisResults: [], history: [], future: [],
  });
});

describe("statistics tools input line today (characterization)", () => {
  it.each(PANELS)("%s shows one shared input line with its default picks", (_name, panel, summary) => {
    render(panel());
    const line = screen.getByLabelText("Analysis input");
    expect(line.firstElementChild?.textContent).toBe(summary);
    expect(line).not.toHaveAttribute("data-refusal");
  });
});
