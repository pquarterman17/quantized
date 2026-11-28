// The Polygon tool at the layer the user touches: the real MapStage toolbar and canvas
// pointer / keyboard events, the app's Escape ladder (useGlobalShortcuts), and then the
// Map analysis panel's "Volume over a region" with the polygon just drawn.
//
// The polygon and dataset are tests/fixtures/wire/map_polygon_volume.json, the same
// contract tests/test_map_polygon_volume_wire.py integrates on the backend against an
// independent numpy mask. Here the vertices are placed with pointer events, the request
// the panel sends is read back, and the cells it selects are summed with a mask written
// in this file: it must reproduce the fixture's frozen pixel volume.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import wire from "../../../../tests/fixtures/wire/map_polygon_volume.json";
import type { DataStruct, Dataset } from "../../lib/types";
import { useGlobalShortcuts } from "../../useGlobalShortcuts";
import { useApp } from "../../store/useApp";
import MapAnalysisPanel from "../workshops/mapanalysis/MapAnalysisPanel";
import { dataToPx } from "./mapRender";
import MapStage from "./MapStage";

const { volumeMock } = vi.hoisted(() => ({ volumeMock: vi.fn() }));
vi.mock("../../lib/api/mapAnalysis", () => ({ mapPeaks: vi.fn(), mapVolume: volumeMock }));

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const DS: Dataset = { id: "ft", name: "field_temp.csv", data: wire.dataset as unknown as DataStruct };
const W = 600;
const H = 400;
/** The map's own axes as the stage lays them out (units differ, so no aspect lock). */
const AXES = { xAxis: [0, 10], yAxis: [0, 8], zGrid: [], xLabel: "Field", xUnit: "T", yLabel: "Temp", yUnit: "K", zLabel: "Signal", zUnit: "V", zMin: 0, zMax: 1 };
const px = (x: number, y: number): [number, number] => dataToPx(AXES, W, H, x, y)!;
const POLY = wire.region.points as [number, number][];

let widthSpy: PropertyDescriptor | undefined;
let heightSpy: PropertyDescriptor | undefined;
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
  widthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  heightSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: W });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: H });
});
afterAll(() => {
  vi.unstubAllGlobals();
  if (widthSpy) Object.defineProperty(HTMLElement.prototype, "clientWidth", widthSpy);
  if (heightSpy) Object.defineProperty(HTMLElement.prototype, "clientHeight", heightSpy);
});

beforeEach(() => {
  vi.clearAllMocks();
  volumeMock.mockResolvedValue({ time: [1], values: [[1]], labels: ["Volume"], units: [""], metadata: { map_volume: { volume: 1, area: 1, n_cells: 1, n_nan: 0, mean: 1 } } });
  useApp.getState().loadWorkspace({ datasets: [DS], activeId: "ft" });
  useApp.setState({ mapRes: 100, mapRoi: null, mapRuler: null, mapPolygon: null, history: [], future: [], status: "" });
});

function Harness() {
  useGlobalShortcuts(); // the app's Escape ladder and global Delete, as in the running app
  return (
    <>
      <MapStage />
      <MapAnalysisPanel />
    </>
  );
}

async function mapReady() {
  await waitFor(() => expect(useApp.getState().status).toMatch(/offline grid/));
}

const press = (canvas: HTMLElement, at: [number, number]) => {
  fireEvent.pointerDown(canvas, { clientX: at[0], clientY: at[1], button: 0 });
  fireEvent.pointerUp(canvas, { clientX: at[0], clientY: at[1], button: 0 });
};
const drawOpen = (canvas: HTMLElement, pts: [number, number][]) => pts.forEach((p) => press(canvas, px(p[0], p[1])));
const arm = () => fireEvent.click(screen.getByRole("button", { name: "Polygon ROI" }));
const draftCount = (c: HTMLElement) => c.querySelectorAll('[data-roi-handle^="draft-"]').length;
const closedCount = (c: HTMLElement) => c.querySelectorAll('[data-roi-handle^="polygon-"]').length;

function expectNear(got: number[][], want: number[][], tol: number) {
  expect(got).toHaveLength(want.length);
  got.forEach((p, i) => {
    expect(Math.abs(p[0]! - want[i]![0]!)).toBeLessThan(tol);
    expect(Math.abs(p[1]! - want[i]![1]!)).toBeLessThan(tol);
  });
}

