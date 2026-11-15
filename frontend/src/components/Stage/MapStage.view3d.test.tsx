// MapStage static 3-D (gap-5 lane F): the toolbar's 3-D panel chooses the view,
// the stage shows the SERVER's render of it, and ⤓ sends the SAME request in the
// chosen format. Scaffolding mirrors MapStage.export.test.tsx.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../../lib/api/mapFigure", () => ({
  exportMapFigure: vi.fn(() => Promise.resolve()),
  renderMapFigure: vi.fn(() => Promise.resolve(new Blob(["png"], { type: "image/png" }))),
}));

import { exportMapFigure, renderMapFigure } from "../../lib/api/mapFigure";
import { EMPTY_MAP_VIEWS, mapViewFor } from "../../lib/mapView";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { askParams } from "../overlays/ParamDialog";
import MapStage from "./MapStage";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function grid(id: string): Dataset {
  const values: number[][] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) values.push([i, j, 1 + i * 4 + j]);
  return { id, name: `${id}.dat`, data: { time: values.map((_, k) => k), values, labels: ["X", "Y", "Signal"], units: ["mm", "mm", "V"], metadata: {} } };
}

let widthSpy: PropertyDescriptor | undefined;
let heightSpy: PropertyDescriptor | undefined;

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
  widthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  heightSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 400 });
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (widthSpy) Object.defineProperty(HTMLElement.prototype, "clientWidth", widthSpy);
  if (heightSpy) Object.defineProperty(HTMLElement.prototype, "clientHeight", heightSpy);
});

beforeEach(() => {
  vi.mocked(exportMapFigure).mockClear();
  vi.mocked(renderMapFigure).mockClear();
  useApp.getState().loadWorkspace({ datasets: [grid("scan")], activeId: "scan" });
  useApp.setState({ mapViews: EMPTY_MAP_VIEWS, mapRes: 50, status: "" });
});

const view3d = () => mapViewFor(useApp.getState().mapViews, "scan").view3d;

