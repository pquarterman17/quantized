// FIGURE_AUTHORING_WORKFLOW_PLAN F3.2 item 3: deleting an editable figure
// warns by name about any persisted page(s) that reference it, before the
// delete happens — referential integrity at the delete site. The reference
// itself never cascades: `deleteEditableFigure` still just removes the
// document (undo restores it); a page panel that pointed at it resolves to
// "missing" on its next read (lib/pageDocument.ts's resolvePagePanel).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askConfirm } from "../overlays/ConfirmDialog";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

import EditableFiguresSection from "./EditableFiguresSection";
import { createFigureDocument, type FigureDocument } from "../../lib/figureDocument";
import { createPageDocument, type PageDocument } from "../../lib/pageDocument";
import type { Dataset } from "../../lib/types";
import { defaultPlotView } from "../../lib/plotview";
import { useApp } from "../../store/useApp";

const d1: Dataset = {
  id: "d1",
  name: "loop",
  data: { time: [0], values: [[1]], labels: ["M"], units: [""], metadata: {} },
};

function figure(over: Partial<FigureDocument> = {}): FigureDocument {
  return {
    ...createFigureDocument({
      id: "figure-1",
      name: "MvsH loop",
      datasetId: "d1",
      view: defaultPlotView(),
    }),
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  useApp.setState({
    datasets: [d1],
    editableFigures: [],
    pages: [],
    plotWindows: [],
    history: [],
  });
});

describe("EditableFiguresSection", () => {
  it("renders nothing without editable figures", () => {
    const { container } = render(<EditableFiguresSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("deletes plainly (no page references) with the plain confirm message", async () => {
    useApp.setState({ editableFigures: [figure()] });
    vi.mocked(askConfirm).mockResolvedValue(true);
    render(<EditableFiguresSection />);
    fireEvent.click(screen.getByTitle("delete editable figure (undo available)"));
    await Promise.resolve();
    expect(vi.mocked(askConfirm).mock.calls[0][1]).toBe(
      "The saved figure will be removed. You can restore it with Undo.",
    );
    expect(useApp.getState().editableFigures).toHaveLength(0);
  });

  it("names the referencing page and panel label in the confirm message before deleting", async () => {
    useApp.setState({
      editableFigures: [figure()],
      pages: [
        createPageDocument({
          id: "page-1",
          name: "Results page",
          rows: 1,
          cols: 2,
          panels: [
            { figureId: "figure-1", label: null, title: null },
            { figureId: null, label: null, title: null },
          ],
        }),
      ] as PageDocument[],
    });
    vi.mocked(askConfirm).mockResolvedValue(true);
    render(<EditableFiguresSection />);
    fireEvent.click(screen.getByTitle("delete editable figure (undo available)"));
    await Promise.resolve();
    const message = vi.mocked(askConfirm).mock.calls[0][1] as string;
    expect(message).toContain("Results page");
    expect(message).toContain("(a)");
    expect(message).toContain("missing");
  });

  it("still deletes the figure on confirm even when a page references it — no cascade, no block", async () => {
    useApp.setState({
      editableFigures: [figure()],
      pages: [
        createPageDocument({
          id: "page-1",
          name: "Results page",
          panels: [{ figureId: "figure-1", label: null, title: null }],
        }),
      ] as PageDocument[],
    });
    vi.mocked(askConfirm).mockResolvedValue(true);
    render(<EditableFiguresSection />);
    fireEvent.click(screen.getByTitle("delete editable figure (undo available)"));
    await Promise.resolve();
    expect(useApp.getState().editableFigures).toHaveLength(0);
    // The page document itself is untouched -- the reference simply dangles
    // and resolves through resolvePagePanel to "missing" on its next read.
    expect(useApp.getState().pages[0].panels[0].figureId).toBe("figure-1");
  });

  it("does not delete when the user cancels the confirm", async () => {
    useApp.setState({ editableFigures: [figure()] });
    vi.mocked(askConfirm).mockResolvedValue(false);
    render(<EditableFiguresSection />);
    fireEvent.click(screen.getByTitle("delete editable figure (undo available)"));
    await Promise.resolve();
    expect(useApp.getState().editableFigures).toHaveLength(1);
  });
});
