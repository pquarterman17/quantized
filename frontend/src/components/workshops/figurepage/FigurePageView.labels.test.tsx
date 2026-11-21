// a11y 1.3.1 / 4.1.2: every form control in the multi-panel export window must
// have an accessible name (a sibling <label> without htmlFor named nothing).
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import FigurePageView from "./FigurePageView";
import { useFigurePage } from "./useFigurePage";

vi.mock("../../../store/useApp", () => ({
  useApp: (selector: (state: { setFigurePageOpen: () => void }) => unknown) =>
    selector({ setFigurePageOpen: vi.fn() }),
}));
vi.mock("./useFigurePage", () => ({ useFigurePage: vi.fn() }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
vi.mock("./SlotGrid", () => ({ default: () => null, PANEL_SOURCE_MIME: "x" }));

const fn = () => vi.fn();
function state() {
  return {
    rows: 2, cols: 2, setGrid: fn(), slots: [{ source: { kind: "window", id: "w" }, label: null, title: null }],
    labels: ["(a)"], sourceStatuses: [], selected: 0, setSelected: fn(), assign: fn(), assignToNext: fn(),
    moveSlot: fn(), clear: fn(), setSlotLabel: fn(), setSlotTitle: fn(), editSlot: fn(), saveSlotAsFigure: fn(),
    promoteSlot: fn(), duplicateForPage: fn(), labelFormat: "(a)", setLabelFormat: fn(), labelPos: "nw",
    setLabelPos: fn(), style: "default", setStyle: fn(), fmt: "pdf", setFmt: fn(), dpi: 300, setDpi: fn(),
    greyscale: false, setGreyscale: fn(),
    layout: { rowGap: null, colGap: null, linkX: false, linkY: false, alignLabels: false, resizeMode: "constrained" },
    setLayout: fn(), windowSources: [], datasetSources: [], assignDataset: fn(), docSources: [], figureSources: [],
    pageDocument: null, name: "Untitled page", setName: fn(), everSaved: false, dirty: false, unresolvedSlots: [],
    save: fn(), saveAs: fn(), requestClose: vi.fn().mockResolvedValue(true), preview: null, error: null,
    busy: false, buildSpec: fn(), exportNow: fn(), copyNow: fn(),
  };
}

describe("FigurePageView form-control labelling", () => {
  it("gives every input and select an accessible name", () => {
    vi.mocked(useFigurePage).mockReturnValue(state() as unknown as ReturnType<typeof useFigurePage>);
    const { container } = render(<FigurePageView />);
    const controls = Array.from(container.querySelectorAll("input:not([type=checkbox]), select"));
    expect(controls.length).toBeGreaterThanOrEqual(11);
    for (const el of controls) {
      const named =
        el.getAttribute("aria-label") ||
        (el.id && container.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
        el.closest("label");
      expect(named, `${el.outerHTML.slice(0, 90)} has no accessible name`).toBeTruthy();
    }
  });
});
