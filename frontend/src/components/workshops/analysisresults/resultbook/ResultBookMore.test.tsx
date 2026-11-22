// Result book for statistical tests, Williamson–Hall (single and comparison)
// and analysis batches (lane RB2): header, section order, actions, stale state
// and the fail-closed "no book" cases.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../../../../lib/analysisResult";

const { copyInline, reportInline } = vi.hoisted(() => ({ copyInline: vi.fn(), reportInline: vi.fn() }));
vi.mock("../../../../store/analysisResultActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../store/analysisResultActions")>()),
  copyAnalysisInlineTables: copyInline,
  sendAnalysisInlineTableToReport: reportInline,
}));
vi.mock("../../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import AnalysisResultPanel from "../AnalysisResultPanel";
import { source, variabilitySource } from "../resultBook.testkit";
import {
  analysisBatch, anderson, dunnett, peakSheet, power, williamsonHall, williamsonHallBatch, xrd,
} from "../resultBookMore.testkit";
import { statisticalResultFigureDrafts } from "../../../../lib/statisticalResultFigures";
import { useStatsTestsStore } from "../../../../store/statsTests";
import { useWilliamsonHallRequestStore } from "../../../../store/williamsonHall";
import { useApp } from "../../../../store/useApp";
import type { Dataset } from "../../../../lib/types";

beforeEach(() => {
  vi.clearAllMocks();
  copyInline.mockResolvedValue(true);
  reportInline.mockResolvedValue(true);
  useWilliamsonHallRequestStore.setState({ request: null });
  useApp.setState({
    datasets: [source], activeId: "source", analysisResults: [], openAnalysisResultId: null,
    staleDatasets: [], staleFits: [], history: [], future: [], editableFigures: [], plotWindows: [],
    focusedWindowId: null, stageTab: "plot", reductionsOpen: false,
  });
});

function openBook(result: AnalysisResult, datasets: Dataset[]) {
  useApp.setState({ datasets, analysisResults: [result], openAnalysisResultId: result.id });
  render(<AnalysisResultPanel />);
  fireEvent.click(screen.getByRole("tab", { name: "Result book" }));
  return screen.getByRole("tabpanel");
}
const toggles = (panel: HTMLElement) => [...panel.querySelectorAll<HTMLButtonElement>(".qz-result-book-toggle")];
const titles = (panel: HTMLElement) => toggles(panel).map((button) => button.textContent!.replace(/^[▸▾]\s*/, ""));
const status = (panel: HTMLElement, label: string) =>
  expect(within(panel).getByText(label, { selector: ".qz-analysis-status" })).toBeInTheDocument();
const method = (panel: HTMLElement) => within(panel).getByRole("heading", { level: 3 });
const settingsOf = (panel: HTMLElement) => within(panel).getByLabelText("Settings");

describe("result book for statistical tests", () => {
  it("is an added tab; Overview stays the default", () => {
    const result = dunnett();
    useApp.setState({ datasets: [variabilitySource], analysisResults: [result], openAnalysisResultId: result.id });
    render(<AnalysisResultPanel />);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Result book" })).toHaveAttribute("aria-selected", "false");
  });

  it("names the test as the method and states alpha, alternative, groups and correction", () => {
    const panel = openBook(dunnett(), [variabilitySource]);
    expect(method(panel)).toHaveTextContent("Dunnett vs control");
    const settings = settingsOf(panel);
    expect(settings).toHaveTextContent("Groups (first is the control)Signal, Batch");
    expect(settings).toHaveTextContent("Alpha0.05");
    expect(settings).toHaveTextContent("Alternativetwo-sided");
    expect(settings).toHaveTextContent("CorrectionDunnett (each group against the control)");
    status(panel, "Current");
    const line = within(panel).getByLabelText("Analysis input");
    expect(line).toHaveTextContent(/Y: Signal.*Batch/);
    expect(line.textContent).not.toMatch(/X:/);
  });

  it("lists the saved tables in saved order, with no figure sections", () => {
    const result = dunnett();
    const panel = openBook(result, [variabilitySource]);
    expect(statisticalResultFigureDrafts(result)).toHaveLength(0);
    expect(titles(panel)).toEqual(["Comparisons", "Group means"]);
    expect(toggles(panel)[0]).toHaveAttribute("aria-expanded", "true");
  });

  it("copies, sends to the report and opens one table; reopens the saved question", async () => {
    const result = dunnett();
    const panel = openBook(result, [variabilitySource]);
    fireEvent.click(within(panel).getByRole("button", { name: "Copy table: Group means" }));
    await waitFor(() => expect(within(panel).getByRole("button", { name: "Copy table: Group means" })).toBeEnabled());
    expect(copyInline).toHaveBeenCalledWith(result.id, 1, result.tables);
    const send = within(panel).getByRole("button", { name: "Send to report: Group means" });
    fireEvent.click(send);
    await waitFor(() => expect(send).toBeEnabled());
    expect(reportInline).toHaveBeenCalledWith(result.id, 1);
    fireEvent.click(within(panel).getByRole("button", { name: "Open as worksheet: Comparisons" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
  });

  it("reopens the saved test in its tool", () => {
    const panel = openBook(dunnett(), [variabilitySource]);
    fireEvent.click(within(panel).getByRole("button", { name: "Reopen in tool" }));
    expect(useStatsTestsStore.getState().request).toMatchObject({ testId: "dunnett", params: { alpha: 0.05 } });
    expect(useApp.getState().openAnalysisResultId).toBeNull();
  });

  it("shows only the settings the test reads: no alpha for Anderson-Darling", () => {
    const panel = openBook(anderson(), [source]);
    expect(method(panel)).toHaveTextContent("Anderson-Darling");
    expect(settingsOf(panel)).toHaveTextContent("ColumnSignal");
    expect(settingsOf(panel)).not.toHaveTextContent("Alpha");
    expect(settingsOf(panel)).not.toHaveTextContent("Alternative");
  });

  it("a planning calculation needs no worksheet and is current", () => {
    const panel = openBook(power(), []);
    expect(method(panel)).toHaveTextContent("t-test power / sample size");
    expect(within(panel).queryByLabelText("Analysis input")).toBeNull();
    expect(within(panel).getByText("Input: no worksheet (planning calculation)")).toBeInTheDocument();
    expect(settingsOf(panel)).toHaveTextContent("Sample size nsolved for");
    status(panel, "Current");
  });

  it("shows a stale test as stale: saved input, note, report and reopen blocked, copy still works", () => {
    const changed = { ...variabilitySource, data: { ...variabilitySource.data, values: [[9, 10], [2, 20], [4, 20]] } };
    const panel = openBook(dunnett(), [changed]);
    status(panel, "Out of date");
    expect(within(panel).queryByLabelText("Analysis input")).toBeNull();
    expect(within(panel).getByText(/^Input: Raw trace/)).toBeInTheDocument();
    expect(within(panel).getByRole("note")).toHaveTextContent(/source changed since this result was saved/);
    const send = within(panel).getByRole("button", { name: "Send to report: Comparisons" });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute("title", expect.stringMatching(/Run the analysis again/));
    expect(within(panel).getByRole("button", { name: "Reopen in tool" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Copy table: Comparisons" })).toBeEnabled();
  });

  it("has no book tab when the saved settings cannot be read", () => {
    for (const broken of [
      { ...dunnett(), parameters: { ...dunnett().parameters, params: { alpha: "x" } } },
      { ...dunnett(), parameters: { ...dunnett().parameters, labels: undefined } },
      { ...dunnett(), parameters: undefined },
    ] as AnalysisResult[]) {
      useApp.setState({ datasets: [variabilitySource], analysisResults: [broken], openAnalysisResultId: broken.id });
      const { unmount } = render(<AnalysisResultPanel />);
      expect(screen.queryByRole("tab", { name: "Result book" })).toBeNull();
      unmount();
    }
  });
});

describe("result book for Williamson–Hall", () => {
  it("states the method, the peak inputs and the settings; tables then the fit figure", () => {
    const result = williamsonHall();
    const panel = openBook(result, [xrd]);
    expect(method(panel)).toHaveTextContent("Williamson–Hall: crystallite size and microstrain");
    expect(within(panel).getByText("Input: film.xrdml · 2 peaks (2θ, FWHM) entered by hand")).toBeInTheDocument();
    const settings = settingsOf(panel);
    expect(settings).toHaveTextContent("Wavelength1.5406 Å");
    expect(settings).toHaveTextContent("K factor0.9");
    expect(settings).toHaveTextContent("Instrumental broadening0.05°");
    status(panel, "Current");
    expect(within(panel).getByRole("list", { name: "Warnings" })).toBeInTheDocument();
    const figures = statisticalResultFigureDrafts(result).map((draft) => draft.name);
    expect(figures).toHaveLength(1);
    expect(titles(panel)).toEqual(["Summary", "Peak inputs", "Williamson–Hall fit", ...figures]);
  });

  it("sends a table to the report, creates the figure and reopens the reduction", async () => {
    const result = williamsonHall();
    const panel = openBook(result, [xrd]);
    const send = within(panel).getByRole("button", { name: "Send to report: Peak inputs" });
    fireEvent.click(send);
    await waitFor(() => expect(send).toBeEnabled());
    expect(reportInline).toHaveBeenCalledWith(result.id, 1);
    fireEvent.click(within(panel).getByRole("button", { name: /Create editable figure:/ }));
    await waitFor(() => expect(useApp.getState().editableFigures).toHaveLength(1));
  });

  it("reopens the saved recipe", () => {
    const panel = openBook(williamsonHall(), [xrd]);
    fireEvent.click(within(panel).getByRole("button", { name: "Reopen in tool" }));
    expect(useWilliamsonHallRequestStore.getState().request).toMatchObject({ kFactor: 0.9, sourceKind: "manual" });
  });

  it("shows a stale result as stale with report, figure and reopen blocked", () => {
    const panel = openBook(williamsonHall(), [{ ...xrd, data: { ...xrd.data, values: [[11], [100], [20]] } }]);
    status(panel, "Out of date");
    expect(within(panel).getByRole("button", { name: "Send to report: Summary" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Reopen in tool" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: /Create editable figure:/ })).toBeDisabled();
  });

  it("has no book tab when the saved recipe does not parse", () => {
    const result = { ...williamsonHall(), parameters: {} };
    useApp.setState({ datasets: [xrd], analysisResults: [result], openAnalysisResultId: result.id });
    render(<AnalysisResultPanel />);
    expect(screen.queryByRole("tab", { name: "Result book" })).toBeNull();
  });
});

describe("result book for a Williamson–Hall comparison", () => {
  const sheets = [peakSheet("a"), peakSheet("b")];

  it("states the worksheets and settings; the comparison table then its figures; no reopen", () => {
    const result = williamsonHallBatch(sheets);
    const panel = openBook(result, sheets);
    expect(method(panel)).toHaveTextContent("Williamson–Hall comparison across 2 worksheets");
    expect(within(panel).getByText("Input: 2 worksheets · fitted peak tables (2θ, FWHM)")).toBeInTheDocument();
    expect(settingsOf(panel)).toHaveTextContent("Wavelength1.5406 Å");
    status(panel, "Current");
    const figures = statisticalResultFigureDrafts(result).map((draft) => draft.name);
    expect(figures).toHaveLength(3);
    expect(titles(panel)).toEqual(["Crystallite comparison", ...figures]);
    expect(within(panel).queryByRole("button", { name: "Reopen in tool" })).toBeNull();
    expect(within(panel).getByRole("button", { name: "Send to report: Crystallite comparison" })).toBeEnabled();
  });

  it("is stale when a fitted peak table changed", () => {
    const [a, b] = sheets;
    const changed = { ...a, peakTable: { ...a.peakTable!, peaks: a.peakTable!.peaks.map((peak, index) =>
      index ? peak : { ...peak, fwhm: 0.25 }) } };
    const panel = openBook(williamsonHallBatch(sheets), [changed, b]);
    status(panel, "Out of date");
    expect(within(panel).getByRole("button", { name: "Send to report: Crystallite comparison" })).toBeDisabled();
    fireEvent.click(within(panel).getByRole("button", { name: "Expand all" }));
    for (const create of within(panel).getAllByRole("button", { name: /Create editable figure:/ })) expect(create).toBeDisabled();
  });

  it("has no book tab when the saved comparison recipe does not parse", () => {
    const good = williamsonHallBatch(sheets);
    const recipe = good.parameters!.recipe as { items: Record<string, unknown>[] };
    for (const items of [[], [{ ...recipe.items[0], rows: [] }]]) {
      const result = { ...good, parameters: { recipe: { ...recipe, items } } } as AnalysisResult;
      useApp.setState({ datasets: sheets, analysisResults: [result], openAnalysisResultId: result.id });
      const { unmount } = render(<AnalysisResultPanel />);
      expect(screen.queryByRole("tab", { name: "Result book" })).toBeNull();
      unmount();
    }
  });
});

describe("result book for an analysis batch", () => {
  const sheets = [{ ...source, id: "a", name: "a" }, { ...source, id: "b", name: "b" }];

  it("names the tool's batch, its settings and the status table; no reopen", async () => {
    const result = analysisBatch(sheets);
    const panel = openBook(result, sheets);
    expect(method(panel)).toHaveTextContent("Baseline batch");
    expect(within(panel).getByText("Input: 2 worksheets")).toBeInTheDocument();
    const settings = settingsOf(panel);
    expect(settings).toHaveTextContent("Worksheets2");
    expect(settings).toHaveTextContent("Completed1");
    expect(settings).toHaveTextContent("Methodlinear");
    expect(settings).not.toHaveTextContent("Selection");
    expect(settings).not.toHaveTextContent("Params");
    expect(titles(panel)).toEqual(["Batch status"]);
    expect(within(panel).getByRole("list", { name: "Warnings" })).toHaveTextContent("b: no data");
    expect(within(panel).queryByRole("button", { name: "Reopen in tool" })).toBeNull();
    const send = within(panel).getByRole("button", { name: "Send to report: Batch status" });
    fireEvent.click(send);
    await waitFor(() => expect(send).toBeEnabled());
    expect(reportInline).toHaveBeenCalledWith(result.id, 0);
  });

  it("shows a stale batch as stale with report blocked", () => {
    const panel = openBook(analysisBatch(sheets), [{ ...sheets[0], data: { ...sheets[0].data, values: [[9], [2], [4]] } }, sheets[1]]);
    status(panel, "Out of date");
    expect(within(panel).getByRole("button", { name: "Send to report: Batch status" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Copy table: Batch status" })).toBeEnabled();
  });

  it("has no book tab without a readable tool id, selection version or status table", () => {
    const good = analysisBatch(sheets);
    for (const broken of [
      { ...good, parameters: { ...good.parameters, toolId: "" } },
      { ...good, parameters: { ...good.parameters, selection: { version: 99 } } },
      { ...good, tables: [{ title: "Other", columns: ["a"], rows: [] }] },
    ] as AnalysisResult[]) {
      useApp.setState({ datasets: sheets, analysisResults: [broken], openAnalysisResultId: broken.id });
      const { unmount } = render(<AnalysisResultPanel />);
      expect(screen.queryByRole("tab", { name: "Result book" })).toBeNull();
      unmount();
    }
  });
});
