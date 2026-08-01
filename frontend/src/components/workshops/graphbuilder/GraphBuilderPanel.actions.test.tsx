import type { ButtonHTMLAttributes, ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GraphBuilderPanel from "./GraphBuilderPanel";
import { useGraphBuilder, type GraphBuilderState } from "./useGraphBuilder";

const setOpen = vi.fn();
const createNewPlot = vi.fn();
const applyToCurrent = vi.fn();

vi.mock("../../../store/useApp", () => ({
  useApp: (selector: (state: { setGraphBuilderOpen: typeof setOpen }) => unknown) =>
    selector({ setGraphBuilderOpen: setOpen }),
}));

vi.mock("./useGraphBuilder", () => ({ useGraphBuilder: vi.fn() }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
vi.mock("./PlotSpecBar", () => ({ default: () => null }));
vi.mock("./ZoneWell", () => ({ default: () => null }));
vi.mock("./GraphPreview", () => ({ default: () => null }));
vi.mock("../../primitives", () => ({
  Button: ({ variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button data-variant={variant} {...props} />
  ),
}));

const builderState = {
  hasData: true,
  datasetId: "d1",
  spec: {},
  mark: "scatter",
  family: "xy",
  marks: ["scatter"],
  render: {},
  options: [],
  chips: () => [],
  assign: vi.fn(),
  remove: vi.fn(),
  moveY: vi.fn(),
  cycle: vi.fn(),
  reset: vi.fn(),
  canPlot: true,
  createNewPlot,
  canApplyToCurrent: true,
  applyToCurrent,
  canOpenFigureBuilder: true,
  figureBuilderReason: null,
  figureBuilderLosses: [],
  openInFigureBuilder: vi.fn(),
  savedSpecs: [],
  activeSpec: null,
  dirty: false,
  saveActive: vi.fn(),
  saveAs: vi.fn(),
  openSpec: vi.fn(),
  duplicateSpec: vi.fn(),
  renameSpec: vi.fn(),
  deleteSpec: vi.fn(),
  exportPlot: vi.fn(),
} as unknown as GraphBuilderState;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useGraphBuilder).mockReturnValue(builderState);
});

describe("Graph Builder plot destinations", () => {
  it("makes Create New Plot the primary action and keeps Apply explicit", () => {
    render(<GraphBuilderPanel />);

    const create = screen.getByRole("button", { name: "Create New Plot" });
    const apply = screen.getByRole("button", { name: "Apply to Current Plot" });
    expect(create).toHaveAttribute("data-variant", "primary");
    expect(apply).not.toBeDisabled();

    fireEvent.click(create);
    fireEvent.click(apply);
    expect(createNewPlot).toHaveBeenCalledOnce();
    expect(applyToCurrent).toHaveBeenCalledOnce();
  });

  it("disables Apply when the hook reports no compatible focused plot", () => {
    vi.mocked(useGraphBuilder).mockReturnValue({
      ...builderState,
      canApplyToCurrent: false,
    });

    render(<GraphBuilderPanel />);

    expect(screen.getByRole("button", { name: "Apply to Current Plot" })).toBeDisabled();
  });

  it("previews the compatibility warning in the Publication Preview tooltip", () => {
    vi.mocked(useGraphBuilder).mockReturnValue({
      ...builderState,
      figureBuilderLosses: ["axis tick spacing", "annotations"],
    });

    render(<GraphBuilderPanel />);

    expect(screen.getByRole("button", { name: "Publication Preview" })).toHaveAttribute(
      "title",
      "Preview requires confirmation: axis tick spacing, annotations",
    );
  });
});
