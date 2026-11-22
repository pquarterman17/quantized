// Characterization (lane RB, written BEFORE the result book was added): the
// existing tabbed result workspace for saved statistics results. The book is
// an added view; these pin that the default view, the tab order, the table
// list and the summary report handoff stay exactly as they were.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";


const { reportInline } = vi.hoisted(() => ({ reportInline: vi.fn() }));
vi.mock("../../../store/analysisResultActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../store/analysisResultActions")>()),
  sendAnalysisInlineTableToReport: reportInline,
}));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import AnalysisResultPanel from "./AnalysisResultPanel";
import { distribution, fitYByX, multivariate, source } from "./resultBook.testkit";
import { useApp } from "../../../store/useApp";

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [source], activeId: "source", analysisResults: [], openAnalysisResultId: null,
    staleDatasets: [], staleFits: [], history: [], future: [],
  });
});

const EXISTING_TABS = ["Overview", "Table", "Figures", "Diagnostics", "Provenance", "Notes"];

describe.each([
  ["Distribution", distribution],
  ["Fit Y by X", fitYByX],
  ["Multivariate", multivariate],
])("existing result workspace: %s", (_name, build) => {
  it("opens on Overview, keeps the existing tabs in order, and lists every saved table in order", () => {
    const result = build();
    useApp.setState({ analysisResults: [result], openAnalysisResultId: result.id });
    render(<AnalysisResultPanel />);
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent ?? "");
    const existing = tabs.filter((label) => EXISTING_TABS.some((name) => label.startsWith(name)));
    expect(existing.map((label) => label.replace(/ \(\d+\)$/, ""))).toEqual(EXISTING_TABS);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    const panel = screen.getByRole("tabpanel");
    const titles = within(panel).getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent);
    expect(titles).toEqual(result.tables!.map((table, index) => table.title || `Table ${index + 1}`));
    expect(within(panel).getAllByRole("button", { name: "Copy table" })).toHaveLength(result.tables!.length);
  });

  it("sends only the summary (no table index) from the toolbar", async () => {
    const result = build();
    reportInline.mockResolvedValue(true);
    useApp.setState({ analysisResults: [result], openAnalysisResultId: result.id });
    render(<AnalysisResultPanel />);
    const send = screen.getByRole("button", { name: "Send summary to report" });
    fireEvent.click(send);
    await waitFor(() => expect(send).toBeEnabled());
    expect(reportInline).toHaveBeenCalledWith(result.id);
  });
});
