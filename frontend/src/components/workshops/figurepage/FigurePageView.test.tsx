// Figure Page composer view — DOM-layer coverage of the page-output controls
// (PRIMARY_SOFTWARE_AUDIT_PLAN P3.3's "Greyscale" checkbox). Mirrors
// FigureBuilderView.test.tsx's established pattern exactly: mock the state
// hook and the ToolWindow chrome, render the view, and assert on what the
// user can actually see and click — the hook's own behaviour (what greyscale
// does to the export/preview/copy request) is pinned separately in
// useFigurePage.test.ts.
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FigurePageView from "./FigurePageView";
import { useFigurePage } from "./useFigurePage";

const setOpen = vi.fn();

vi.mock("../../../store/useApp", () => ({
  useApp: (selector: (state: { setFigurePageOpen: typeof setOpen }) => unknown) =>
    selector({ setFigurePageOpen: setOpen }),
}));

vi.mock("./useFigurePage", () => ({ useFigurePage: vi.fn() }));

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) => (
    <section aria-label={title}>
      <button onClick={onClose}>Window close</button>
      {children}
    </section>
  ),
}));

vi.mock("./SlotGrid", () => ({
  default: () => null,
  PANEL_SOURCE_MIME: "application/x-qz-panel-source",
}));

const setGreyscale = vi.fn();

function pageState(over: Record<string, unknown> = {}) {
  return {
    rows: 2,
    cols: 2,
    setGrid: vi.fn(),
    slots: [],
    labels: [],
    sourceStatuses: [],
    selected: null,
    setSelected: vi.fn(),
    assign: vi.fn(),
    assignToNext: vi.fn(),
    moveSlot: vi.fn(),
    clear: vi.fn(),
    setSlotLabel: vi.fn(),
    setSlotTitle: vi.fn(),
    editSlot: vi.fn(),
    saveSlotAsFigure: vi.fn(),
    promoteSlot: vi.fn(),
    duplicateForPage: vi.fn(),
    labelFormat: "(a)",
    setLabelFormat: vi.fn(),
    labelPos: "nw",
    setLabelPos: vi.fn(),
    style: "default",
    setStyle: vi.fn(),
    fmt: "pdf",
    setFmt: vi.fn(),
    dpi: 300,
    setDpi: vi.fn(),
    greyscale: false,
    setGreyscale,
    layout: { rowGap: null, colGap: null, linkX: false, linkY: false, alignLabels: false, resizeMode: "constrained" },
    setLayout: vi.fn(),
    windowSources: [],
    docSources: [],
    figureSources: [],
    pageDocument: null,
    name: "Untitled page",
    setName: vi.fn(),
    everSaved: false,
    dirty: false,
    unresolvedSlots: [],
    save: vi.fn(),
    saveAs: vi.fn(),
    requestClose: vi.fn().mockResolvedValue(true),
    preview: null,
    error: null,
    busy: false,
    buildSpec: vi.fn(),
    exportNow: vi.fn(),
    copyNow: vi.fn(),
    ...over,
  };
}

function renderView(over: Record<string, unknown> = {}) {
  vi.mocked(useFigurePage).mockReturnValue(pageState(over) as unknown as ReturnType<typeof useFigurePage>);
  return render(<FigurePageView />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FigurePageView page-wide greyscale control (P3.3)", () => {
  it("offers a Greyscale checkbox beside the format/style/DPI controls", () => {
    renderView();
    const box = screen.getByLabelText("Greyscale");
    expect(box).toHaveProperty("type", "checkbox");
    expect(box).not.toBeChecked();
  });

  it("ticking it turns the page-wide option on", () => {
    renderView();
    fireEvent.click(screen.getByLabelText("Greyscale"));
    expect(setGreyscale).toHaveBeenCalledWith(true);
  });

  it("reflects a page that already has greyscale on, and unticking turns it off", () => {
    renderView({ greyscale: true });
    const box = screen.getByLabelText("Greyscale");
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(setGreyscale).toHaveBeenCalledWith(false);
  });
});
