// OG18: Preferences ▸ Plot ▸ "Toolbar button labels" puts a short text name
// beside each plot-toolbar icon. Off (the default) must be today's DOM exactly;
// on must not double any accessible name, and must feed the overflow measure.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANALYZE_TOOLS,
  COPY_DATA,
  COPY_FIGURE,
  INSET_MODE,
  INSPECT_TOOLS,
  NAVIGATE_TOOLS,
  POLAR_MODE,
  RESET_VIEW,
  SAVE_PNG,
  SMART_SCALE,
  SNAPSHOT_WINDOW,
  STACK_MODE,
  STAT_MODE,
} from "../../lib/plotToolbarDefs";
import { SHORT_LABELS } from "../../lib/plotToolbarLabels";
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

const VIEW_EXPORT = [RESET_VIEW, SMART_SCALE, STACK_MODE, INSET_MODE, POLAR_MODE, STAT_MODE, SAVE_PNG, COPY_DATA, COPY_FIGURE, SNAPSHOT_WINDOW];
const NOOP = () => {};
// The short captions load lazily with the pref: wait for the first label.
const labelsShown = () => waitFor(() => expect(document.querySelector("[data-label]")).not.toBeNull());
const props = { onReset: NOOP, onSmartScale: NOOP, onSavePng: NOOP, onCopyData: NOOP, onCopyFigure: NOOP, onSnapshotWindow: NOOP };

describe("PlotToolbar — button labels off (default)", () => {
  it("is icon-only: no data-label anywhere, no text in any button, today's accessible names", () => {
    const { container } = render(<PlotToolbar {...props} />);
    expect(container.querySelector("[data-label]")).toBeNull();
    expect(container.querySelector(".qzk-tool-btn span")).toBeNull();
    expect(container.querySelector<HTMLElement>(".qzk-tool-btn")?.getAttribute("style")).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Data cursor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Smart auto-scale" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draw Arrow" }).textContent).toBe("");
  });
});

describe("PlotToolbar — button labels on", () => {
  beforeEach(() => saveToolbarPrefs({ showGroupLabels: true, showButtonLabels: true }));

  it("shows the short label beside each icon and keeps the accessible name single", async () => {
    render(<PlotToolbar {...props} />);
    await labelsShown();
    const zoom = screen.getByRole("button", { name: "Zoom" }); // exactly "Zoom", not "Zoom Zoom"
    // The caption is an aria-hidden span under an aria-label, so the name is never read twice.
    expect(zoom).toHaveAttribute("data-label", "Zoom");
    expect(zoom.textContent).toBe("Zoom");
    expect(zoom.querySelector(".qzk-tool-label")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Data cursor" })).toHaveAttribute("data-label", "Cursor");
    expect(screen.getByRole("button", { name: "Smart auto-scale" })).toHaveAttribute("data-label", "Auto-scale");
    expect(screen.getByRole("button", { name: "Draw Arrow" })).toHaveAttribute("data-label", "Draw");
    // the ▾ chooser and ⋯ stay icon-only
    expect(screen.getByRole("button", { name: "Choose drawing tool" })).not.toHaveAttribute("data-label");
    expect(screen.getAllByRole("button", { name: /^Zoom/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Smart auto-scale" }).textContent).toBe("Auto-scale");
  });

  it("every visible label is contained in its button's accessible name", async () => {
    render(<PlotToolbar {...props} />);
    await labelsShown();
    for (const d of [...NAVIGATE_TOOLS, ...INSPECT_TOOLS, ...ANALYZE_TOOLS, ...VIEW_EXPORT]) {
      const label = SHORT_LABELS[d.id] ?? d.name;
      expect(d.name.toLowerCase()).toContain(label.toLowerCase());
      const btn = screen.getByRole("button", { name: d.name });
      expect(btn).toHaveAttribute("data-label", label);
    }
  });

  it("keeps the active tool state and the tooltip name", async () => {
    render(<PlotToolbar {...props} />);
    await labelsShown();
    const pan = screen.getByRole("button", { name: "Pan" });
    expect(pan).toHaveAttribute("data-tip", "Pan");
    act(() => useApp.getState().setPlotTool("pan"));
    expect(pan).toHaveAttribute("aria-pressed", "true");
  });

  it("follows the pref live, both ways, leaving buttons exactly as they were", async () => {
    const { container } = render(<PlotToolbar {...props} />);
    await labelsShown();
    act(() => toolbarPrefsSlot.save({ showGroupLabels: true, showButtonLabels: false }));
    await waitFor(() => expect(document.querySelector("[data-label]")).toBeNull());
    expect(container.querySelector(".qzk-tool-label")).toBeNull();
    expect(container.querySelector(".qzk-tool-btn[style]")?.getAttribute("aria-label")).toBe("Choose drawing tool"); // its own width, as before
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
      if (this.hasAttribute("data-tool-group")) return 40 + 50 * this.querySelectorAll("[data-label]").length;
      if (this.hasAttribute("data-tool-opts")) return 32;
      if (this.classList.contains("qzk-tool-sep")) return 1;
      return 0;
    });
  }

  it("moves more groups to the ⋯ menu once labels widen them", async () => {
    stub(560);
    render(<PlotToolbar {...props} />);
    // icon-only: groups are 40 wide each, so all six fit
    expect(screen.getByRole("group", { name: "Export" })).toBeInTheDocument();
    act(() => toolbarPrefsSlot.save({ showGroupLabels: true, showButtonLabels: true }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Export" })).toBeNull());
    expect(screen.getByRole("group", { name: "Navigate" })).toBeInTheDocument();
    // a collapsed group's buttons are still reachable from the overflow menu
    act(() => screen.getByRole("button", { name: "Toolbar Options" }).click());
    expect(within(screen.getByRole("menu")).getByText(/Save PNG/)).toBeInTheDocument();
  });
});

describe("SHORT_LABELS", () => {
  it("only names buttons that exist, and each caption comes from the button's name", () => {
    const defs = [...NAVIGATE_TOOLS, ...INSPECT_TOOLS, ...ANALYZE_TOOLS, ...VIEW_EXPORT];
    for (const id of Object.keys(SHORT_LABELS)) expect(defs.some((d) => d.id === id)).toBe(true);
  });
});