describe("MapStage static 3-D", () => {
  it("shows no 3-D render (and loads nothing) until a 3-D view is chosen", async () => {
    render(<MapStage />);
    await waitFor(() => expect(useApp.getState().status).toMatch(/offline grid/));
    expect(document.querySelector("[data-map3d-preview]")).toBeNull();
    expect(renderMapFigure).not.toHaveBeenCalled();
  });

  it("the panel picks a kind and numeric angles; the preview is the server render; ⤓ exports the same request", async () => {
    vi.mocked(askParams).mockImplementation(async (_t, fields) => ({
      ...Object.fromEntries(fields.map((f) => [f.key, f.default])),
      fmt: "pdf",
    }));
    render(<MapStage />);
    await waitFor(() => expect(useApp.getState().status).toMatch(/offline grid/));

    fireEvent.click(await screen.findByLabelText("3-D view"));
    fireEvent.change(await screen.findByLabelText("3-D view kind"), { target: { value: "3-D scatter" } });
    expect(view3d()?.kind).toBe("scatter3d");
    const elev = screen.getByLabelText("Elevation (°)");
    fireEvent.change(elev, { target: { value: "55" } });
    fireEvent.blur(elev);
    const azim = screen.getByLabelText("Azimuth (°)");
    fireEvent.change(azim, { target: { value: "15" } });
    fireEvent.keyDown(azim, { key: "Enter" });
    expect(view3d()).toMatchObject({ kind: "scatter3d", elev: 55, azim: 15 });

    const img = await screen.findByAltText("3-D map preview");
    // The app's CSP allows only 'self' and data: images -- a blob: URL is blocked.
    expect(img.getAttribute("src")).toMatch(/^data:/);
    const preview = vi.mocked(renderMapFigure).mock.calls.at(-1)![0];
    expect(preview).toMatchObject({ kind: "scatter3d", view_elev: 55, view_azim: 15, fmt: "png" });

    fireEvent.click(screen.getByTitle(/^Export map/));
    await waitFor(() => expect(useApp.getState().status).toBe("exported scan_map.pdf"));
    const exported = vi.mocked(exportMapFigure).mock.calls[0]![0];
    expect({ ...exported, fmt: "", filename: "" }).toEqual({ ...preview, fmt: "", filename: "" });
  });

  it("an out-of-range angle is refused with the reason and not stored", async () => {
    render(<MapStage />);
    await waitFor(() => expect(useApp.getState().status).toMatch(/offline grid/));
    fireEvent.click(await screen.findByLabelText("3-D view"));
    fireEvent.change(await screen.findByLabelText("3-D view kind"), { target: { value: "Surface" } });
    const elev = screen.getByLabelText("Elevation (°)");
    fireEvent.change(elev, { target: { value: "120" } });
    fireEvent.blur(elev);
    expect(view3d()?.elev).toBe(30);
    expect(elev.getAttribute("aria-invalid")).toBe("true");
  });

  it("the export dialog's 3-D choice is kept with the map, so the preview becomes the export", async () => {
    vi.mocked(askParams).mockImplementation(async (_t, fields) => ({
      ...Object.fromEntries(fields.map((f) => [f.key, f.default])),
      fmt: "png", view: "3-D waterfall", elev: 10, azim: 200, title: "wf",
    }));
    render(<MapStage />);
    await waitFor(() => expect(useApp.getState().status).toMatch(/offline grid/));
    fireEvent.click(await screen.findByTitle(/^Export map/));
    await waitFor(() => expect(useApp.getState().status).toBe("exported scan_map.png"));
    expect(view3d()).toMatchObject({ kind: "waterfall", elev: 10, azim: 200, title: "wf" });
    // PNG of a 3-D view is the server render, not a canvas grab.
    expect(vi.mocked(exportMapFigure).mock.calls[0]![0]).toMatchObject({ kind: "waterfall", fmt: "png", view_elev: 10 });
    // ...and undo returns to the 2-D map.
    useApp.getState().undo();
    expect(view3d()).toBeUndefined();
  });

  it("a refused export angle in the dialog exports nothing and changes nothing", async () => {
    vi.mocked(askParams).mockImplementation(async (_t, fields) => ({
      ...Object.fromEntries(fields.map((f) => [f.key, f.default])),
      fmt: "pdf", view: "Surface", elev: 200,
    }));
    render(<MapStage />);
    await waitFor(() => expect(useApp.getState().status).toMatch(/offline grid/));
    fireEvent.click(await screen.findByTitle(/^Export map/));
    await waitFor(() => expect(useApp.getState().status).toMatch(/refused — elevation/));
    expect(exportMapFigure).not.toHaveBeenCalled();
    expect(view3d()).toBeUndefined();
  });

  it("a 3-D scatter of scattered data previews and exports the ORIGINAL points", async () => {
    useApp.getState().setMapView3d("scan", { kind: "scatter3d", elev: 30, azim: -60, zLabel: "", zUnit: "", style: "default", title: "" });
    vi.mocked(askParams).mockImplementation(async (_t, fields) => ({
      ...Object.fromEntries(fields.map((f) => [f.key, f.default])), fmt: "svg",
    }));
    render(<MapStage />);
    await screen.findByAltText("3-D map preview");
    const preview = vi.mocked(renderMapFigure).mock.calls.at(-1)![0];
    // the offline regrid is not the measured grid: the 16 source rows go out, no z_grid
    expect(preview).toMatchObject({ contour_source: "points", kind: "scatter3d" });
    expect(preview.z_grid).toBeUndefined();
    expect(preview.z_values).toEqual(Array.from({ length: 16 }, (_, k) => 1 + k));
    expect((await screen.findByText(/16 original points/)).textContent).toBe("Plotting 16 original points.");
    fireEvent.click(screen.getByTitle(/^Export map/));
    await waitFor(() => expect(useApp.getState().status).toBe("exported scan_map.svg"));
    const exported = vi.mocked(exportMapFigure).mock.calls[0]![0];
    expect({ ...exported, fmt: "", filename: "" }).toEqual({ ...preview, fmt: "", filename: "" });
  });

  it("a stale preview is dimmed, marked busy and not described until the new picture arrives", async () => {
    let finish: (b: Blob) => void = () => {};
    useApp.getState().setMapView3d("scan", { kind: "surface", elev: 30, azim: -60, zLabel: "", zUnit: "", style: "default", title: "" });
    render(<MapStage />);
    await screen.findByAltText("3-D map preview");
    const host = () => document.querySelector("[data-map3d-preview]")!;
    expect(host().getAttribute("aria-busy")).toBe("false");
    vi.mocked(renderMapFigure).mockImplementationOnce(() => new Promise<Blob>((r) => { finish = r; }));
    act(() => useApp.getState().setMapView3d("scan", { kind: "surface", elev: 60, azim: -60, zLabel: "", zUnit: "", style: "default", title: "" }));
    // the new render is in flight: the old picture stays, dimmed and flagged, with no caption for the new inputs
    await waitFor(() => expect(host().getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByAltText("3-D map preview")).toBeTruthy();
    expect(screen.getByText(/Updating 3-D view/)).toBeTruthy();
    expect(host().querySelector("[data-map3d-caption]")).toBeNull();
    await waitFor(() => expect(vi.mocked(renderMapFigure).mock.calls.length).toBeGreaterThan(1));
    act(() => finish(new Blob(["png"], { type: "image/png" })));
    await waitFor(() => expect(host().getAttribute("aria-busy")).toBe("false"));
    expect(screen.queryByText(/Updating 3-D view/)).toBeNull();
  });

  it("a failed export leaves the figure state alone (the dialog's 3-D choice is kept only on success)", async () => {
    vi.mocked(exportMapFigure).mockRejectedValueOnce(new Error("server down"));
    vi.mocked(askParams).mockImplementation(async (_t, fields) => ({
      ...Object.fromEntries(fields.map((f) => [f.key, f.default])), fmt: "pdf", view: "Surface", elev: 20, azim: 10,
    }));
    render(<MapStage />);
    await waitFor(() => expect(useApp.getState().status).toMatch(/offline grid/));
    fireEvent.click(await screen.findByTitle(/^Export map/));
    await waitFor(() => expect(useApp.getState().status).toMatch(/map export failed — server down/));
    expect(view3d()).toBeUndefined();
  });

  it("a server refusal (too few points) is shown as the reason, not a blank view", async () => {
    vi.mocked(renderMapFigure).mockRejectedValueOnce(new Error("a 3-D waterfall needs at least 2 curves"));
    useApp.getState().setMapView3d("scan", { kind: "waterfall", elev: 30, azim: -60, zLabel: "", zUnit: "", style: "default", title: "" });
    render(<MapStage />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/at least 2 curves/);
  });
});
