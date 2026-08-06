import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FigureBuilderView from "./FigureBuilderView";
import { useFigureBuilder } from "./useFigureBuilder";

const setOpen = vi.fn();
const cancelPublicationPreview = vi.fn();

vi.mock("../../../store/useApp", () => ({
  useApp: (selector: (state: { setFigureBuilderOpen: typeof setOpen }) => unknown) =>
    selector({ setFigureBuilderOpen: setOpen }),
}));

vi.mock("./useFigureBuilder", () => ({
  FIGURE_FORMATS: ["png"],
  FIGURE_STYLES: ["default"],
  useFigureBuilder: vi.fn(),
}));

// Item 1: the canonical Cancel/ToolWindow-close paths now route through the
// discard-gate wrapper instead of calling the hook's `cancel` directly.
vi.mock("../../windows/figureLifecycleUi", () => ({
  cancelPublicationPreview: (...args: unknown[]) => cancelPublicationPreview(...args) as Promise<void>,
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
  publicationTarget: null,
  dirty: false,
  canApply: false,
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
  // F2.3b: series editing is canonical-only; the default (legacy) mock state
  // has nothing plotted, matching a fresh (non-canonical) figureState.
  seriesChannels: [],
  seriesStyles: {},
  hiddenChannels: [],
  seriesLabels: {},
  seriesErrors: [],
  setSeriesStyle: vi.fn(),
  setSeriesHidden: vi.fn(),
  moveSeries: vi.fn(),
  focusGroup: null,
  saveAsFigure: vi.fn(),
  saveStyleTemplate: vi.fn(),
  graphTemplates: [],
  applyStyleTemplate: vi.fn(),
  exportNow: vi.fn(),
  error: null,
  canonicalReadiness: null,
  canExport: true,
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
  cancelPublicationPreview.mockReset();
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
      publicationTarget: "window",
      dirty: true,
      canApply: true,
    } as unknown as ReturnType<typeof useFigureBuilder>);
    render(<FigureBuilderView />);
    expect(screen.getByRole("region", { name: /Publication preview.*Device figure.*modified/ })).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Publication preview behavior" })).toHaveTextContent("Apply updates this figure");
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    // Item 1: the discard gate wrapper, not the hook's `cancel`, owns both
    // canonical close paths now — `cancel` is kept on the hook for
    // tests/back-compat but the view no longer calls it directly.
    fireEvent.click(screen.getByRole("button", { name: "Window close" }));
    expect(cancelPublicationPreview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelPublicationPreview).toHaveBeenCalledTimes(2);
    expect(figureState.cancel).not.toHaveBeenCalled();
  });

  // F2.3b: the view builds a `series` prop for PropertyPanels only once
  // canonical AND something is plotted; PropertyPanels itself is mocked here
  // (its own tests cover the group's content), so this just pins that the
  // construction never throws on either shape.
  it("builds the canonical series prop without throwing once channels are plotted", () => {
    vi.mocked(useFigureBuilder).mockReturnValue({
      ...figureState,
      canonical: true,
      seriesChannels: [0, 1],
      seriesStyles: { 0: { color: "--series-2" } },
    } as unknown as ReturnType<typeof useFigureBuilder>);
    expect(() => render(<FigureBuilderView />)).not.toThrow();
  });

  it("labels an unchanged detached draft as creating an editable figure", () => {
    vi.mocked(useFigureBuilder).mockReturnValue({
      ...figureState,
      canonical: true,
      documentName: "Graph Builder plot",
      publicationTarget: "new-editable",
      dirty: false,
      canApply: true,
    } as unknown as ReturnType<typeof useFigureBuilder>);
    render(<FigureBuilderView />);

    expect(screen.getByRole("note", { name: "Publication preview behavior" })).toHaveTextContent(
      "Apply creates and saves an editable figure",
    );
    expect(screen.getByRole("button", { name: "Create Editable Figure" })).toBeEnabled();
  });

  it("shows canonical readiness failures accessibly without the legacy dataset prompt", () => {
    vi.mocked(useFigureBuilder).mockReturnValue({
      ...figureState,
      canonical: true,
      documentName: "Missing figure",
      publicationTarget: "new-editable",
      dirty: true,
      canApply: false,
      data: null,
      canonicalReadiness: "missing-source",
      canExport: false,
      error: "source unavailable: FigureDocument requires dataset gone",
    } as unknown as ReturnType<typeof useFigureBuilder>);
    render(<FigureBuilderView />);

    expect(screen.getByRole("alert")).toHaveTextContent("source unavailable");
    expect(screen.queryByText("Select a dataset to preview a figure.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export PNG" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create Editable Figure" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  // Item 3b: a doomed/blocked window-target session gets an inline reason,
  // not just a disabled button with no explanation.
  it("shows the apply-blocked reason inline and on the Apply button when target liveness blocks it", () => {
    vi.mocked(useFigureBuilder).mockReturnValue({
      ...figureState,
      canonical: true,
      documentName: "Device figure",
      publicationTarget: "window",
      dirty: true,
      canApply: false,
      applyBlockedReason: "focus the previewed plot window to apply",
    } as unknown as ReturnType<typeof useFigureBuilder>);
    render(<FigureBuilderView />);

    expect(screen.getByRole("alert")).toHaveTextContent("focus the previewed plot window to apply");
    const applyButton = screen.getByRole("button", { name: "Apply" });
    expect(applyButton).toBeDisabled();
    expect(applyButton).toHaveAttribute("title", "focus the previewed plot window to apply");
  });

  // Item 11: a disabled <button> has `pointer-events:none` (.qz-btn:disabled),
  // so its own `title` attribute never gets a chance to show a tooltip — the
  // title has to live on a wrapping element instead.
  it("gives the disabled Export button an explanatory tooltip via a wrapping span", () => {
    vi.mocked(useFigureBuilder).mockReturnValue({
      ...figureState,
      canonical: true,
      canExport: false,
      error: "figure configuration is not previewable: grouped figures cannot use a secondary Y axis",
    } as unknown as ReturnType<typeof useFigureBuilder>);
    render(<FigureBuilderView />);

    const exportButton = screen.getByRole("button", { name: "Export PNG" });
    expect(exportButton).toBeDisabled();
    expect(exportButton).not.toHaveAttribute("title");
    expect(exportButton.closest("span")).toHaveAttribute(
      "title",
      "figure configuration is not previewable: grouped figures cannot use a secondary Y axis",
    );
  });

  it("falls back to a generic export-blocked tooltip when there is no error message", () => {
    vi.mocked(useFigureBuilder).mockReturnValue({
      ...figureState,
      canonical: true,
      canExport: false,
      error: null,
    } as unknown as ReturnType<typeof useFigureBuilder>);
    render(<FigureBuilderView />);

    expect(screen.getByRole("button", { name: "Export PNG" }).closest("span")).toHaveAttribute(
      "title",
      "figure is not ready to export",
    );
  });

  it("leaves the Export button tooltip-free when it is enabled", () => {
    render(<FigureBuilderView />); // default figureState: canonical=false -> never disabled
    expect(screen.getByRole("button", { name: "Export PNG" }).closest("span")).not.toHaveAttribute("title");
  });
});

// Item 12: the DPI field must not silently snap an invalid/out-of-range
// keystroke to 300, and must not commit a value the export request can't use.
describe("Publication Preview DPI field", () => {
  it("only commits DPI when the typed value is finite and within [10, 1200]", () => {
    render(<FigureBuilderView />);
    const dpiField = screen.getByDisplayValue("300") as HTMLInputElement;

    fireEvent.change(dpiField, { target: { value: "abc" } });
    expect(figureState.setDpi).not.toHaveBeenCalled();
    expect(dpiField).toHaveValue("abc"); // self-corrects later, not snapped to 300

    fireEvent.change(dpiField, { target: { value: "-5" } });
    expect(figureState.setDpi).not.toHaveBeenCalled();

    fireEvent.change(dpiField, { target: { value: "5" } }); // below the 10 floor
    expect(figureState.setDpi).not.toHaveBeenCalled();

    fireEvent.change(dpiField, { target: { value: "5000" } }); // above the 1200 ceiling
    expect(figureState.setDpi).not.toHaveBeenCalled();

    fireEvent.change(dpiField, { target: { value: "600" } });
    expect(figureState.setDpi).toHaveBeenCalledExactlyOnceWith(600);
  });
});
