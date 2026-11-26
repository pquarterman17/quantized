// UX pass 4 M4 and m-3. In the window layout a small map window collapses the Map toolbar to one button that
// opens the full toolbar over the map (the full dock wrapped to four rows and left ~50 px of map); classic is
// unchanged at every size. The toolbar is a named toolbar whose toggles say whether they are pressed, and its
// glyph-only buttons and its colormap select have real names.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mapViewFor } from "../../lib/mapView";
import { useApp } from "../../store/useApp";
import MapToolbar, { type MapToolbarProps } from "./MapToolbar";

const props = (over: Partial<MapToolbarProps> = {}): MapToolbarProps =>
  ({
    datasetId: "ds-a", painted: null,
    qAvailable: true, isAngular: true, isQ: false, onAngular: vi.fn(), onQ: vi.fn(),
    labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"], keys: [0, 1, 2], onKeyChange: vi.fn(),
    cmap: "viridis", cmapOptions: ["viridis", "magma"], onCmapChange: vi.fn(),
    logZ: true, onToggleLogZ: vi.fn(), contourOn: false, onToggleContour: vi.fn(),
    cutSpace: "angular", gridable: true, cutMode: "h", onSetCutMode: vi.fn(), cutWidth: 0, onSetCutWidth: vi.fn(), cutWidthTooltip: "", onProjection: vi.fn(),
    roiMode: "off", onToggleRoi: vi.fn(), rulerMode: "off", onToggleRuler: vi.fn(), wedgeMode: "off", onToggleWedge: vi.fn(), boxDrawable: true, pickMode: "off", onTogglePick: vi.fn(),
    onExport: vi.fn(),
    ...over,
  }) as MapToolbarProps;

/** The toolbar sits in a stage of `w` x `h` (jsdom has no layout, so clientWidth/Height are stubbed). */
function inStage(w: number, h: number, p: MapToolbarProps = props()) {
  const widths = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(w);
  const heights = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(h);
  const view = render(
    <div className="qzk-stage">
      <MapToolbar {...p} />
    </div>,
  );
  return { ...view, restore: () => (widths.mockRestore(), heights.mockRestore()) };
}

beforeEach(() => useApp.setState({ layoutMode: "windows", mapViews: {} as never }));
afterEach(() => vi.restoreAllMocks());

