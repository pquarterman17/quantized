// PlotToolbar — GUI_INTERACTION_PLAN #7 (plot-toolbar legibility: tooltips,
// aria, named groups) plus the shape dock flyout it already had (MAIN #27):
// a ▱ button opening a small flyout of Arrow/Line/Rectangle/Ellipse/Text box,
// each setting the store's drawShapeKind (the plot-side counterpart of the
// Insert menu). Buttons no longer carry a bare `title` — queries here use the
// accessible name (aria-label) instead of getByTitle.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPlotCommands } from "../../commands/plotCommands";
import { createFigureDocument } from "../../lib/figureDocument";
import { defaultPlotView } from "../../lib/plotview";
import { loadToolbarPrefs, saveToolbarPrefs } from "../../store/prefs";
import { useApp } from "../../store/useApp";
import PlotToolbar from "./PlotToolbar";

const ORIGINAL = useApp.getState();
const ORIGINAL_CLIPBOARD = navigator.clipboard;

// The global setup.ts afterEach already calls RTL's cleanup() (which
// properly unmounts the flyout's document.body portal) — a manual
// `document.body.innerHTML = ""` here would fight it (React still thinks
// its portal node is attached after the DOM is nuked out from under it).
afterEach(() => {
  useApp.setState(ORIGINAL, true);
  localStorage.removeItem("qz.toolbarPrefs");
  Object.defineProperty(navigator, "clipboard", { value: ORIGINAL_CLIPBOARD, configurable: true });
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.removeItem("qz.toolbarPrefs");
});

const NOOP = () => {};
const props = {
  onReset: NOOP,
  onSmartScale: NOOP,
  onSavePng: NOOP,
  onCopyData: NOOP,
  onCopyFigure: NOOP,
  onSnapshotWindow: NOOP,
};

