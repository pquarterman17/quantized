// The shared result-book shell (lane RB3) and "Open saved result": the open
// state rules every host relies on, and the request that opens a saved result
// on its Result book tab.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import { openResultBook, useResultBookRequest } from "../../../store/resultBookRequest";
import { useApp } from "../../../store/useApp";
import AnalysisResultPanel from "../analysisresults/AnalysisResultPanel";
import { distribution, fitYByX, source } from "../analysisresults/resultBook.testkit";
import ResultBookShell, { type ResultBookSectionSpec } from "./ResultBookShell";

const spec = (key: string, extra: Partial<ResultBookSectionSpec> = {}): ResultBookSectionSpec => ({
  key, kind: "table", title: key, render: () => <p>body {key}</p>, ...extra,
});
const isOpen = (title: string) => screen.getByRole("button", { name: title }).getAttribute("aria-expanded") === "true";

beforeEach(() => {
  useResultBookRequest.setState({ bookFor: null });
  useApp.setState({
    datasets: [source], activeId: "source", analysisResults: [], openAnalysisResultId: null,
    staleDatasets: [], staleFits: [], history: [], future: [], status: "",
  });
});

describe("ResultBookShell", () => {
  it("'first' opens only the first section; a body renders only while open", () => {
    render(<ResultBookShell method="M" initialOpen="first" sections={[spec("A"), spec("B")]} />);
    expect(isOpen("A")).toBe(true);
    expect(isOpen("B")).toBe(false);
    expect(screen.queryByText("body B")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(screen.getByText("body B")).toBeInTheDocument();
  });

  it("'all' opens every section except startCollapsed ones; Expand all opens those too, Collapse all closes all", () => {
    render(<ResultBookShell method="M" initialOpen="all" sections={[spec("A"), spec("B", { startCollapsed: true })]} />);
    expect([isOpen("A"), isOpen("B")]).toEqual([true, false]);
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect([isOpen("A"), isOpen("B")]).toEqual([true, true]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect([isOpen("A"), isOpen("B")]).toEqual([false, false]);
  });

  it("keeps a section the user toggled while other sections come and go (a tool recomputes)", () => {
    const { rerender } = render(<ResultBookShell method="M" initialOpen="all" sections={[spec("A"), spec("B")]} />);
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    rerender(<ResultBookShell method="M" initialOpen="all" sections={[spec("A"), spec("C"), spec("B")]} />);
    expect([isOpen("A"), isOpen("C"), isOpen("B")]).toEqual([false, true, true]);
  });

  it("disables Expand all / Collapse all and shows the empty text without sections", () => {
    render(<ResultBookShell method="M" initialOpen="all" sections={[]} empty={<p>nothing</p>} />);
    expect(screen.getByRole("button", { name: "Expand all" })).toBeDisabled();
    expect(screen.getByText("nothing")).toBeInTheDocument();
  });
});

describe("Open saved result", () => {
  it("opens the saved result on its Result book tab, once", () => {
    const result = distribution();
    useApp.setState({ analysisResults: [result] });
    render(<AnalysisResultPanel />);
    act(() => { expect(openResultBook(result.id)).toBe(true); });
    expect(screen.getByRole("tab", { name: "Result book" })).toHaveAttribute("aria-selected", "true");
    expect(useResultBookRequest.getState().bookFor).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("a request for another result does not switch this result's tab", () => {
    const shown = distribution();
    const other = fitYByX();
    useApp.setState({ analysisResults: [shown, other], openAnalysisResultId: shown.id });
    render(<AnalysisResultPanel />);
    act(() => { useResultBookRequest.setState({ bookFor: other.id }); });
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("refuses a deleted result with a status, opening nothing", () => {
    expect(openResultBook("gone")).toBe(false);
    expect(useApp.getState().openAnalysisResultId).toBeNull();
    expect(useApp.getState().status).toMatch(/deleted/);
  });
});

describe("Open saved result: a stale request", () => {
  it("is dropped when the open result changes before the workspace consumed it (e.g. Undo)", () => {
    const result = distribution();
    useApp.setState({ analysisResults: [result] });
    expect(openResultBook(result.id)).toBe(true);
    expect(useResultBookRequest.getState().bookFor).toBe(result.id);
    useApp.setState({ openAnalysisResultId: null });
    expect(useResultBookRequest.getState().bookFor).toBeNull();
    // A later open of the same result shows Overview, not the book.
    useApp.setState({ openAnalysisResultId: result.id });
    render(<AnalysisResultPanel />);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });
});