/** Even-odd cell membership, written here (not the backend's), summed over the fixture's grid. */
function pixelVolume(points: number[][]): { n: number; volume: number } {
  let n = 0;
  let volume = 0;
  for (const [x, y, z] of wire.dataset.values as number[][]) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i]!;
      const [xj, yj] = points[j]!;
      if (yi! > y! !== yj! > y! && x! < ((xj! - xi!) * (y! - yi!)) / (yj! - yi!) + xi!) inside = !inside;
    }
    if (inside) {
      n++;
      volume += z!; // cell area is 1 x 1
    }
  }
  return { n, volume };
}

describe("Polygon tool: draw and edit", () => {
  it("draws with clicks, closes on a double-click, and shows only the closed shape", async () => {
    const view = render(<Harness />);
    await mapReady();
    arm();
    const canvas = view.container.querySelector("canvas")!;
    drawOpen(canvas, POLY);
    expect(draftCount(view.container)).toBe(4);
    expect(useApp.getState().mapPolygon).toBeNull(); // nothing half-drawn reaches the store
    fireEvent.doubleClick(canvas);
    const poly = useApp.getState().mapPolygon!;
    expect(poly.space).toBe("map");
    expect(poly.axes).toEqual(["Field", "Temp"]);
    expectNear(poly.points, POLY, 0.06);
    expect(draftCount(view.container)).toBe(0);
    expect(closedCount(view.container)).toBe(4);
    expect(await screen.findByLabelText("Remove this polygon")).toBeInTheDocument();
  });

  it("closes with Enter, or with a click back on the first vertex", async () => {
    const view = render(<Harness />);
    await mapReady();
    arm();
    const canvas = view.container.querySelector("canvas")!;
    drawOpen(canvas, POLY);
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(useApp.getState().mapPolygon?.points).toHaveLength(4);

    act(() => useApp.getState().setMapPolygon(null));
    drawOpen(canvas, POLY);
    press(canvas, px(POLY[0]![0], POLY[0]![1]));
    expect(useApp.getState().mapPolygon?.points).toHaveLength(4);
  });

  it("refuses to close two vertices, with the reason, and keeps drawing", async () => {
    const view = render(<Harness />);
    await mapReady();
    arm();
    const canvas = view.container.querySelector("canvas")!;
    drawOpen(canvas, POLY.slice(0, 2));
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(useApp.getState().mapPolygon).toBeNull();
    expect(useApp.getState().status).toMatch(/at least 3 vertices \(2 so far\)/);
    expect(draftCount(view.container)).toBe(2);
  });

  it("Backspace takes the last vertex back and never removes the dataset", async () => {
    const view = render(<Harness />);
    await mapReady();
    arm();
    const canvas = view.container.querySelector("canvas")!;
    drawOpen(canvas, POLY.slice(0, 3));
    fireEvent.keyDown(canvas, { key: "Backspace" });
    expect(draftCount(view.container)).toBe(2);
    fireEvent.keyDown(canvas, { key: "Backspace" });
    fireEvent.keyDown(canvas, { key: "Backspace" }); // the last one abandons the outline
    expect(draftCount(view.container)).toBe(0);
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["ft"]);
  });

  it("Escape abandons the outline in one step, through the app's Escape ladder", async () => {
    const view = render(<Harness />);
    await mapReady();
    arm();
    const canvas = view.container.querySelector("canvas")!;
    drawOpen(canvas, POLY.slice(0, 3));
    fireEvent.keyDown(canvas, { key: "Escape" });
    await waitFor(() => expect(draftCount(view.container)).toBe(0));
    expect(useApp.getState().mapPolygon).toBeNull();
    expect(screen.getByRole("button", { name: "Polygon ROI" })).toHaveAttribute("aria-pressed", "true"); // the tool stays armed
  });

  it("drags a vertex of the closed polygon, and Escape mid-drag puts it back", async () => {
    const view = render(<Harness />);
    await mapReady();
    arm();
    const canvas = view.container.querySelector("canvas")!;
    drawOpen(canvas, POLY);
    fireEvent.keyDown(canvas, { key: "Enter" });
    const before = useApp.getState().mapPolygon!.points.map((p) => [...p]);

    const from = px(POLY[2]![0], POLY[2]![1]);
    const to = px(8, 7);
    fireEvent.pointerDown(canvas, { clientX: from[0], clientY: from[1], button: 0 });
    fireEvent.pointerMove(canvas, { clientX: to[0], clientY: to[1] });
    const moved = useApp.getState().mapPolygon!.points;
    expectNear([moved[2]!], [[8, 7]], 0.06);
    expectNear([moved[0]!, moved[1]!, moved[3]!], [before[0]!, before[1]!, before[3]!], 1e-12);
    fireEvent.pointerUp(canvas, { clientX: to[0], clientY: to[1], button: 0 });
    expectNear([useApp.getState().mapPolygon!.points[2]!], [[8, 7]], 0.06);

    // A second drag, abandoned with Escape.
    const again = px(8, 7);
    const away = px(2, 1);
    fireEvent.pointerDown(canvas, { clientX: again[0], clientY: again[1], button: 0 });
    fireEvent.pointerMove(canvas, { clientX: away[0], clientY: away[1] });
    expectNear([useApp.getState().mapPolygon!.points[2]!], [[2, 1]], 0.06);
    fireEvent.keyDown(canvas, { key: "Escape" });
    await waitFor(() => expectNear([useApp.getState().mapPolygon!.points[2]!], [[8, 7]], 0.06));
  });

  it("is exclusive with the Box tool and with a box already drawn", async () => {
    const view = render(<Harness />);
    await mapReady();
    useApp.getState().setMapRoi({ space: "map", axes: ["Field", "Temp"], x0: 1, x1: 3, y0: 1, y1: 3 });
    arm();
    const canvas = view.container.querySelector("canvas")!;
    drawOpen(canvas, POLY);
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(useApp.getState().mapRoi).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Integration box" }));
    expect(screen.getByRole("button", { name: "Polygon ROI" })).toHaveAttribute("aria-pressed", "false");
  });

  it("belongs to the axes it was drawn on: other channels hide it", async () => {
    const view = render(<Harness />);
    await mapReady();
    arm();
    drawOpen(view.container.querySelector("canvas")!, POLY);
    fireEvent.keyDown(view.container.querySelector("canvas")!, { key: "Enter" });
    expect(await screen.findByLabelText("Remove this polygon")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Y channel"), { target: { value: "2" } });
    await waitFor(() => expect(screen.queryByLabelText("Remove this polygon")).toBeNull());
    expect(useApp.getState().mapPolygon).not.toBeNull(); // kept, not reinterpreted
  });
});

