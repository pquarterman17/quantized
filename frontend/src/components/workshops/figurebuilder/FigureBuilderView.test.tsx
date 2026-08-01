import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
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
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));

vi.mock("./PropertyPanels", () => ({ default: () => null }));

const figureState = {
  frozen: false,
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
});
