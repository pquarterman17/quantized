// FIGURE_AUTHORING_WORKFLOW_PLAN F3.3: the Library section for saved
// multi-panel pages — list (most-recently-modified first), open/reopen,
// rename, duplicate, delete (confirm + undo). Mirrors
// EditableFiguresSection.test.tsx's established pattern.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askConfirm } from "../overlays/ConfirmDialog";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const askParams = vi.fn();
vi.mock("../overlays/ParamDialog", () => ({
  askParams: (...args: unknown[]) => askParams(...args) as Promise<Record<string, unknown> | null>,
}));

import PagesSection from "./PagesSection";
import { createPageDocument } from "../../lib/pageDocument";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  askParams.mockReset();
  useApp.setState({ pages: [], pageDocSeed: null, figurePageOpen: false, history: [] });
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
});
