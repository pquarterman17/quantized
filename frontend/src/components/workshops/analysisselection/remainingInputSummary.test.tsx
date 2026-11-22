// Surface fit, Ellipse fit, Peak wizard, Tabulate, Pie and Ternary state their
// input and the row policy they already had (the analysis view) through the
// shared summary. Their data paths are unchanged
// (inputContract.remaining.characterization.test.tsx).
//
// Fixture: row 1 manually excluded, row 5 filtered out -> 4 of 6 rows.

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import EllipseFitPanel from "../implicitfit/EllipseFitPanel";
import PeakWizardPanel from "../peakwizard/PeakWizardPanel";
import PiePanel from "../pie/PiePanel";
import SurfaceFitPanel from "../surfacefit/SurfaceFitPanel";
import TabulatePanel from "../tabulate/TabulatePanel";
import TernaryPanel from "../ternary/TernaryPanel";

vi.mock("../../../lib/api/analysisExtras", () => ({
  surfaceModels: vi.fn().mockResolvedValue([]), surfaceGuess: vi.fn(), surfaceFit: vi.fn(), ellipseFit: vi.fn(),
}));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));
vi.mock("../ternary/AuxFigureFrame", () => ({ default: () => <div /> }));
vi.mock("../peakwizard/steps", () => ({
  StepFindPeaks: () => <div />, StepFitReview: () => <div />, StepModel: () => <div />, StepRangeBaseline: () => <div />, StepReport: () => <div />,
}));
vi.mock("../peakwizard/PeakBatchView", () => ({ default: () => <div /> }));
vi.mock("../peakwizard/PeakWizardByLevel", () => ({ default: () => <div /> }));

const SHEET: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [1, 2, 3, 4, 5, 6],
    values: [[0.2, 0.3, 0.5], [0.1, 0.2, 0.7], [0.4, 0.4, 0.2], [0.3, 0.3, 0.4], [0.6, 0.2, 0.2], [0.2, 0.2, 0.6]],
    labels: ["a", "b", "c"],
    units: ["", "", ""],
    metadata: { x_column_name: "t", x_column_unit: "s" },
  },
  excludedRows: [1],
  filter: [{ col: -1, kind: "range", max: 5.5 }],
};

const line = () => screen.getByLabelText("Analysis input");
const POLICY = "Excluded and filtered-out rows are left out (1 excluded row, 1 filtered-out row).";

beforeEach(() => {
  useApp.setState({ datasets: [SHEET], activeId: "d1", status: "", xKey: null, yKeys: null, seriesOrder: null, selection: null });
});

describe("remaining general tools show the shared summary", () => {
  it("Surface fit: X axis and the next two channels, analysis view", () => {
    render(<SurfaceFitPanel />);
    expect(line()).toHaveTextContent("Input: run.dat · X: t (s) · Y: a, b · 4 of 6 rows");
    expect(line()).toHaveTextContent(POLICY);
  });

  it("Ellipse fit: X axis against the first channel, analysis view", () => {
    render(<EllipseFitPanel />);
    expect(line()).toHaveTextContent("Input: run.dat · X: t (s) · Y: a · 4 of 6 rows");
    expect(line()).toHaveTextContent(POLICY);
  });

  it("Peak wizard: the plotted channel over the analysis view", () => {
    render(<PeakWizardPanel />);
    expect(line()).toHaveTextContent("Input: run.dat · X: t (s) · Y: a · 4 of 6 rows");
    expect(line()).toHaveTextContent(POLICY);
  });

  it("Tabulate: no X; the grouped and summarised columns, analysis view", () => {
    render(<TabulatePanel />);
    expect(line()).toHaveTextContent("Input: run.dat · Y: a, b · 4 of 6 rows");
    expect(line()).not.toHaveTextContent("X:");
    expect(line()).toHaveTextContent(POLICY);
  });

  it("Pie: no X; the label and ring columns, analysis view", () => {
    render(<PiePanel />);
    expect(line()).toHaveTextContent("4 of 6 rows");
    expect(line()).not.toHaveTextContent(/ X: /);
    expect(line()).toHaveTextContent(POLICY);
  });

  it("Ternary: no X; the three composition columns, analysis view", () => {
    render(<TernaryPanel />);
    expect(line()).toHaveTextContent("Input: run.dat · Y: a, b, c · 4 of 6 rows");
    expect(line()).toHaveTextContent(POLICY);
  });

  it("a lazy preview is refused with its reason, not summarised", () => {
    useApp.setState({ datasets: [{ ...SHEET, pending: { kind: "bundle" } as unknown as Dataset["pending"] }] });
    render(<EllipseFitPanel />);
    expect(line()).toHaveTextContent("The full worksheet is still loading; its preview rows are not analysed.");
  });
});
