// OG18 on the Map toolbar: Preferences ▸ Plot ▸ "Toolbar button labels" puts a short caption beside each
// glyph-only button. Off is today's DOM exactly; on never doubles a name, never captions a button that
// already shows a word, and the windowed toolbar collapses to its menu sooner. Driven through the real
// preference switch.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAP_CAPTIONS } from "../../lib/mapToolbarLabels";
import { toolbarPrefsSlot } from "../../store/prefs";
import { useApp } from "../../store/useApp";
import PreferencesDialog, { PREFS_DIALOG_KEY } from "../overlays/PreferencesDialog";
import MapToolbar, { type MapToolbarProps } from "./MapToolbar";

const props = (over: Partial<MapToolbarProps> = {}): MapToolbarProps =>
  ({
    datasetId: "ds-a", painted: null,
    qAvailable: true, isAngular: true, isQ: false, onAngular: vi.fn(), onQ: vi.fn(),
    labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"], keys: [0, 1, 2], onKeyChange: vi.fn(),
    cmap: "viridis", cmapOptions: ["viridis", "magma"], onCmapChange: vi.fn(),
    logZ: true, onToggleLogZ: vi.fn(), contourOn: false, onToggleContour: vi.fn(),
    cutSpace: "q", gridable: true, cutMode: "h", onSetCutMode: vi.fn(), cutWidth: 0, onSetCutWidth: vi.fn(), cutWidthTooltip: "", onProjection: vi.fn(),
    roiMode: "off", onToggleRoi: vi.fn(), rulerMode: "off", onToggleRuler: vi.fn(), wedgeMode: "off", onToggleWedge: vi.fn(), boxDrawable: true, pickMode: "off", onTogglePick: vi.fn(),
    onExport: vi.fn(),
    ...over,
  }) as MapToolbarProps;

const ORIGINAL = useApp.getState();
beforeEach(() => {
  localStorage.removeItem(PREFS_DIALOG_KEY);
  toolbarPrefsSlot.reset();
  useApp.setState({ layoutMode: "classic", mapViews: {} as never });
});
afterEach(() => {
  vi.restoreAllMocks();
  useApp.getState().setPrefsOpen(false);
  useApp.setState(ORIGINAL, true);
  toolbarPrefsSlot.reset();
});

/** The real switch in Preferences ▸ Plot. */
function flipPref() {
  act(() => useApp.getState().setPrefsOpen(true));
  render(<PreferencesDialog />);
  fireEvent.click(screen.getByRole("tab", { name: "Plot" }));
  fireEvent.click(screen.getByRole("switch", { name: "Toolbar button labels" }));
}

describe("Map toolbar, labels off (default)", () => {
  it("is icon-only exactly as before: no span, no data-label, no inline style", () => {
    const { container } = render(<MapToolbar {...props()} />);
    expect(container.querySelector("[data-label], .qzk-tool-label")).toBeNull();
    expect(container.querySelector(".qzk-tool-btn[style]")).toBeNull();
    expect(screen.getByRole("button", { name: "Export map" }).textContent).toBe("⤓");
    expect(screen.getByRole("button", { name: "Pick point" }).getAttribute("title")).toMatch(/^Pick point/);
  });
});

describe("Map toolbar, labels on through the preference switch", () => {
  it("captions the glyph-only buttons, keeps every accessible name single and every tooltip", () => {
    const { container } = render(<MapToolbar {...props({ qAvailable: true, cutSpace: "q" })} />);
    flipPref();
    for (const [name, caption] of Object.entries(MAP_CAPTIONS)) {
      const hits = container.querySelectorAll(`button[aria-label="${name}"]`);
      if (!hits.length) continue; // Contours etc. are all present here; Polygon needs a handler
      const btn = screen.getByRole("button", { name });
      expect(btn).toHaveAttribute("data-label", caption);
      expect(btn.textContent).toContain(caption);
      expect(name.toLowerCase()).toContain(caption.toLowerCase()); // visible text is contained in the accessible name
      expect(btn.querySelector(".qzk-tool-label")).toHaveAttribute("aria-hidden", "true");
      expect(screen.getAllByRole("button", { name })).toHaveLength(1);
    }
    expect(screen.getByRole("button", { name: "Export map" })).toHaveAttribute("data-label", "Export");
    expect(screen.getByRole("button", { name: "Export map" }).getAttribute("title")).toMatch(/^Export map/);
    expect(screen.getByRole("button", { name: "Map operations" })).toHaveAttribute("data-label", "Operations");
    expect(screen.getByRole("button", { name: "H-cut" })).toHaveAttribute("data-label", "H-cut");
  });

  it("leaves a button that already shows a word alone: log, Q, 2θ/ω, 3D, Σx", () => {
    render(<MapToolbar {...props()} />);
    flipPref();
    const log = screen.getByRole("button", { name: "Log intensity scale" });
    expect(log.textContent).toBe("log");
    expect(screen.getByRole("button", { name: "Q-space axes" }).textContent).toBe("Q");
    expect(screen.getByRole("button", { name: "3-D view" }).textContent).toBe("3D");
    expect(screen.getByRole("button", { name: "Project onto the horizontal axis" }).textContent).toBe("Σx");
    expect(log).not.toHaveAttribute("data-label");
  });

  it("switching it off again restores today's DOM; the click handler still fires on a captioned button", () => {
    const onExport = vi.fn();
    const { container } = render(<MapToolbar {...props({ onExport })} />);
    flipPref();
    fireEvent.click(screen.getByRole("button", { name: "Export map" }));
    expect(onExport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("switch", { name: "Toolbar button labels" }));
    expect(container.querySelector("[data-label], .qzk-tool-label")).toBeNull();
    expect(container.querySelector(".qzk-tool-btn[style]")).toBeNull();
    expect(screen.getByRole("button", { name: "Export map" }).textContent).toBe("⤓");
  });

  it("a button that mounts later (the cut tools, a Q view) is captioned too", () => {
    const { rerender } = render(<MapToolbar {...props({ cutSpace: null })} />);
    flipPref();
    expect(screen.queryByRole("button", { name: "Angled cut" })).toBeNull();
    rerender(<MapToolbar {...props({ cutSpace: "q" })} />);
    expect(screen.getByRole("button", { name: "Angled cut" })).toHaveAttribute("data-label", "Angled");
  });
});

describe("Map toolbar, labels on, a narrow window", () => {
  function inStage(w: number) {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(w);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
    return render(
      <div className="qzk-stage">
        <MapToolbar {...props()} />
      </div>,
    );
  }
  beforeEach(() => useApp.setState({ layoutMode: "windows" }));

  it("a 650 px stage keeps the full dock with labels off and collapses it to the menu with labels on", () => {
    inStage(650);
    expect(screen.queryByRole("button", { name: /Map tools/ })).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Map tools" })).toBeTruthy();
    flipPref();
    expect(screen.getByRole("button", { name: /Map tools/ })).toBeTruthy();
  });

  it("the collapsed menu's buttons are captioned once it opens, and stay inside the stage's width", () => {
    inStage(411);
    flipPref();
    fireEvent.click(screen.getByRole("button", { name: /Map tools/ }));
    const bar = screen.getByRole("toolbar", { name: "Map tools" });
    expect(within(bar).getByRole("button", { name: "Export map" })).toHaveAttribute("data-label", "Export");
    expect(bar.style.maxWidth).toBe("395px"); // the menu wraps inside the stage, as without labels
  });
});
