// OG17: the 3-D view panel floats over the scene, so it starts collapsed, opens from the toolbar's 3D button,
// closes on Escape or its Close button (focus back on the button) and remembers its last state in a local pref.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAP3D_PANEL_PREFS_KEY } from "../../lib/map3dPanelPrefs";
import { useApp } from "../../store/useApp";
import MapToolbar, { type MapToolbarProps } from "./MapToolbar";

const props = (): MapToolbarProps =>
  ({
    datasetId: "ds-a", painted: null,
    qAvailable: false, isAngular: false, isQ: false, onAngular: vi.fn(), onQ: vi.fn(),
    labels: ["x", "y", "z"], keys: [0, 1, 2], onKeyChange: vi.fn(),
    cmap: "viridis", cmapOptions: ["viridis"], onCmapChange: vi.fn(),
    logZ: false, onToggleLogZ: vi.fn(), contourOn: false, onToggleContour: vi.fn(),
    cutSpace: null, gridable: true, cutMode: "h", onSetCutMode: vi.fn(), cutWidth: 0, onSetCutWidth: vi.fn(), cutWidthTooltip: "", onProjection: vi.fn(),
    roiMode: "off", onToggleRoi: vi.fn(), rulerMode: "off", onToggleRuler: vi.fn(), wedgeMode: "off", onToggleWedge: vi.fn(), boxDrawable: false, pickMode: "off", onTogglePick: vi.fn(),
    onExport: vi.fn(),
  }) as MapToolbarProps;

const panel = () => screen.queryByRole("group", { name: "3-D view" });
const button = () => screen.getByRole("button", { name: "3-D view" });
const mount = () => render(<div className="qzk-stage"><MapToolbar {...props()} /></div>);

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ layoutMode: "windows", mapViews: {} as never });
});

describe("the Map toolbar's 3-D panel", () => {
  it("starts collapsed, opens from the 3D button, and the choice is remembered", async () => {
    mount();
    expect(panel()).toBeNull();
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(localStorage.getItem(MAP3D_PANEL_PREFS_KEY)).toBeNull();
    fireEvent.click(button());
    await waitFor(() => expect(panel()).not.toBeNull());
    expect(JSON.parse(localStorage.getItem(MAP3D_PANEL_PREFS_KEY) ?? "{}")).toEqual({ open: true });
  });

  it("Escape closes it and returns focus to the button; the closed state is remembered", async () => {
    localStorage.setItem(MAP3D_PANEL_PREFS_KEY, JSON.stringify({ open: true }));
    mount();
    const group = await screen.findByRole("group", { name: "3-D view" });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "3-D view kind" }), { key: "Escape" });
    expect(group.isConnected).toBe(false);
    expect(document.activeElement).toBe(button());
    expect(JSON.parse(localStorage.getItem(MAP3D_PANEL_PREFS_KEY) ?? "{}")).toEqual({ open: false });
  });

  it("the Close button closes it with focus back on the button", async () => {
    localStorage.setItem(MAP3D_PANEL_PREFS_KEY, JSON.stringify({ open: true }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Close 3-D view panel" }));
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("opening does not take focus off the page (the scene keeps its keyboard)", async () => {
    mount();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    act(() => void button().click());
    await screen.findByRole("group", { name: "3-D view" });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("a remembered open state is honoured on the next mount; garbage storage means closed", async () => {
    localStorage.setItem(MAP3D_PANEL_PREFS_KEY, JSON.stringify({ open: true }));
    const first = mount();
    await screen.findByRole("group", { name: "3-D view" });
    first.unmount();
    localStorage.setItem(MAP3D_PANEL_PREFS_KEY, "not json");
    mount();
    expect(panel()).toBeNull();
  });
});
