// OG18: Preferences ▸ Plot ▸ "Toolbar button labels" puts a short text name
// beside each plot-toolbar icon. Off (the default) must be today's DOM exactly;
// on must not double any accessible name, and must feed the overflow measure.

import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYZE_TOOLS, INSPECT_TOOLS, NAVIGATE_TOOLS, SMART_SCALE } from "../../lib/plotToolbarDefs";
import { loadToolbarPrefs, saveToolbarPrefs, toolbarPrefsSlot } from "../../store/prefs";
import { useApp } from "../../store/useApp";
import { preloadContextMenu } from "../overlays/ContextMenuLazy";
import PlotToolbar from "./PlotToolbar";

beforeAll(() => preloadContextMenu());
const ORIGINAL = useApp.getState();
beforeEach(() => localStorage.removeItem("qz.toolbarPrefs"));
afterEach(() => {
  vi.restoreAllMocks();
  useApp.setState(ORIGINAL, true);
  localStorage.removeItem("qz.toolbarPrefs");
});

const NOOP = () => {};
const props = { onReset: NOOP, onSmartScale: NOOP, onSavePng: NOOP, onCopyData: NOOP, onCopyFigure: NOOP, onSnapshotWindow: NOOP };

describe("PlotToolbar — button labels off (default)", () => {
  it("is icon-only: no label spans, no labelled class, today's accessible names", () => {
    const { container } = render(<PlotToolbar {...props} />);
    expect(container.querySelector(".qzk-tool-label")).toBeNull();
    expect(container.querySelector(".qzk-tool-btn.labelled")).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Data cursor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Smart auto-scale" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draw Arrow" }).textContent).toBe("");
  });
});

describe("PlotToolbar — button labels on", () => {
  beforeEach(() => saveToolbarPrefs({ showGroupLabels: true, showButtonLabels: true }));

  it("shows the short label beside each icon and keeps the accessible name single", () => {
    render(<PlotToolbar {...props} />);
    const zoom = screen.getByRole("button", { name: "Zoom" }); // exactly "Zoom", not "Zoom Zoom"
    expect(zoom).toHaveTextContent("Zoom");
    expect(zoom.textContent).toBe("Zoom");
    expect(screen.getByRole("button", { name: "Data cursor" })).toHaveTextContent(/^Cursor$/);
    expect(screen.getByRole("button", { name: "Smart auto-scale" })).toHaveTextContent(/^Auto-scale$/);
    expect(screen.getByRole("button", { name: "Draw Arrow" })).toHaveTextContent(/^Draw$/);
    // the ▾ chooser and ⋯ stay icon-only
    expect(screen.getByRole("button", { name: "Choose drawing tool" })).toHaveTextContent(/^▾$/);
  });

  it("every visible label is contained in its button's accessible name", () => {
    render(<PlotToolbar {...props} />);
    for (const d of [...NAVIGATE_TOOLS, ...INSPECT_TOOLS, ...ANALYZE_TOOLS, SMART_SCALE]) {
      const label = d.short ?? d.name;
      expect(d.name.toLowerCase()).toContain(label.toLowerCase());
      const btn = screen.getByRole("button", { name: d.name });
      expect(btn.querySelector(".qzk-tool-label")?.textContent).toBe(label);
    }
  });

  it("keeps the active tool state and the tooltip name", () => {
    render(<PlotToolbar {...props} />);
    const pan = screen.getByRole("button", { name: "Pan" });
    expect(pan).toHaveAttribute("data-tip", "Pan");
    act(() => useApp.getState().setPlotTool("pan"));
    expect(pan).toHaveAttribute("aria-pressed", "true");
  });

  it("follows the pref live, both ways", () => {
    render(<PlotToolbar {...props} />);
    expect(document.querySelector(".qzk-tool-label")).not.toBeNull();
    act(() => toolbarPrefsSlot.save({ showGroupLabels: true, showButtonLabels: false }));
    expect(document.querySelector(".qzk-tool-label")).toBeNull();
  });

  it("the Group labels toggle keeps the button-labels choice", () => {
    saveToolbarPrefs({ showGroupLabels: true, showButtonLabels: true });
    act(() => toolbarPrefsSlot.save({ ...toolbarPrefsSlot.load(), showGroupLabels: false }));
    expect(loadToolbarPrefs()).toEqual({ showGroupLabels: false, showButtonLabels: true });
  });
});

describe("PlotToolbar — overflow with labels", () => {
  // Group widths grow with each labelled button, as they do in a browser.
  function stub(stageWidth: number) {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.querySelector(":scope > .qzk-float-tools") ? stageWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-tool-group")) return 40 + 50 * this.querySelectorAll(".qzk-tool-label").length;
      if (this.hasAttribute("data-tool-opts")) return 32;
      if (this.classList.contains("qzk-tool-sep")) return 1;
      return 0;
    });
  }

  it("moves more groups to the ⋯ menu once labels widen them", () => {
    stub(560);
    render(<PlotToolbar {...props} />);
    // icon-only: groups are 40 wide each, so all six fit
    expect(screen.getByRole("group", { name: "Export" })).toBeInTheDocument();
    act(() => toolbarPrefsSlot.save({ showGroupLabels: true, showButtonLabels: true }));
    expect(screen.queryByRole("group", { name: "Export" })).toBeNull();
    expect(screen.getByRole("group", { name: "Navigate" })).toBeInTheDocument();
    // a collapsed group's buttons are still reachable from the overflow menu
    act(() => screen.getByRole("button", { name: "Toolbar Options" }).click());
    expect(within(screen.getByRole("menu")).getByText(/Save PNG/)).toBeInTheDocument();
  });
});