describe("a small map window (windows mode)", () => {
  it("collapses to one button; the full toolbar opens over the map and closes on Escape, focus on the button", () => {
    inStage(411, 300);
    expect(screen.queryByRole("combobox", { name: "X channel" })).toBeNull();
    const button = screen.getByRole("button", { name: /Map tools/ });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const bar = screen.getByRole("toolbar", { name: "Map tools" });
    expect(within(bar).getByRole("combobox", { name: "X channel" })).toBeTruthy();
    fireEvent.keyDown(within(bar).getByRole("combobox", { name: "X channel" }), { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: "Map tools" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("a press outside the opened toolbar closes it", () => {
    inStage(411, 300);
    fireEvent.click(screen.getByRole("button", { name: /Map tools/ }));
    expect(screen.getByRole("toolbar", { name: "Map tools" })).toBeTruthy();
    act(() => void document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(screen.queryByRole("toolbar", { name: "Map tools" })).toBeNull();
  });

  it("a press outside while a color limit is being typed commits it, not drops it", () => {
    inStage(411, 300);
    fireEvent.click(screen.getByRole("button", { name: /Map tools/ }));
    const bar = screen.getByRole("toolbar", { name: "Map tools" });
    const lo = within(bar).getByLabelText("Map window color minimum");
    const hi = within(bar).getByLabelText("Map window color maximum");
    hi.focus();
    fireEvent.change(hi, { target: { value: "5000" } });
    fireEvent.change(lo, { target: { value: "10" } });
    hi.focus();
    act(() => void document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(screen.queryByRole("toolbar", { name: "Map tools" })).toBeNull();
    expect(mapViewFor(useApp.getState().mapViews, "ds-a").colorLimits).toEqual([10, 5000]);
  });

  it("widening the window forgets an opened menu: narrowing again does not pop it open", () => {
    let measure: () => void = () => {};
    vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { measure = cb; } observe(): void {} disconnect(): void {} });
    const widths = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(411);
    const heights = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
    render(<div className="qzk-stage"><MapToolbar {...props()} /></div>);
    fireEvent.click(screen.getByRole("button", { name: /Map tools/ }));
    widths.mockReturnValue(900);
    heights.mockReturnValue(700);
    act(() => measure());
    expect(screen.queryByRole("button", { name: /Map tools/ })).toBeNull();
    widths.mockReturnValue(411);
    heights.mockReturnValue(300);
    act(() => measure());
    expect(screen.getByRole("button", { name: /Map tools/ }).getAttribute("aria-expanded")).toBe("false");
    vi.unstubAllGlobals();
  });

  it("the opened toolbar fits the stage (its width and height are capped)", () => {
    inStage(411, 300);
    fireEvent.click(screen.getByRole("button", { name: /Map tools/ }));
    const bar = screen.getByRole("toolbar", { name: "Map tools" });
    expect(bar.style.maxWidth).toBe("395px");
    expect(Number.parseInt(bar.style.maxHeight)).toBeLessThanOrEqual(300);
  });

  it("collapses for a short stage too, and not for a roomy one", () => {
    const short = inStage(900, 250);
    expect(screen.getByRole("button", { name: /Map tools/ })).toBeTruthy();
    short.unmount();
    short.restore();
    inStage(900, 600);
    expect(screen.queryByRole("button", { name: /Map tools/ })).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Map tools" })).toBeTruthy();
  });

  it("opening 3-D closes the menu and anchors the panel under the button", () => {
    inStage(411, 300);
    fireEvent.click(screen.getByRole("button", { name: /Map tools/ }));
    fireEvent.click(screen.getByRole("button", { name: "3-D view" }));
    expect(screen.queryByRole("toolbar", { name: "Map tools" })).toBeNull();
    expect(document.querySelector(".qzk-map-3d-anchor")).not.toBeNull();
  });
});

describe("classic is unchanged", () => {
  it("the full toolbar stays inline at a small size", () => {
    useApp.setState({ layoutMode: "classic" });
    inStage(411, 300);
    expect(screen.queryByRole("button", { name: /Map tools/ })).toBeNull();
    expect(screen.getByRole("combobox", { name: "X channel" })).toBeTruthy();
    expect(document.querySelector(".qzk-map-compact")).toBeNull();
  });
});

describe("toolbar accessibility (m-3)", () => {
  it("is a named toolbar; toggles carry aria-pressed; glyph-only buttons and the colormap have names", () => {
    inStage(1200, 700, props({ cutMode: "h", logZ: true }));
    const bar = screen.getByRole("toolbar", { name: "Map tools" });
    const pressed = (name: string) => within(bar).getByRole("button", { name }).getAttribute("aria-pressed");
    expect(pressed("Log intensity scale")).toBe("true");
    expect(pressed("H-cut")).toBe("true");
    expect(pressed("V-cut")).toBe("false");
    expect(pressed("Contours")).toBe("false");
    expect(pressed("Q-space axes")).toBe("false");
    expect(pressed("Integration box")).toBe("false");
    expect(within(bar).getByRole("button", { name: "Project onto the horizontal axis" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Project onto the vertical axis" })).toBeTruthy();
    expect(within(bar).getByRole("combobox", { name: "Colormap" })).toBeTruthy();
  });

  it("the color-limit and swath-width fields reach 24 px", () => {
    inStage(1200, 700, props({ cutMode: "h" }));
    for (const field of [screen.getByLabelText("Map window color minimum"), screen.getByLabelText("Map window color maximum"), document.querySelector<HTMLInputElement>('input[type="number"]')!]) {
      expect(Number.parseInt(field.style.height)).toBeGreaterThanOrEqual(24);
    }
  });
});