describe("Polygon tool to ROI volume", () => {
  it("sends the drawn vertices as the volume region, and they select the fixture's cells", async () => {
    const view = render(<Harness />);
    await mapReady();
    arm();
    const canvas = view.container.querySelector("canvas")!;
    drawOpen(canvas, POLY);
    fireEvent.doubleClick(canvas);

    fireEvent.change(screen.getByLabelText("Analysis kind"), { target: { value: "volume" } });
    fireEvent.click(screen.getByRole("button", { name: "Use polygon drawn on the map" }));
    expect(screen.getByLabelText("Volume region")).toHaveTextContent("polygon of 4 vertices");
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(useApp.getState().status).toMatch(/created .*ROI volume/)); // the committed table
    expect(volumeMock).toHaveBeenCalledTimes(1);

    const req = volumeMock.mock.calls[0]![0] as { region: { kind: string; points: number[][] }; x_col: number; y_col: number; z_col: number; rule: string };
    expect(req.region.kind).toBe("polygon");
    expectNear(req.region.points, POLY, 0.06);
    expect([req.x_col, req.y_col, req.z_col]).toEqual([wire.columns.x_col, wire.columns.y_col, wire.columns.z_col]);
    expect(req.rule).toBe("pixel");
    // The cells those vertices select are the cells the backend test integrates.
    const got = pixelVolume(req.region.points);
    expect(got.n).toBe(wire.expected.n_cells);
    expect(got.volume).toBeCloseTo(wire.expected.pixel_volume, 9);
  });

  it("typing a bound afterwards returns to the rectangle (the polygon no longer applies)", async () => {
    const view = render(<Harness />);
    await mapReady();
    arm();
    drawOpen(view.container.querySelector("canvas")!, POLY);
    fireEvent.keyDown(view.container.querySelector("canvas")!, { key: "Enter" });
    fireEvent.change(screen.getByLabelText("Analysis kind"), { target: { value: "volume" } });
    fireEvent.click(screen.getByRole("button", { name: "Use polygon drawn on the map" }));
    fireEvent.change(screen.getByLabelText("X min"), { target: { value: "1" } });
    expect(screen.queryByLabelText("Volume region")).toBeNull();
  });
});
