// Baseline and Optical gap state their input and row policy through the shared
// summary (lib/analysisInputs) and keep the policy they always had.

import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import BaselinePanel from "../baseline/BaselinePanel";
import MagToolsPanel from "../magtools/MagToolsPanel";
import OpticalGapPanel from "../opticalgap/OpticalGapPanel";

const { taucMock } = vi.hoisted(() => ({ taucMock: vi.fn() }));
vi.mock("../../../lib/api/analysisExtras", () => ({ taucFit: taucMock }));
vi.mock("../../../lib/api/baseline", () => ({
  baselineALS: vi.fn(), baselineAnchor: vi.fn(), baselineEstimate: vi.fn(), baselineModPoly: vi.fn(),
  baselineRegion: vi.fn(), baselineRollingBall: vi.fn(), baselineShirley: vi.fn(), baselineXrdLowAngle: vi.fn(),
}));
vi.mock("../../../lib/api/magnetometry", () => ({
  subtractMagBackground: vi.fn(), subtractHysteresisBackground: vi.fn(), normalizeMagMoment: vi.fn(), demagCorrectField: vi.fn(),
}));
vi.mock("../SmallUPlot", () => ({ default: () => <div /> }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));

const SHEET: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [2, 2.5, 3, 3.5],
    values: [[1e3], [1e4], [5e4], [9e4]],
    labels: ["alpha"],
    units: ["1/cm"],
    metadata: { x_column_name: "Energy", x_column_unit: "eV" },
  },
  excludedRows: [1],
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [SHEET], activeId: "d1", status: "", baselineOverlay: null, baselineAnchorEdit: null,
    plotTool: "zoom", regionPicked: null, xKey: null, yKeys: null, seriesOrder: null,
  });
});

describe("general tools show the shared summary", () => {
  it("Baseline: every row is used, and the line says the excluded one is included", () => {
    render(<BaselinePanel />);
    const line = screen.getByLabelText("Analysis input");
    expect(line).toHaveTextContent("Input: run.dat · X: Energy (eV) · Y: alpha (1/cm) · 4 of 4 rows");
    expect(line).toHaveTextContent("Uses every row, including 1 excluded or filtered-out row.");
  });

  it("Optical gap: the analysis view is used, and the line says the excluded row is left out", () => {
    render(<OpticalGapPanel />);
    const line = screen.getByLabelText("Analysis input");
    expect(line).toHaveTextContent("Input: run.dat · X: Energy (eV) · Y: alpha (1/cm) · 3 of 4 rows");
    expect(line).toHaveTextContent("Excluded and filtered-out rows are left out (1 excluded row, 0 filtered-out rows).");
  });

  it("Optical gap refuses, with the contract's reason, when no rows remain", async () => {
    useApp.setState({ datasets: [{ ...SHEET, excludedRows: [0, 1, 2, 3] }] });
    render(<OpticalGapPanel />);
    expect(screen.getByLabelText("Analysis input")).toHaveAttribute("data-refusal", "no-rows");
    fireEvent.click(screen.getByRole("button", { name: "Fit gap" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No rows remain after exclusions");
    expect(taucMock).not.toHaveBeenCalled();
  });

  it("Magnetometry tools: Background states the full worksheet, Curie-Weiss the analysis view", () => {
    useApp.setState({ magToolsOpen: true } as never);
    render(<MagToolsPanel />);
    expect(screen.getByLabelText("Analysis input")).toHaveTextContent("Uses every row, including 1 excluded or filtered-out row.");
    fireEvent.click(screen.getByRole("radio", { name: "Curie–Weiss" }));
    expect(screen.getByLabelText("Analysis input")).toHaveTextContent("Excluded and filtered-out rows are left out (1 excluded row");
  });
});
