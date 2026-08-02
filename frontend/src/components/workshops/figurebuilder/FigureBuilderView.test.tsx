import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FigureBuilderView from "./FigureBuilderView";
import { useFigureBuilder } from "./useFigureBuilder";

const setOpen = vi.fn();

vi.mock("../../../store/useApp", () => ({
  useApp: (selector: (state: { setFigureBuilderOpen: typeof setOpen }) => unknown) =>
    selector({ setFigureBuilderOpen: setOpen }),
}));

vi.mock("./useFigureBuilder", () => ({
  FIGURE_FORMATS: ["png"],
  FIGURE_STYLES: ["default"],
  useFigureBuilder: vi.fn(),
}));

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) => (
    <section aria-label={title}><button onClick={onClose}>Window close</button>{children}</section>
  ),
}));

vi.mock("./PropertyPanels", () => ({ default: () => null }));

const figureState = {
  frozen: false,
  canonical: false,
  documentName: null,
  dirty: false,
  apply: vi.fn(),
  cancel: vi.fn(),
  data: { labels: ["x", "y"] },
  fmt: "png",
  setFmt: vi.fn(),
  style: "default",
  setStyle: vi.fn(),
  dpi: 300,
  setDpi: vi.fn(),
  title: "",
  setTitle: vi.fn(),
  xLabel: "",
  setXLabel: vi.fn(),
  yLabel: "",
  setYLabel: vi.fn(),
  overrides: {},
  setOverrides: vi.fn(),
  focusGroup: null,
  saveAsFigure: vi.fn(),
  saveStyleTemplate: vi.fn(),
  graphTemplates: [],
  applyStyleTemplate: vi.fn(),
  exportNow: vi.fn(),
  error: null,
  preview: null,
  hitmap: null,
  busy: false,
  textOf: vi.fn(),
  selectElement: vi.fn(),
  editElementText: vi.fn(),
  dragElement: vi.fn(),
};

beforeEach(() => {
  vi.mocked(useFigureBuilder).mockReturnValue(
    figureState as unknown as ReturnType<typeof useFigureBuilder>,
  );
});

describe("Publication Preview role cues", () => {
  it("names the surface and explains that it does not edit the Stage plot", () => {
    render(<FigureBuilderView />);

    expect(screen.getByRole("region", { name: "Publication preview" })).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Publication preview behavior" })).toHaveTextContent(
      "do not change the editable Stage plot",
    );
  });

  it("identifies a frozen-data preview", () => {
    vi.mocked(useFigureBuilder).mockReturnValue({
      ...figureState,
      frozen: true,
    } as unknown as ReturnType<typeof useFigureBuilder>);

    render(<FigureBuilderView />);

    expect(screen.getByRole("region", { name: "Publication preview (frozen data)" })).toBeInTheDocument();
  });

  it("labels a canonical draft and exposes Apply/Cancel", () => {
    vi.mocked(useFigureBuilder).mockReturnValue({
      ...figureState,
      canonical: true,
      documentName: "Device figure",
      dirty: true,
    } as unknown as ReturnType<typeof useFigureBuilder>);
    render(<FigureBuilderView />);
    expect(screen.getByRole("region", { name: /Publication preview.*Device figure.*modified/ })).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Publication preview behavior" })).toHaveTextContent("Apply updates this figure");
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Window close" }));
    expect(figureState.cancel).toHaveBeenCalled();
  });
});
