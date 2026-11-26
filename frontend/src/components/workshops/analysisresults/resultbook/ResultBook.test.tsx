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
import { distribution, fitYByX, multivariate, outlier, source, variability, variabilitySource } from "../resultBook.testkit";
import { statisticalTestAnalysisResult } from "../../../../lib/statisticalTestAnalysisResult";
import { DEFAULT_PARAMS, DEFAULT_SELECTION } from "../../../../lib/statsTests";
import { statisticalResultFigureDrafts } from "../../../../lib/statisticalResultFigures";
import { useDistributionRequestStore } from "../../../../store/distribution";
import { useApp } from "../../../../store/useApp";

beforeEach(() => {
  vi.clearAllMocks();
  copyInline.mockResolvedValue(true);
  reportInline.mockResolvedValue(true);
  useDistributionRequestStore.setState({ request: null });
  useApp.setState({
    datasets: [source], activeId: "source", analysisResults: [], openAnalysisResultId: null,
    staleDatasets: [], staleFits: [], history: [], future: [], editableFigures: [], plotWindows: [],
    focusedWindowId: null, stageTab: "plot", distributionOpen: false,
  });
});

function openBook(result: AnalysisResult, datasets = [source]) {
  useApp.setState({ datasets, analysisResults: [result], openAnalysisResultId: result.id });
  render(<AnalysisResultPanel />);
  fireEvent.click(screen.getByRole("tab", { name: "Result book" }));
  return screen.getByRole("tabpanel");
}

const toggles = (panel: HTMLElement) => [...panel.querySelectorAll<HTMLButtonElement>(".qz-result-book-toggle")];
const titles = (panel: HTMLElement) => toggles(panel).map((button) => button.textContent!.replace(/^[▸▾]\s*/, ""));

