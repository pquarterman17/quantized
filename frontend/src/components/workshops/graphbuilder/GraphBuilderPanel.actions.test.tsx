import type { ButtonHTMLAttributes, ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  Checkbox: ({
    checked,
    onChange,
    children,
  }: {
    checked: boolean;
    onChange?: (v: boolean) => void;
    children?: ReactNode;
  }) => (
    <label>
      <input type="checkbox" checked={checked} onChange={(e) => onChange?.(e.target.checked)} />
      {children}
    </label>
  ),
  SegmentedControl: <T extends string>({
    options,
    value,
    onChange,
  }: {
    options: { value: T; label: string }[];
    value: T;
    onChange?: (v: T) => void;
  }) => (
    <div role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          onClick={() => onChange?.(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  ),
}));

const builderState = {
  hasData: true,
  datasetId: "d1",
  spec: {},
  mark: "scatter",
  family: "xy",
  marks: ["scatter"],
  showMarkers: false,
  setShowMarkers: vi.fn(),
  stepMode: "post",
  setStepMode: vi.fn(),
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

  it("activates both explicit destinations from the keyboard", async () => {
    const user = userEvent.setup();
    render(<GraphBuilderPanel />);
    const create = screen.getByRole("button", { name: "Create New Plot" });
    const apply = screen.getByRole("button", { name: "Apply to Current Plot" });

    create.focus();
    await user.keyboard("{Enter}");
    apply.focus();
    await user.keyboard(" ");

    expect(createNewPlot).toHaveBeenCalledOnce();
    expect(applyToCurrent).toHaveBeenCalledOnce();
  });

  it("keeps a hard-incompatible Publication Preview transition disabled", () => {
    const openInFigureBuilder = vi.fn();
    vi.mocked(useGraphBuilder).mockReturnValue({
      ...builderState,
      canOpenFigureBuilder: false,
      figureBuilderReason: "Faceted plots need a multi-panel contract first.",
      openInFigureBuilder,
    });
    render(<GraphBuilderPanel />);

    const preview = screen.getByRole("button", { name: "Publication Preview" });
    expect(preview).toBeDisabled();
    expect(preview).toHaveAttribute("title", "Faceted plots need a multi-panel contract first.");
    fireEvent.click(preview);
    expect(openInFigureBuilder).not.toHaveBeenCalled();
  });
});

// GAP_PLOTTYPES: the "step" mark's UI (Markers toggle + pre/post/mid select).
describe("Graph Builder step mark UI", () => {
  it("hides the Markers toggle and step select for scatter (the default builderState)", () => {
    render(<GraphBuilderPanel />);
    expect(screen.queryByText("Markers")).not.toBeInTheDocument();
  });

  it("shows the Markers toggle (but no step select) for a line mark", () => {
    vi.mocked(useGraphBuilder).mockReturnValue({ ...builderState, mark: "line", marks: ["scatter", "line", "step"] });
    render(<GraphBuilderPanel />);
    expect(screen.getByText("Markers")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("shows both the Markers toggle and the pre/post/mid step select for a step mark", () => {
    vi.mocked(useGraphBuilder).mockReturnValue({
      ...builderState,
      mark: "step",
      marks: ["scatter", "line", "step"],
      stepMode: "post",
    });
    render(<GraphBuilderPanel />);
    expect(screen.getByText("Markers")).toBeInTheDocument();
    const tabs = screen.getByRole("tablist");
    expect(tabs).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "post" })).toHaveAttribute("aria-selected", "true");
  });

  it("wires the Markers checkbox and step select to their setters", () => {
    const setShowMarkers = vi.fn();
    const setStepMode = vi.fn();
    vi.mocked(useGraphBuilder).mockReturnValue({
      ...builderState,
      mark: "step",
      marks: ["scatter", "line", "step"],
      stepMode: "post",
      setShowMarkers,
      setStepMode,
    });
    render(<GraphBuilderPanel />);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(setShowMarkers).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole("tab", { name: "mid" }));
    expect(setStepMode).toHaveBeenCalledWith("mid");
  });

  it("uses the step glyph in the mark label", () => {
    vi.mocked(useGraphBuilder).mockReturnValue({
      ...builderState,
      mark: "step",
      marks: ["scatter", "line", "step"],
    });
    render(<GraphBuilderPanel />);
    expect(screen.getByText("▤ step")).toBeInTheDocument();
  });
});
