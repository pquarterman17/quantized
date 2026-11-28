// Map gridding in windows layout: the formula and pixel-extraction jobs act on the map WINDOW in use, not the
// Library-active dataset (owner decision 2026-11-28; a Library click leaves activeId alone, m-1). The mocks
// compute from the request's own dataset, so a job that read the wrong map would show the wrong numbers.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { DataStruct } from "../../../lib/types";
import { dock, emptyLayout } from "../../../lib/windowLayout/ops";
import { useApp } from "../../../store/useApp";
import MapGridPanel from "./MapGridPanel";

const { formulaMock, extractMock } = vi.hoisted(() => ({ formulaMock: vi.fn(), extractMock: vi.fn() }));
vi.mock("../../../lib/api/mapGrid", () => ({ gridXyz: vi.fn(), mapFormula: formulaMock, extractPixels: extractMock }));

// The layout host places a tool window in a dock (not under test here): render its body in place.
vi.mock("../../overlays/ToolWindow", () => ({ default: ({ children }: { children: unknown }) => children }));

const map = (z: number[]): DataStruct => ({
  time: [0, 1, 0, 1],
  values: [[0, 0, z[0]!], [1, 0, z[1]!], [0, 1, z[2]!], [1, 1, z[3]!]],
  labels: ["Qx", "Qz", "Intensity"],
  units: ["1/A", "1/nm", "cts"],
  metadata: { is2D: true, map_shape: [2, 2], map_grid: "native" },
});
const A = [1, 2, 3, 4];
const B = [10, 20, 30, 40];
const sheet: DataStruct = { time: [1, 2], values: [[1, 2], [3, 4]], labels: ["T", "R"], units: ["K", "ohm"], metadata: {} };
const win = (id: string, kind: PlotWindow["kind"], datasetId: string, z: number): PlotWindow => ({
  id, kind, title: id, datasetId, geometry: { x: 0, y: 0, w: 300, h: 200 }, z, winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
});
const layoutOf = (...ids: string[]) => ids.reduce((l, id) => dock(l, `plot:${id}`, "centre"), emptyLayout());

function setWindows(plotWindows: PlotWindow[], activeId: string, windowsMode = true): void {
  useApp.setState({
    layoutMode: windowsMode ? "windows" : "classic",
    plotWindows,
    windowLayout: windowsMode ? layoutOf(...plotWindows.map((w) => w.id)) : null,
    activeId,
  });
}
const job = (name: string) => fireEvent.change(screen.getByLabelText("Gridding job"), { target: { value: name } });
const apply = () => fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
const sourceIds = (): string[] => useApp.getState().analysisResults.filter((r) => r.producer.id === "map-grid").flatMap((r) => r.sources.map((s) => s.datasetId));

beforeEach(() => {
  vi.clearAllMocks();
  // z * 2, computed from the dataset the panel sent (the server's job, mirrored here).
  formulaMock.mockImplementation(async (b: { dataset: DataStruct }) => ({ ...b.dataset, values: b.dataset.values.map((r) => [r[0]!, r[1]!, r[2]! * 2]) }));
  // The value at (0, 0) of EVERY map sent, one row per map.
  extractMock.mockImplementation(async (b: { maps: { name: string; dataset: DataStruct }[] }) => ({
    time: b.maps.map((_m, i) => i + 1), values: b.maps.map((m) => [m.dataset.values[0]![2]!]), labels: ["Value"], units: ["cts"], metadata: {},
  }));
  useApp.setState({
    datasets: [
      { id: "s", name: "sweep.dat", data: sheet },
      { id: "a", name: "mapA", data: map(A) },
      { id: "b", name: "mapB", data: map(B) },
    ],
    status: "",
    analysisResults: [],
  });
});
afterEach(() => {
  cleanup();
  useApp.setState({ layoutMode: "classic", plotWindows: [], windowLayout: null });
});