describe("result book", () => {
  it("is an added tab: Overview stays the default", () => {
    const result = distribution();
    useApp.setState({ analysisResults: [result], openAnalysisResultId: result.id });
    render(<AnalysisResultPanel />);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Result book" })).toHaveAttribute("aria-selected", "false");
  });

  it("renders tables in saved order, then figures in draft order", () => {
    const result = distribution();
    const panel = openBook(result);
    const tables = result.tables!.map((table, index) => table.title || `Table ${index + 1}`);
    const figures = statisticalResultFigureDrafts(result).map((draft) => draft.name);
    expect(figures.length).toBeGreaterThan(0);
    expect(titles(panel)).toEqual([...tables, ...figures]);
  });

  it("opens the first section only; toggles, expands all and collapses all", () => {
    const panel = openBook(distribution());
    const [first, second] = toggles(panel);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(first.getAttribute("aria-controls")!)).toBeInTheDocument();
    expect(document.getElementById(second.getAttribute("aria-controls")!)).toBeNull();
    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(within(panel).getByRole("button", { name: "Expand all" }));
    expect(toggles(panel).every((button) => button.getAttribute("aria-expanded") === "true")).toBe(true);
    fireEvent.click(within(panel).getByRole("button", { name: "Collapse all" }));
    expect(toggles(panel).every((button) => button.getAttribute("aria-expanded") === "false")).toBe(true);
  });

  it("states the inputs through the shared input line, the method and the settings", () => {
    const panel = openBook(distribution());
    expect(within(panel).getByLabelText("Analysis input")).toHaveTextContent(/Input: Raw trace · X: .* · Y: Signal \(V\) · 3 of 3 rows/);
    expect(within(panel).getByRole("heading", { level: 3 })).toHaveTextContent("Distribution: descriptive summary and Shapiro–Wilk");
    const settings = within(panel).getByLabelText("Settings");
    expect(settings).toHaveTextContent("Percentile90%");
    expect(within(panel).getByText("Current", { selector: ".qz-analysis-status" })).toBeInTheDocument();
  });

  it("copies one section's table", async () => {
    const result = distribution();
    const panel = openBook(result);
    const copy = within(panel).getByRole("button", { name: "Copy table: Histogram" });
    fireEvent.click(copy);
    fireEvent.click(copy);
    await waitFor(() => expect(copy).toBeEnabled());
    expect(copyInline).toHaveBeenCalledTimes(1);
    expect(copyInline).toHaveBeenCalledWith(result.id, 1, result.tables);
  });

  it("sends one section's table to the report", async () => {
    const result = distribution();
    const panel = openBook(result);
    const send = within(panel).getByRole("button", { name: "Send to report: Histogram" });
    fireEvent.click(send);
    await waitFor(() => expect(send).toBeEnabled());
    expect(reportInline).toHaveBeenCalledWith(result.id, 1);
  });

  it("opens a section's table as a new worksheet and shows it", async () => {
    const result = distribution();
    const panel = openBook(result);
    fireEvent.click(within(panel).getByRole("button", { name: "Open as worksheet: Histogram" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    const created = useApp.getState().datasets[1];
    expect(created.data.labels).toEqual(result.tables![1].columns);
    expect(useApp.getState()).toMatchObject({ activeId: created.id, stageTab: "worksheet", openAnalysisResultId: null });
  });

  it("creates an editable figure from a collapsed figure section's header", async () => {
    const result = distribution();
    const panel = openBook(result);
    const figureToggle = toggles(panel).at(-1)!;
    expect(figureToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(within(panel).getAllByRole("button", { name: /Create editable figure:/ })[0]);
    await waitFor(() => expect(useApp.getState().editableFigures).toHaveLength(1));
    expect(useApp.getState().openAnalysisResultId).toBeNull();
  });

  it("reopens the saved question in its tool", () => {
    const panel = openBook(distribution());
    fireEvent.click(within(panel).getByRole("button", { name: "Reopen in tool" }));
    expect(useDistributionRequestStore.getState().request).toMatchObject({ col: 0, fitDist: "none", percentileInput: 90 });
    expect(useApp.getState()).toMatchObject({ distributionOpen: true, openAnalysisResultId: null });
  });

  it("shows a stale result as stale: saved input, a note, and report, figure and reopen blocked", () => {
    const result = distribution();
    const panel = openBook(result, [{ ...source, data: { ...source.data, values: [[9], [2], [4]] } }]);
    expect(within(panel).getByText("Out of date", { selector: ".qz-analysis-status" })).toBeInTheDocument();
    expect(within(panel).queryByLabelText("Analysis input")).toBeNull();
    expect(within(panel).getByText("Input: Raw trace · Signal")).toBeInTheDocument();
    expect(within(panel).getByRole("note")).toHaveTextContent(/source changed since this result was saved/);
    const send = within(panel).getByRole("button", { name: "Send to report: Summary" });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute("title", expect.stringMatching(/Run the analysis again/));
    expect(within(panel).getByRole("button", { name: "Review and rerun" })).toBeEnabled();
    // The saved values stay readable and copyable.
    expect(within(panel).getByRole("button", { name: "Copy table: Summary" })).toBeEnabled();
    fireEvent.click(within(panel).getByRole("button", { name: "Expand all" }));
    for (const create of within(panel).getAllByRole("button", { name: /Create editable figure:/ })) expect(create).toBeDisabled();
  });

  it("disables Open as worksheet, with the reason, for a table Freeze cannot take", () => {
    const result = distribution();
    const tables = result.tables!.map((table, index) => index === 1 ? { ...table, rows: [] } : table);
    const panel = openBook({ ...result, tables });
    const open = within(panel).getByRole("button", { name: "Open as worksheet: Histogram" });
    expect(open).toBeDisabled();
    expect(open).toHaveAttribute("title", "Can't open as a worksheet: empty table.");
    expect(within(panel).getByRole("button", { name: "Open as worksheet: Summary" })).toBeEnabled();
  });

  it("keeps the book of a result whose source lost the analysed column", () => {
    const result = fitYByX();
    const shrunk = { ...source, data: { ...source.data, values: [[], [], []], labels: [], units: [] } };
    const panel = openBook(result, [shrunk]);
    expect(within(panel).getByText("Out of date", { selector: ".qz-analysis-status" })).toBeInTheDocument();
    expect(toggles(panel)).toHaveLength(result.tables!.length + statisticalResultFigureDrafts(result).length);
  });

  it("offers no book tab when the saved recipe does not parse", () => {
    const result = { ...distribution(), parameters: {} };
    useApp.setState({ analysisResults: [result], openAnalysisResultId: result.id });
    render(<AnalysisResultPanel />);
    expect(screen.queryByRole("tab", { name: "Result book" })).toBeNull();
  });

  it("offers no book for a producer without one", () => {
    const base = statisticalTestAnalysisResult(
      "stats", source, "anderson", { ...DEFAULT_SELECTION, x: 0 }, DEFAULT_PARAMS, ["Signal"],
      { sentence: "Normal.", tables: [{ title: "Statistics", columns: ["statistic", "value"], rows: [["A²", 0.2]] }] },
      "2026-10-10T00:00:00Z",
    );
    const test = { ...base, producer: { id: "some-other-tool", label: "Other", version: 1 } };
    useApp.setState({ analysisResults: [test], openAnalysisResultId: test.id });
    render(<AnalysisResultPanel />);
    expect(screen.queryByRole("tab", { name: "Result book" })).toBeNull();
  });
});

describe.each([
  ["Distribution", distribution, [source], /^Distribution/, "Y: Signal (V)"],
  ["Fit Y by X", fitYByX, [source], /^Fit Y by X: bivariate/, "Y: Signal (V)"],
  ["Multivariate", multivariate, [source], /^Multivariate: Pearson correlation and PCA/, "Y: Time"],
  ["Variability", variability, [variabilitySource], /^Variability/, "Batch"],
  ["Outlier screening", outlier, [source], /^Outlier screening: MAD/, "Y: Signal (V)"],
] as const)("result book for %s", (_name, build, datasets, method, input) => {
  it("shows the header and one section per saved table and figure", () => {
    const result = build();
    const panel = openBook(result, [...datasets]);
    expect(within(panel).getByRole("heading", { level: 3 }).textContent).toMatch(method);
    expect(within(panel).getByLabelText("Analysis input")).toHaveTextContent(input);
    expect(toggles(panel)).toHaveLength(result.tables!.length + statisticalResultFigureDrafts(result).length);
    expect(within(panel).getAllByRole("button", { name: /^Copy table: / })).toHaveLength(result.tables!.length);
  });
});
