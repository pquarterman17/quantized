// FIGURE_AUTHORING_WORKFLOW_PLAN F3.3: the Library section for saved
// multi-panel pages — list (most-recently-modified first), open/reopen,
// rename, duplicate, delete (confirm + undo). Mirrors
// EditableFiguresSection.test.tsx's established pattern.
//
// F3.6 adds "export without reopening" (the ⤓ button) — see the tests below.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askConfirm } from "../overlays/ConfirmDialog";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const askParams = vi.fn();
vi.mock("../overlays/ParamDialog", () => ({
  askParams: (...args: unknown[]) => askParams(...args) as Promise<Record<string, unknown> | null>,
}));

vi.mock("../../lib/api", () => ({ exportFigurePage: vi.fn().mockResolvedValue(undefined) }));

import PagesSection from "./PagesSection";
import { exportFigurePage } from "../../lib/api";
import { createFigureDocument } from "../../lib/figureDocument";
import { createPageDocument } from "../../lib/pageDocumentActions";
import { defaultPlotView } from "../../lib/plotview";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";

const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [[1, 9], [2, 8], [3, 7]],
  labels: ["A", "B"],
  units: ["u", "v"],
  metadata: {},
};

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  vi.mocked(exportFigurePage).mockClear();
  askParams.mockReset();
  useApp.setState({
    pages: [],
    pageDocSeed: null,
    figurePageOpen: false,
    history: [],
    editableFigures: [],
    datasets: [],
    status: "",
  });
});

describe("PagesSection", () => {
  it("renders nothing without saved pages", () => {
    const { container } = render(<PagesSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists saved pages most-recently-modified first", () => {
    const older = createPageDocument({ id: "p1", name: "Older page", createdAt: "2026-01-01T00:00:00.000Z", modifiedAt: "2026-01-01T00:00:00.000Z" });
    const newer = createPageDocument({ id: "p2", name: "Newer page", createdAt: "2026-02-01T00:00:00.000Z", modifiedAt: "2026-03-01T00:00:00.000Z" });
    useApp.setState({ pages: [older, newer] });
    render(<PagesSection />);
    const rows = screen.getAllByText(/page$/);
    expect(rows.map((r) => r.textContent)).toEqual(["▦ Newer page", "▦ Older page"]);
  });

  it("opens a page: seeds pageDocSeed and raises the workshop", () => {
    const page = createPageDocument({ id: "p1", name: "My page" });
    useApp.setState({ pages: [page] });
    render(<PagesSection />);
    fireEvent.click(screen.getByTitle('open saved page "My page"'));
    expect(useApp.getState().figurePageOpen).toBe(true);
    expect(useApp.getState().pageDocSeed).toMatchObject({ id: "p1" });
  });

  it("renames a saved page via the param dialog", async () => {
    const page = createPageDocument({ id: "p1", name: "Old name" });
    useApp.setState({ pages: [page] });
    askParams.mockResolvedValueOnce({ name: "New name" });
    render(<PagesSection />);
    fireEvent.click(screen.getByTitle("rename saved page"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useApp.getState().pages[0].name).toBe("New name");
  });

  it("duplicates a saved page", () => {
    const page = createPageDocument({ id: "p1", name: "Original" });
    useApp.setState({ pages: [page] });
    render(<PagesSection />);
    fireEvent.click(screen.getByTitle("duplicate saved page"));
    expect(useApp.getState().pages).toHaveLength(2);
    expect(useApp.getState().pages.map((p) => p.name)).toEqual(["Original", "Original copy"]);
  });

  it("deletes a saved page on confirm, and undo restores it", async () => {
    const page = createPageDocument({ id: "p1", name: "Doomed page" });
    useApp.setState({ pages: [page] });
    vi.mocked(askConfirm).mockResolvedValue(true);
    render(<PagesSection />);
    fireEvent.click(screen.getByTitle("delete saved page (undo available)"));
    await Promise.resolve();
    expect(useApp.getState().pages).toEqual([]);
    useApp.getState().undo();
    expect(useApp.getState().pages).toHaveLength(1);
  });

  it("does not delete when the user cancels the confirm", async () => {
    const page = createPageDocument({ id: "p1", name: "Kept page" });
    useApp.setState({ pages: [page] });
    vi.mocked(askConfirm).mockResolvedValue(false);
    render(<PagesSection />);
    fireEvent.click(screen.getByTitle("delete saved page (undo available)"));
    await Promise.resolve();
    expect(useApp.getState().pages).toHaveLength(1);
  });

  // F3.6 "export a saved page without reopening it".
  describe("export without reopening", () => {
    it("exports a page whose panels are all resolved figures, using the page's own output settings", async () => {
      const figure = createFigureDocument({
        id: "figure-1", name: "Loop", datasetId: "d1", view: defaultPlotView(),
      });
      const page = createPageDocument({
        id: "p1",
        name: "Ready page",
        rows: 1,
        cols: 1,
        panels: [{ figureId: "figure-1", label: null, title: null }],
        output: { format: "svg", stylePreset: "default", dpi: 450, labelFormat: "(a)", labelPos: "nw" },
      });
      useApp.setState({
        pages: [page],
        editableFigures: [figure],
        datasets: [{ id: "d1", name: "scan.dat", data: DATA }],
      });
      render(<PagesSection />);
      fireEvent.click(screen.getByTitle('export "Ready page" without reopening it'));
      await waitFor(() => expect(exportFigurePage).toHaveBeenCalledTimes(1));
      const body = vi.mocked(exportFigurePage).mock.calls[0][0];
      expect(body.fmt).toBe("svg");
      expect(body.dpi).toBe(450);
      expect(body.panels).toHaveLength(1);
      await waitFor(() => expect(useApp.getState().status).toBe("exported figure_page.svg"));
    });

    it("shows a status instead of exporting when the page has no assigned panels", async () => {
      const page = createPageDocument({ id: "p1", name: "Empty page" });
      useApp.setState({ pages: [page] });
      render(<PagesSection />);
      fireEvent.click(screen.getByTitle('export "Empty page" without reopening it'));
      await waitFor(() => expect(useApp.getState().status).toMatch(/no assigned panels to export/));
      expect(exportFigurePage).not.toHaveBeenCalled();
    });

    it("fails visibly, naming the panel, when a figure reference is dangling", async () => {
      const page = createPageDocument({
        id: "p1",
        name: "Stale page",
        panels: [{ figureId: "figure-gone", label: null, title: null }],
      });
      useApp.setState({ pages: [page] });
      render(<PagesSection />);
      fireEvent.click(screen.getByTitle('export "Stale page" without reopening it'));
      await waitFor(() => expect(useApp.getState().status).toMatch(/referenced figure no longer exists/));
      expect(exportFigurePage).not.toHaveBeenCalled();
    });
  });
});
