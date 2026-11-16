// The Map stage's INTERACTIVE 3-D view (gap audit 5, items 3d/3e): it opens by
// default, draws nothing server-side, and each settled gesture is ONE undoable
// write of the camera into the map's 3-D view -- which ⤓ then exports.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../../../lib/api/mapFigure", () => ({
  exportMapFigure: vi.fn(() => Promise.resolve()),
  renderMapFigure: vi.fn(() => Promise.resolve(new Blob(["png"], { type: "image/png" }))),
}));

import { exportMapFigure, renderMapFigure } from "../../../lib/api/mapFigure";
import { EMPTY_MAP_VIEWS, mapViewFor } from "../../../lib/mapView";
import { DEFAULT_MAP3D } from "../../../lib/mapView3d";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { askParams } from "../../overlays/ParamDialog";
import MapStage from "../MapStage";
import { COMMIT_IDLE_MS } from "./useOrbit";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom has no PointerEvent: without one, fireEvent.pointer* carries no clientX.
class FakePointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

function grid(id: string): Dataset {
  const values: number[][] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) values.push([i, j, 1 + i * 4 + j]);
  return { id, name: `${id}.dat`, data: { time: values.map((_, k) => k), values, labels: ["X", "Y", "Signal"], units: ["mm", "mm", "V"], metadata: {} } };
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("PointerEvent", FakePointerEvent);
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.mocked(exportMapFigure).mockClear();
  vi.mocked(renderMapFigure).mockClear();
  useApp.getState().loadWorkspace({ datasets: [grid("scan")], activeId: "scan" });
  useApp.setState({ mapViews: EMPTY_MAP_VIEWS, mapRes: 50, status: "" });
  useApp.getState().setMapView3d("scan", { ...DEFAULT_MAP3D, kind: "surface" });
});

const view3d = () => mapViewFor(useApp.getState().mapViews, "scan").view3d;
const shown = () => document.querySelector("[data-map3d-angles]")?.textContent ?? "";
/** The plot, once the (offline) grid has settled: a regrid rebuilds the scene and remounts the canvas. */
const plot = async () => {
  await waitFor(() => expect(useApp.getState().status).toMatch(/offline grid/));
  return screen.findByRole("application", { name: /Surface of Signal/ });
};

