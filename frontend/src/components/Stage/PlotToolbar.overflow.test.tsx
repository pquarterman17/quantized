// GUI audit P1: at 125% scaling, in a default Graph Window, or in a narrow
// window the plot dock is wider than its stage, and the groups past the edge
// used to be clipped and unclickable. The trailing groups now collapse into the
// "⋯" menu. jsdom has no layout, so the stage and group widths are stubbed on
// the prototype getters the fit hook reads; the real-browser side of the same
// promise (every button inside the stage) is e2e/specs/layout-fit.spec.ts.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../../store/useApp";
import PlotToolbar from "./PlotToolbar";
import { fitToolGroups } from "./plotToolbarOverflow";

const ORIGINAL = useApp.getState();

afterEach(() => {
  vi.restoreAllMocks();
  useApp.setState(ORIGINAL, true);
  localStorage.removeItem("qz.toolbarPrefs");
});

// Natural widths of the six groups, the "⋯" button and a separator.
const GROUP_W: Record<string, number> = { Navigate: 110, Inspect: 145, Analyze: 110, Annotate: 60, View: 215, Export: 145 };

function stubLayout(stageWidth: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.querySelector(":scope > .qzk-float-tools") ? stageWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute("data-tool-group")) return GROUP_W[this.getAttribute("aria-label") ?? ""] ?? 0;
    if (this.hasAttribute("data-tool-opts")) return 32;
    if (this.classList.contains("qzk-tool-sep")) return 1;
    return 0;
  });
}

const calls: string[] = [];
const props = {
  onReset: () => calls.push("reset"),
  onSmartScale: () => calls.push("smart"),
  onSavePng: () => calls.push("png"),
  onCopyData: () => calls.push("copy"),
  onCopyFigure: () => calls.push("copy-figure"),
  onSnapshotWindow: () => calls.push("snapwin"),
};

describe("fitToolGroups", () => {
  const chrome = { pad: 10, sep: 5, gap: 3, opts: 32 };

  it("keeps every group when the dock fits", () => {
    expect(fitToolGroups(2000, [100, 100, 100], chrome)).toBe(3);
  });

  it("drops trailing groups that would cross the edge", () => {
    // 10 + 32 = 42; +100+5+6 = 153; +100+5+6 = 264 > 200
    expect(fitToolGroups(200, [100, 100, 100], chrome)).toBe(1);
    expect(fitToolGroups(264, [100, 100, 100], chrome)).toBe(2);
  });

  it("never hides the first group, even when nothing fits", () => {
    expect(fitToolGroups(10, [100, 100], chrome)).toBe(1);
  });
});

describe("PlotToolbar — overflow menu (GUI audit P1)", () => {
  it("shows every group when the stage is wide enough", () => {
    stubLayout(2000);
    render(<PlotToolbar {...props} />);
    for (const name of ["Navigate", "Inspect", "Analyze", "Annotate", "View", "Export"]) {
      expect(screen.getByRole("group", { name })).toBeInTheDocument();
    }
  });

  it("collapses the groups that do not fit and keeps each button reachable from the ⋯ menu", () => {
    // 500 - 24 margin = 476: Navigate..Annotate fit (461), View does not.
    stubLayout(500);
    render(<PlotToolbar {...props} />);
    expect(screen.getByRole("group", { name: "Annotate" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "View" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save PNG" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Toolbar Options" }));
    const menu = screen.getByRole("menu");
    // Toggles render as menuitemcheckbox, plain actions as menuitem: match text.
    for (const name of ["Reset View", "Smart Auto-scale", "Stack Channels", "Magnifier Inset", "Polar Plot", "Statistics View", "Save PNG", "Copy Data", "Copy Figure", "Snapshot Window"]) {
      expect(within(menu).getByText(new RegExp(name))).toBeInTheDocument();
    }
    fireEvent.click(within(menu).getByText(/Save PNG/));
    expect(calls).toContain("png");
  });

  it("carries a hidden button's disabled state into its menu item", () => {
    stubLayout(500);
    render(<PlotToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Toolbar Options" }));
    expect(screen.getByText(/Reset View/).closest("button")).toHaveAttribute("aria-disabled", "true");
  });

  it("offers the drawing tools when Annotate is collapsed", () => {
    // 300 - 24 = 276: only Navigate + Inspect fit (32 + 111 + 146 = 289 > 276 -> Navigate only).
    stubLayout(300);
    render(<PlotToolbar {...props} />);
    expect(screen.queryByRole("group", { name: "Inspect" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toolbar Options" }));
    fireEvent.click(screen.getByText(/Draw Ellipse/));
    expect(useApp.getState().drawShapeKind).toBe("ellipse");
  });
});
