// PlotToolbar — GUI_INTERACTION_PLAN #7 (plot-toolbar legibility: tooltips,
// aria, named groups) plus the shape dock flyout it already had (MAIN #27):
// a ▱ button opening a small flyout of Arrow/Line/Rectangle/Ellipse/Text box,
// each setting the store's drawShapeKind (the plot-side counterpart of the
// Insert menu). Buttons no longer carry a bare `title` — queries here use the
// accessible name (aria-label) instead of getByTitle.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadToolbarPrefs, saveToolbarPrefs } from "../../store/prefs";
import { useApp } from "../../store/useApp";
import PlotToolbar from "./PlotToolbar";

const ORIGINAL = useApp.getState();

// The global setup.ts afterEach already calls RTL's cleanup() (which
// properly unmounts the flyout's document.body portal) — a manual
// `document.body.innerHTML = ""` here would fight it (React still thinks
// its portal node is attached after the DOM is nuked out from under it).
afterEach(() => {
  useApp.setState(ORIGINAL, true);
  localStorage.removeItem("qz.toolbarPrefs");
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
  onSnapshot: NOOP,
  onSnapshotWindow: NOOP,
};

describe("PlotToolbar — shape dock flyout (MAIN #27)", () => {
  it("renders the ▱ dock button", () => {
    render(<PlotToolbar {...props} />);
    expect(screen.getByRole("button", { name: "Draw Shape" })).toBeInTheDocument();
  });

  it("clicking the dock button opens a flyout listing all five entries", () => {
    render(<PlotToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Draw Shape" }));
    for (const label of [/arrow/i, /line/i, /rectangle/i, /ellipse/i, /text box/i]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("picking 'Arrow' sets the store's drawShapeKind and closes the flyout", () => {
    render(<PlotToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Draw Shape" }));
    fireEvent.click(screen.getByText(/arrow/i));
    expect(useApp.getState().drawShapeKind).toBe("arrow");
    expect(screen.queryByText(/rectangle/i)).toBeNull(); // flyout closed
  });

  it("picking 'Text box' sets drawShapeKind to 'textbox'", () => {
    render(<PlotToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Draw Shape" }));
    fireEvent.click(screen.getByText(/text box/i));
    expect(useApp.getState().drawShapeKind).toBe("textbox");
  });

  it("the dock button reads active while a draw mode is set", () => {
    useApp.setState({ drawShapeKind: "line" });
    render(<PlotToolbar {...props} />);
    expect(screen.getByRole("button", { name: "Draw Shape" }).className).toMatch(/active/);
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

  it("disables Copy Image when the browser has no Clipboard image API (jsdom's default)", () => {
    render(<PlotToolbar {...props} />);
    const btn = screen.getByRole("button", { name: "Copy Image" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("data-tip-desc", "Clipboard image copy isn't supported in this browser");
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