describe("MapGridPanel in windows layout", () => {
  it("the formula acts on the focused map window's map, whatever is active, and records it as the source", async () => {
    setWindows([win("m1", "map", "a", 1), win("m2", "map", "b", 2)], "s");
    render(<MapGridPanel />);
    job("formula");
    expect(screen.getByText("Acts on map: mapB")).toBeInTheDocument();
    apply();
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    expect((formulaMock.mock.calls[0]![0] as { dataset: DataStruct }).dataset.values.map((r) => r[2])).toEqual(B);
    const made = useApp.getState().datasets[3]!;
    expect(made.name).toMatch(/^mapB · /);
    expect(made.data.values.map((r) => r[2])).toEqual(B.map((v) => v * 2));
    expect(sourceIds()).toEqual(["b"]);
  });

  it("a focus switch to the other map window retargets the panel", async () => {
    setWindows([win("m1", "map", "a", 1), win("m2", "map", "b", 2)], "s");
    render(<MapGridPanel />);
    job("formula");
    expect(screen.getByText("Acts on map: mapB")).toBeInTheDocument();
    act(() => setWindows([win("m1", "map", "a", 3), win("m2", "map", "b", 2)], "s"));
    expect(screen.getByText("Acts on map: mapA")).toBeInTheDocument();
    apply();
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    expect((formulaMock.mock.calls[0]![0] as { dataset: DataStruct }).dataset.values.map((r) => r[2])).toEqual(A);
    expect(sourceIds()).toEqual(["a"]);
  });

  it("the extraction reads the focused map by default, and the user's own ticks win", async () => {
    setWindows([win("m1", "map", "a", 1), win("m2", "map", "b", 2)], "s");
    render(<MapGridPanel />);
    job("extract");
    fireEvent.change(screen.getByLabelText("Location X"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Location Y"), { target: { value: "0" } });
    expect(screen.getByLabelText("mapA")).not.toBeChecked();
    expect(screen.getByLabelText("mapB")).toBeChecked();
    apply();
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    expect((extractMock.mock.calls[0]![0] as { maps: { dataset: DataStruct }[] }).maps.map((m) => m.dataset.values[0]![2])).toEqual([B[0]]);
    expect(useApp.getState().datasets[3]!.data.values).toEqual([[B[0]]]);
    expect(sourceIds()).toEqual(["b"]);
    fireEvent.click(screen.getByLabelText("mapA"));
    apply();
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(5));
    expect((extractMock.mock.calls[1]![0] as { maps: { name: string }[] }).maps.map((m) => m.name)).toEqual(["mapA", "mapB"]);
  });

  it("with a plot window in front the active map is used; a non-map everywhere gives a notice and no request", async () => {
    setWindows([win("m1", "map", "a", 1), win("p", "plot", "s", 2)], "a");
    render(<MapGridPanel />);
    job("formula");
    expect(screen.getByText("Acts on map: mapA")).toBeInTheDocument();
    act(() => setWindows([win("p", "plot", "s", 2)], "s"));
    expect(screen.getByText(/No map in use/)).toBeInTheDocument();
    apply();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Select a 2-D map/);
    expect(formulaMock).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toHaveLength(3);
    // The Library-active map still counts when it has no window (nothing silently falls to a sheet).
    act(() => setWindows([win("p", "plot", "s", 2)], "b"));
    expect(screen.getByText("Acts on map: mapB")).toBeInTheDocument();
  });

  it("classic layout keeps using the active dataset", async () => {
    setWindows([win("m1", "map", "a", 1), win("m2", "map", "b", 2)], "a", false);
    render(<MapGridPanel />);
    job("formula");
    expect(screen.getByText("Acts on map: mapA")).toBeInTheDocument();
    apply();
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    expect(sourceIds()).toEqual(["a"]);
    cleanup();
    act(() => setWindows([], "s", false));
    render(<MapGridPanel />);
    job("formula");
    expect(screen.getByText(/No map in use/)).toBeInTheDocument();
  });
});