describe("PlotToolbar — shape dock flyout (MAIN #27)", () => {
  it("renders the ▱ dock button", () => {
    render(<PlotToolbar {...props} />);
    expect(screen.getByRole("button", { name: "Draw Arrow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose drawing tool" })).toBeInTheDocument();
  });

  it("clicking the dock button opens a flyout listing all five entries", () => {
    render(<PlotToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose drawing tool" }));
    for (const label of [/arrow/i, /line/i, /rectangle/i, /ellipse/i, /text box/i]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("picking 'Arrow' sets the store's drawShapeKind and closes the flyout", () => {
    render(<PlotToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose drawing tool" }));
    fireEvent.click(screen.getByText(/arrow/i));
    expect(useApp.getState().drawShapeKind).toBe("arrow");
    expect(screen.queryByText(/rectangle/i)).toBeNull(); // flyout closed
  });

  it("picking 'Text box' sets drawShapeKind to 'textbox'", () => {
    render(<PlotToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose drawing tool" }));
    fireEvent.click(screen.getByText(/text box/i));
    expect(useApp.getState().drawShapeKind).toBe("textbox");
  });

  it("the dock button reads active while a draw mode is set", () => {
    useApp.setState({ drawShapeKind: "line" });
    render(<PlotToolbar {...props} />);
    expect(screen.getByRole("button", { name: "Draw Arrow" }).className).toMatch(/active/);
  });

  it("the main half repeats the last tool selected from the arrow menu", () => {
    render(<PlotToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose drawing tool" }));
    fireEvent.click(screen.getByText(/text box/i));
    useApp.getState().setDrawShapeKind(null);
    fireEvent.click(screen.getByRole("button", { name: "Draw Text box" }));
    expect(useApp.getState().drawShapeKind).toBe("textbox");
  });
});

describe("PlotToolbar — accessibility (GUI_INTERACTION_PLAN #7)", () => {
  it("gives every tool button an aria-label naming the tool", () => {
    render(<PlotToolbar {...props} />);
    for (const name of ["Pointer", "Zoom", "Pan", "Data Cursor", "Measure", "Integrate", "Peak / FWHM"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("marks the active tool with aria-pressed=true and the others false", () => {
    useApp.setState({ plotTool: "zoom" });
    render(<PlotToolbar {...props} />);
    expect(screen.getByRole("button", { name: "Zoom" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Pan" })).toHaveAttribute("aria-pressed", "false");
  });

  it("marks mode toggles (stack/inset/polar/stats) with aria-pressed reflecting store state", () => {
    useApp.setState({ insetMode: true, polarMode: false });
    render(<PlotToolbar {...props} />);
    expect(screen.getByRole("button", { name: "Magnifier Inset" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Polar Plot" })).toHaveAttribute("aria-pressed", "false");
  });

  it("does NOT set aria-pressed on plain action buttons (they aren't toggles)", () => {
    render(<PlotToolbar {...props} />);
    expect(screen.getByRole("button", { name: "Save PNG" })).not.toHaveAttribute("aria-pressed");
    expect(screen.getByRole("button", { name: "Copy Data" })).not.toHaveAttribute("aria-pressed");
  });

  it("groups buttons under named ARIA groups (Navigate/Inspect/Analyze/Annotate/View/Export)", () => {
    render(<PlotToolbar {...props} />);
    for (const name of ["Navigate", "Inspect", "Analyze", "Annotate", "View", "Export"]) {
      expect(screen.getByRole("group", { name })).toBeInTheDocument();
    }
  });

  it("carries a rich tooltip contract (data-tip/data-tip-desc/data-tip-key) on a shortcut-bound tool", () => {
    render(<PlotToolbar {...props} />);
    const zoom = screen.getByRole("button", { name: "Zoom" });
    expect(zoom).toHaveAttribute("data-tip", "Zoom");
    expect(zoom).toHaveAttribute("data-tip-desc", "Drag a box to zoom into a region");
    expect(zoom).toHaveAttribute("data-tip-key", "Z");
  });

  it("omits data-tip-key for tools with no single-key shortcut", () => {
    render(<PlotToolbar {...props} />);
    expect(screen.getByRole("button", { name: "Pointer" })).not.toHaveAttribute("data-tip-key");
  });
});

describe("PlotToolbar — disabled-with-reason (GUI_INTERACTION_PLAN #7)", () => {
  it("disables Reset View when there is nothing to reset (no xLim/yLim set)", () => {
    render(<PlotToolbar {...props} />);
    const btn = screen.getByRole("button", { name: "Reset View" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("data-tip-desc", "Nothing to reset — the view is already at its default extents");
  });

  it("enables Reset View once a manual x or y limit is set", () => {
    useApp.setState({ xLim: [0, 10] });
    render(<PlotToolbar {...props} />);
    const btn = screen.getByRole("button", { name: "Reset View" });
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute("data-tip-desc", "Restore the default zoom and pan");
  });

  it("disables Copy Figure when the browser has no Clipboard image API (jsdom's default)", () => {
    render(<PlotToolbar {...props} />);
    const btn = screen.getByRole("button", { name: "Copy Figure" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("data-tip-desc", "Clipboard image copy isn't supported in this browser");
  });

  it("runs the publication Copy Figure action directly from the toolbar", () => {
    const copy = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { write: vi.fn() }, configurable: true });
    vi.stubGlobal("ClipboardItem", class {});
    render(<PlotToolbar {...props} onCopyFigure={copy} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Figure" }));
    expect(copy).toHaveBeenCalledTimes(1);
  });
});

describe("PlotToolbar — toolbar options flyout + persisted group-label prefs", () => {
  it("shows group captions by default", () => {
    render(<PlotToolbar {...props} />);
    expect(screen.getByText("Navigate")).toBeInTheDocument();
  });

  it("toggling 'Group labels' from the ... flyout hides the captions and persists the choice", () => {
    render(<PlotToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Toolbar Options" }));
    fireEvent.click(screen.getByText(/group labels/i));
    expect(screen.queryByText("Navigate")).toBeNull();
    expect(loadToolbarPrefs().showGroupLabels).toBe(false);
  });

  it("a fresh mount honors a previously persisted showGroupLabels: false", () => {
    saveToolbarPrefs({ showGroupLabels: false });
    render(<PlotToolbar {...props} />);
    expect(screen.queryByText("Navigate")).toBeNull();
    // the group's ARIA name still works even with captions hidden
    expect(screen.getByRole("group", { name: "Navigate" })).toBeInTheDocument();
  });
});

// S1 (a): a facet binding (or a saved x-break) mounts its panels with
// `stackMode` off — a plot recipe applies facets that way. The Stack toggle
// used to read `stackMode` alone, so it read OFF over a facet grid and pressing
// it cleared the facet INTO the plain per-channel stack. It now reads the
// layout on screen and, when one is showing, turns it off in one undo entry.
describe("PlotToolbar — the Stack toggle follows the multi-panel layout (S1 a)", () => {
  const stackBtn = () => screen.getByRole("button", { name: "Stack Channels" });
  const savedBreakWindow = () =>
    useApp.setState({
      plotWindows: [
        {
          id: "w1", kind: "plot", title: "", datasetId: "d1",
          geometry: { x: 0, y: 0, w: 480, h: 360 }, z: 0, winState: "normal",
          bg: "theme", linkGroup: null, pinned: false, view: defaultPlotView(),
          document: createFigureDocument({
            id: "fig-w1", name: "w1", datasetId: "d1", view: defaultPlotView(), axisBreaks: { x: [[1, 2]] },
          }),
        },
      ],
      focusedWindowId: "w1",
    });

  it("reads ON over a facet binding with stackMode off, and says pressing returns one plot", () => {
    useApp.setState({ stackMode: false, facetKey: 0, composition: null });
    render(<PlotToolbar {...props} />);
    expect(stackBtn()).toHaveAttribute("aria-pressed", "true");
    expect(stackBtn()).toHaveAttribute("data-tip-desc", "Return to a single overlaid plot");
  });

  it("pressing it over that facet grid turns the grid off — facetKey and stackMode cleared, one undo entry", () => {
    useApp.setState({ stackMode: false, facetKey: 0, composition: null });
    const before = useApp.getState().history.length;
    render(<PlotToolbar {...props} />);
    fireEvent.click(stackBtn());
    const s = useApp.getState();
    expect([s.facetKey, s.stackMode, s.composition]).toEqual([null, false, null]);
    expect(s.history).toHaveLength(before + 1);
    s.undo();
    expect([useApp.getState().facetKey, useApp.getState().stackMode]).toEqual([0, false]);
  });

  it("a saved x-break with stackMode off reads ON too, and pressing it removes the break", () => {
    useApp.setState({ stackMode: false, facetKey: null, composition: null });
    savedBreakWindow();
    render(<PlotToolbar {...props} />);
    expect(stackBtn()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(stackBtn());
    const w = useApp.getState().plotWindows[0];
    expect(w.kind === "plot" ? w.document?.plot.axisBreaks.x : null).toEqual([]);
    expect(useApp.getState().stackMode).toBe(false);
  });

  it("reads OFF over a plain overlay, and pressing it stacks the channels", () => {
    useApp.setState({ stackMode: false, facetKey: null, composition: null, plotWindows: [], focusedWindowId: null });
    render(<PlotToolbar {...props} />);
    expect(stackBtn()).toHaveAttribute("aria-pressed", "false");
    expect(stackBtn()).toHaveAttribute("data-tip-desc", "Show each channel in its own panel");
    fireEvent.click(stackBtn());
    expect(useApp.getState().stackMode).toBe(true);
  });

  it("the command-palette toggle makes the same choice over a facet grid", () => {
    useApp.setState({ stackMode: false, facetKey: 0, composition: null });
    buildPlotCommands(useApp.getState).find((c) => c.id === "stacked")?.run();
    expect([useApp.getState().facetKey, useApp.getState().stackMode]).toEqual([null, false]);
  });
});