describe("Map stage interactive 3-D", () => {
  it("opens interactive and asks the server for nothing", async () => {
    render(<MapStage />);
    expect(await plot()).toBeTruthy();
    expect(document.querySelector("[data-map3d-interactive]")).not.toBeNull();
    expect(renderMapFigure).not.toHaveBeenCalled();
  });

  it("keyboard rotation commits ONCE after the keys stop; undo restores the view; ⤓ exports the view on screen", async () => {
    vi.mocked(askParams).mockImplementation(async (_t, fields) => ({ ...Object.fromEntries(fields.map((f) => [f.key, f.default])), fmt: "pdf" }));
    render(<MapStage />);
    const el = await plot();
    const undoDepth = () => useApp.getState().history.length;
    const before = undoDepth();
    fireEvent.keyDown(el, { key: "ArrowLeft" });
    fireEvent.keyDown(el, { key: "ArrowLeft" });
    fireEvent.keyDown(el, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(el, { key: "+" });
    expect(view3d()).toMatchObject({ elev: 30, azim: -60, zoom: 1 }); // nothing written mid-gesture
    expect(shown()).toMatch(/elevation 45°, azimuth -50°, zoom 1\.10×/);
    await act(() => new Promise((r) => setTimeout(r, COMMIT_IDLE_MS + 100)));
    expect(view3d()).toMatchObject({ elev: 45, azim: -50, zoom: 1.1, kind: "surface" });
    expect(undoDepth()).toBe(before + 1);

    fireEvent.click(screen.getByTitle(/^Export map/));
    await waitFor(() => expect(useApp.getState().status).toBe("exported scan_map.pdf"));
    expect(vi.mocked(exportMapFigure).mock.calls[0]![0]).toMatchObject({ kind: "surface", view_elev: 45, view_azim: -50, view_zoom: 1.1 });
    // The export dialog offered the same angles as its defaults.
    const fields = vi.mocked(askParams).mock.calls[0]![1];
    expect(fields.find((f) => f.key === "elev")?.default).toBe(45);
    expect(fields.find((f) => f.key === "azim")?.default).toBe(-50);

    act(() => useApp.getState().undo());
    expect(view3d()).toMatchObject({ elev: 30, azim: -60, zoom: 1 });
    await waitFor(() => expect(shown()).toMatch(/elevation 30°, azimuth -60°, zoom 1\.00×/));
  });

  it("a drag is one undo step, written on release", async () => {
    render(<MapStage />);
    const el = await plot();
    const before = useApp.getState().history.length;
    fireEvent.pointerDown(el, { pointerId: 3, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 3, buttons: 1, clientX: 140, clientY: 110 });
    fireEvent.pointerMove(el, { pointerId: 3, buttons: 1, clientX: 160, clientY: 120 });
    expect(view3d()?.azim).toBe(-60);
    fireEvent.pointerUp(el, { pointerId: 3, clientX: 160, clientY: 120 });
    expect(view3d()).toMatchObject({ elev: 40, azim: -90 });
    expect(useApp.getState().history.length).toBe(before + 1);
  });

  it("a drag whose release was lost ends on the next move with no button down (no hover-rotate)", async () => {
    render(<MapStage />);
    const el = await plot();
    fireEvent.pointerDown(el, { pointerId: 4, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 4, buttons: 1, clientX: 120, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 4, buttons: 0, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 4, buttons: 0, clientX: 300, clientY: 100 });
    expect(view3d()).toMatchObject({ azim: -70 });
  });

  it("a key gesture is written as soon as focus leaves the plot, so ⤓ right after exports it", async () => {
    render(<MapStage />);
    const el = await plot();
    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(view3d()?.azim).toBe(-60);
    fireEvent.blur(el);
    expect(view3d()?.azim).toBe(-65);
  });

  it("an undo during a pending gesture wins (the pending write is dropped)", async () => {
    useApp.getState().setMapView3d("scan", { ...DEFAULT_MAP3D, kind: "surface", elev: 20 });
    render(<MapStage />);
    const el = await plot();
    fireEvent.keyDown(el, { key: "ArrowRight" });
    act(() => useApp.getState().undo());
    await act(() => new Promise((r) => setTimeout(r, COMMIT_IDLE_MS + 100)));
    expect(view3d()).toMatchObject({ elev: 30, azim: -60 });
  });

  it("Ctrl+Z within the commit delay undoes THAT gesture as one step (it is flushed first, not lost)", async () => {
    render(<MapStage />);
    const el = await plot();
    const before = useApp.getState().history.length;
    fireEvent.keyDown(el, { key: "ArrowLeft" });
    fireEvent.keyDown(el, { key: "ArrowLeft" });
    // the app's Undo shortcut: the capture listener commits the gesture first
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(view3d()?.azim).toBe(-50);
    expect(useApp.getState().history.length).toBe(before + 1);
    act(() => useApp.getState().undo());
    await act(() => new Promise((r) => setTimeout(r, COMMIT_IDLE_MS + 100)));
    expect(view3d()?.azim).toBe(-60); // the gesture is undone and stays undone
  });

  it("screen readers hear the committed view, not every pointer move", async () => {
    render(<MapStage />);
    const el = await plot();
    const live = () => document.querySelector("[data-map3d-announce]")!.textContent;
    expect(live()).toMatch(/azimuth -60°/);
    fireEvent.pointerDown(el, { pointerId: 5, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 5, buttons: 1, clientX: 120, clientY: 100 });
    expect(live()).toMatch(/azimuth -60°/); // moving: not announced
    expect(shown()).toMatch(/azimuth -70°/); // the visible readout follows
    fireEvent.pointerUp(el, { pointerId: 5, clientX: 120, clientY: 100 });
    await waitFor(() => expect(live()).toMatch(/azimuth -70°/));
  });

  it("FORCED race: a regrid that remounts the canvas mid-gesture keeps the gesture (flushed on unmount)", async () => {
    // The race the earlier flake hit: keys pressed while the map regrids. The
    // regrid is forced here (a new resolution), between two key presses.
    render(<MapStage />);
    const first = await plot();
    fireEvent.keyDown(first, { key: "ArrowLeft" }); // pending, not yet committed
    expect(view3d()?.azim).toBe(-60);
    useApp.setState({ status: "" });
    act(() => useApp.setState({ mapRes: 40 })); // regrid: the scene is rebuilt
    await waitFor(() => expect(first.isConnected).toBe(false)); // the canvas really remounted
    expect(view3d()?.azim).toBe(-55); // ...and the pending gesture was committed, not lost
    const second = await plot();
    expect(shown()).toMatch(/azimuth -55°/); // the new canvas starts from it
    fireEvent.keyDown(second, { key: "ArrowLeft" });
    fireEvent.blur(second);
    expect(view3d()?.azim).toBe(-50);
  });

  it("Reset view returns to the default camera; the panel's angle fields follow the stored view", async () => {
    useApp.getState().setMapView3d("scan", { ...DEFAULT_MAP3D, kind: "surface", elev: 10, azim: 100, zoom: 2 });
    render(<MapStage />);
    await plot();
    expect(shown()).toMatch(/elevation 10°, azimuth 100°, zoom 2\.00×/);
    fireEvent.click(screen.getByRole("button", { name: "Reset 3-D view" }));
    expect(view3d()).toMatchObject({ elev: 30, azim: -60, zoom: 1 });
  });

  it("3-D scatter offers drop lines, kept with the view and sent with the export", async () => {
    useApp.getState().setMapView3d("scan", { ...DEFAULT_MAP3D, kind: "scatter3d" });
    vi.mocked(askParams).mockImplementation(async (_t, fields) => ({ ...Object.fromEntries(fields.map((f) => [f.key, f.default])), fmt: "svg" }));
    render(<MapStage />);
    fireEvent.click(await screen.findByLabelText("Drop lines"));
    expect(view3d()?.dropLines).toBe(true);
    fireEvent.click(screen.getByTitle(/^Export map/));
    await waitFor(() => expect(useApp.getState().status).toBe("exported scan_map.svg"));
    expect(vi.mocked(exportMapFigure).mock.calls[0]![0]).toMatchObject({ kind: "scatter3d", drop_lines: true });
  });
});
