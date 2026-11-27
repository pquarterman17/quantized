// The 3-D panel closes on Escape from any focus: a select, a number input (after an uncommitted edit
// has been reverted by the first Escape), or the scene; focus returns to the button that opens it.
// Also: a backdrop keeps the 2-D map (and its colour bar) from showing around the 3-D scene.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAP3D_PANEL_PREFS_KEY } from "../../lib/map3dPanelPrefs";
import { DEFAULT_MAP3D } from "../../lib/mapView3d";
import type { MapPayload } from "../../lib/mapdataFetch";
import { useApp } from "../../store/useApp";
import Map3dStageView from "./Map3D/Map3dStageView";
import MapToolbar, { type MapToolbarProps } from "./MapToolbar";
import { map3dPanelSettled, setMap3dPanelOpen } from "./useMap3dPanelOpen";

const props = (): MapToolbarProps =>
  ({
    datasetId: "d", painted: null, qAvailable: false, isAngular: false, isQ: false, onAngular: vi.fn(), onQ: vi.fn(),
    labels: ["x", "y", "z"], keys: [0, 1, 2], onKeyChange: vi.fn(), cmap: "viridis", cmapOptions: ["viridis"], onCmapChange: vi.fn(),
    logZ: false, onToggleLogZ: vi.fn(), contourOn: false, onToggleContour: vi.fn(), cutSpace: null, gridable: true, cutMode: "h",
    onSetCutMode: vi.fn(), cutWidth: 0, onSetCutWidth: vi.fn(), cutWidthTooltip: "", onProjection: vi.fn(),
    roiMode: "off", onToggleRoi: vi.fn(), rulerMode: "off", onToggleRuler: vi.fn(), wedgeMode: "off", onToggleWedge: vi.fn(), boxDrawable: false,
    pickMode: "off", onTogglePick: vi.fn(), onExport: vi.fn(),
  }) as MapToolbarProps;

const payload: MapPayload = {
  xAxis: [0, 1], yAxis: [0, 1], zGrid: [[1, 2], [3, 4]], xLabel: "x", xUnit: "", yLabel: "y", yUnit: "", zLabel: "z", zUnit: "", zMin: 1, zMax: 4,
};

const button = () => screen.getByRole("button", { name: "3-D view" });
const panel = () => screen.queryByRole("group", { name: "3-D view" });

async function mount() {
  localStorage.setItem(MAP3D_PANEL_PREFS_KEY, JSON.stringify({ open: true }));
  useApp.getState().setMapView3d("d", { ...DEFAULT_MAP3D, kind: "surface" });
  const r = render(
    <div className="qzk-stage">
      <MapToolbar {...props()} />
      <Map3dStageView datasetId="d" payload={payload} fresh view3d={{ ...DEFAULT_MAP3D, kind: "surface" }} cmap="viridis" logZ={false} colorLimits={null} top={0} data={undefined} keys={[0, 1, 2]} />
    </div>,
  );
  await screen.findByRole("group", { name: "3-D view" });
  return r;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  setMap3dPanelOpen(false);
  map3dPanelSettled();
  useApp.setState({ layoutMode: "windows", mapViews: {} as never });
});

describe("Escape closes the 3-D panel from any focus", () => {
  it("from a number input with no edit pending, focus back on the button", async () => {
    await mount();
    const elev = screen.getByLabelText("Elevation (°)");
    elev.focus();
    fireEvent.keyDown(elev, { key: "Escape" });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("an uncommitted edit uses the first Escape to revert; the second closes", async () => {
    await mount();
    const elev = screen.getByLabelText("Elevation (°)") as HTMLInputElement;
    const before = elev.value;
    elev.focus();
    fireEvent.change(elev, { target: { value: "77" } });
    expect(elev.value).toBe("77");
    fireEvent.keyDown(elev, { key: "Escape" });
    expect(elev.value).toBe(before);
    expect(panel()).not.toBeNull();
    fireEvent.keyDown(elev, { key: "Escape" });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("from the scene, with focus returning to the button", async () => {
    const { container } = await mount();
    const scene = container.querySelector("[data-map3d-view] [tabindex]") ?? container.querySelector("[data-map3d-view]");
    await waitFor(() => expect(scene).not.toBeNull());
    fireEvent.keyDown(scene as Element, { key: "Escape" });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("the scene ignores Escape while the panel is closed (nothing to close)", async () => {
    const { container } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Close 3-D view panel" }));
    button().blur();
    fireEvent.keyDown(container.querySelector("[data-map3d-view]") as Element, { key: "Escape" });
    expect(document.activeElement).not.toBe(button());
  });
});

describe("the 2-D map does not show around the 3-D scene", () => {
  it("a full-stage backdrop sits under the scene", async () => {
    const { container } = await mount();
    const back = container.querySelector("[data-map3d-backdrop]") as HTMLElement;
    expect(back).not.toBeNull();
    expect(back.style.inset).toMatch(/^0/);
    expect(back.style.right).toBe("0px"); // the full stage, not the dock-narrowed scene
  });
});
