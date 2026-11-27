// Item 48 leftovers: grouped bars, absolute sizes and vector colour columns in the 3-D panel,
// the panel opening itself for a refusal it can fix, and docking beside the scene.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAP3D_PANEL_PREFS_KEY } from "../../lib/map3dPanelPrefs";
import { DEFAULT_MAP3D, type Map3dView } from "../../lib/mapView3d";
import type { MapPayload } from "../../lib/mapdataFetch";
import { useApp } from "../../store/useApp";
import Map3dStageView from "./Map3D/Map3dStageView";
import { sceneFromBody } from "./Map3D/scene3d";
import Map3dExtFields from "./Map3dExtFields";
import { DOCK_INSET, MIN_SCENE_W, dockFits } from "./map3dDockFit";
import { refusalFixedInPanel } from "./map3dPanelRefusals";
import MapToolbar, { type MapToolbarProps } from "./MapToolbar";
import { map3dPanelSettled, setMap3dPanelOpen, useMap3dPanelOpen } from "./useMap3dPanelOpen";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  localStorage.clear();
  setMap3dPanelOpen(false);
  map3dPanelSettled();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fields(v3: Partial<Map3dView>) {
  useApp.getState().loadWorkspace({
    datasets: [{ id: "d", name: "d.dat", data: { time: [0], values: [[1, 2, 3, 4]], labels: ["A", "B", "C", "D"], units: ["", "", "", ""], metadata: { text_columns: { g: ["x"] } } } }],
    activeId: "d",
  });
  const edit = vi.fn();
  render(<Map3dExtFields datasetId="d" view3d={{ ...DEFAULT_MAP3D, ...v3 }} edit={edit} />);
  return edit;
}

describe("the bar controls", () => {
  it("side by side and data-unit sizes are stored opt-in", () => {
    const edit = fields({ kind: "bars3d" });
    fireEvent.click(screen.getByLabelText("Group bars side by side"));
    expect(edit).toHaveBeenLastCalledWith({ ext: { barSide: true } });
    fireEvent.click(screen.getByLabelText("Bar sizes in data units"));
    expect(edit).toHaveBeenLastCalledWith({ ext: { barAbs: true } });
  });

  it("with data-unit sizes on, the fields are blank until typed and refuse zero and negatives", () => {
    const edit = fields({ kind: "bars3d", ext: { barAbs: true } });
    const w = screen.getByLabelText("Bar width (data units)") as HTMLInputElement;
    expect(w.value).toBe("");
    for (const bad of ["0", "-2"]) {
      fireEvent.change(w, { target: { value: bad } });
      fireEvent.keyDown(w, { key: "Enter" });
      expect(w.getAttribute("aria-invalid")).toBe("true");
    }
    expect(edit).not.toHaveBeenCalled();
    fireEvent.change(w, { target: { value: "0.25" } });
    fireEvent.keyDown(w, { key: "Enter" });
    expect(edit).toHaveBeenLastCalledWith({ ext: { barAbs: true, barAW: 0.25 } });
    expect(screen.queryByLabelText("Bar width")).toBeNull();
  });
});

describe("the vector colour column", () => {
  it("a number column clears the length and fixed colours; a text column is stored by name", () => {
    const edit = fields({ kind: "vectors3d", ext: { vecLen: true, vecColor: "#112233" } });
    fireEvent.change(screen.getByLabelText("Vector colour column"), { target: { value: "4" } });
    expect(edit).toHaveBeenLastCalledWith({ ext: { vecCCol: 4 } });
    fireEvent.change(screen.getByLabelText("Vector colour column"), { target: { value: "t:g" } });
    expect(edit).toHaveBeenLastCalledWith({ ext: { vecCText: "g" } });
  });

  it("choosing colour by length clears a column pick", () => {
    const edit = fields({ kind: "vectors3d", ext: { vecCCol: 4 } });
    fireEvent.click(screen.getByLabelText("Colour vectors by length"));
    expect(edit).toHaveBeenLastCalledWith({ ext: { vecLen: true } });
  });
});

describe("refusals the panel can fix", () => {
  const pts = { contour_source: "points" as const, x_axis: [0, 1, 2], y_axis: [0, 1, 2], z_values: [1, 2, 3] };
  const refusal = (b: object): string => {
    const s = sceneFromBody(b as never);
    if (!("error" in s)) throw new Error("expected a refusal");
    return s.error;
  };
  const many = Array.from({ length: 11 }, (_, i) => `n${i}`);
  const vec = { vec_dx: [1, 1, 1], vec_dy: [0, 0, 0], vec_dz: [0, 0, 0] };
  const IN_PANEL = {
    "vector columns not picked": { kind: "vectors3d", ...pts },
    "11 vector categories": { kind: "vectors3d", ...pts, ...vec, vec_group: [0, 1, 2], vec_group_names: many },
    "two vector colourings": { kind: "vectors3d", ...pts, ...vec, vec_cval: [1, 2, 3], vec_color: "#112233" },
    "11 bar categories": { kind: "bars3d", ...pts, bar_group: [0, 1, 2], bar_group_names: many },
    "bars from a column and a fixed colour": { kind: "bars3d", ...pts, bar_cval: [1, 2, 3], bar_color: "#112233" },
    "grouped without categories": { kind: "bars3d", ...pts, bar_grouped: true },
    "grouped with repeats": { kind: "bars3d", contour_source: "points", x_axis: [0, 0, 1, 2], y_axis: [0, 0, 1, 2], z_values: [1, 2, 3, 4], bar_group: [0, 0, 0, 0], bar_group_names: ["a"], bar_grouped: true },
    "absolute size missing": { kind: "bars3d", ...pts, bar_abs: true, bar_abs_w: 1 },
    "absolute size not above zero": { kind: "bars3d", ...pts, bar_abs: true, bar_abs_w: 1, bar_abs_d: -1 },
    "scatter groups and colour": { kind: "scatter3d", ...pts, sc_color: [1, 2, 3], sc_group: [0, 1, 0], sc_group_names: ["a", "b"] },
  };
  const n = 10_001;
  const ELSEWHERE = {
    "grid too small": { kind: "bars3d", x_axis: [0], y_axis: [0], z_grid: [[1]] },
    "too many bars": { kind: "bars3d", contour_source: "points", x_axis: Array.from({ length: n }, (_, i) => i), y_axis: Array.from({ length: n }, (_, i) => i % 7), z_values: Array.from({ length: n }, () => 1) },
    "vectors from a grid": { kind: "vectors3d", x_axis: [0, 1], y_axis: [0, 1], z_grid: [[1, 2], [3, 4]] },
    "no finite vector": { kind: "vectors3d", ...pts, vec_dx: [0, 0, 0], vec_dy: [0, 0, 0], vec_dz: [0, 0, 0] },
  };

  it.each(Object.entries(IN_PANEL))("%s: opens the panel", (_n, body) => {
    expect(refusalFixedInPanel(refusal(body))).toBe(true);
  });
  it.each(Object.entries(ELSEWHERE))("%s: does not", (_n, body) => {
    expect(refusalFixedInPanel(refusal(body))).toBe(false);
  });
});

describe("the panel opens itself once for such a refusal", () => {
  const payload: MapPayload = {
    xAxis: [0, 1], yAxis: [0, 1], zGrid: [[1, 2], [3, 4]], xLabel: "x", xUnit: "", yLabel: "y", yUnit: "", zLabel: "z", zUnit: "", zMin: 1, zMax: 4,
  };
  const view = (v3: Partial<Map3dView>, docked = false) => (
    <Map3dStageView datasetId="d" payload={payload} fresh view3d={{ ...DEFAULT_MAP3D, ...v3 }} cmap="viridis" logZ={false} colorLimits={null} top={0} data={undefined} keys={[0, 1, 2]} docked={docked} />
  );
  function Probe() {
    return <span data-testid="open">{String(useMap3dPanelOpen()[0])}</span>;
  }

  it("opens for the missing vector columns, not remembered, and stays closed once closed", async () => {
    const { rerender } = render(<><Probe />{view({ kind: "vectors3d" })}</>);
    await waitFor(() => expect(screen.getByTestId("open").textContent).toBe("true"));
    expect(localStorage.getItem(MAP3D_PANEL_PREFS_KEY)).toBeNull();
    act(() => setMap3dPanelOpen(false));
    rerender(<><Probe />{view({ kind: "vectors3d", style: "aps" })}</>);
    expect(screen.getByTestId("open").textContent).toBe("false");
  });

  it("does not open for a refusal the panel cannot fix", () => {
    const empty = { ...payload, zGrid: [[null, null], [null, null]] } as MapPayload;
    render(<><Probe /><Map3dStageView datasetId="d" payload={empty} fresh view3d={{ ...DEFAULT_MAP3D, kind: "bars3d" }} cmap="viridis" logZ={false} colorLimits={null} top={0} data={undefined} keys={[0, 1, 2]} /></>);
    expect(screen.getByRole("alert").textContent).toContain("at least 1 finite bar");
    expect(screen.getByTestId("open").textContent).toBe("false");
  });

  it("leaves the docked strip free", () => {
    const { container } = render(view({ kind: "vectors3d" }, true));
    expect((container.querySelector("[data-map3d-view]") as HTMLElement).style.right).toBe(`${8 + DOCK_INSET}px`);
  });
});

describe("docking beside the scene", () => {
  it("fits exactly when the scene keeps MIN_SCENE_W after the panel", () => {
    const edge = MIN_SCENE_W + 16 + DOCK_INSET;
    expect(edge).toBe(754);
    expect(dockFits(edge)).toBe(true);
    expect(dockFits(edge - 1)).toBe(false);
    expect(dockFits(undefined)).toBe(false);
    expect(dockFits(0)).toBe(false);
  });

  const props = (): MapToolbarProps =>
    ({
      datasetId: "ds-a", painted: null, qAvailable: false, isAngular: false, isQ: false, onAngular: vi.fn(), onQ: vi.fn(),
      labels: ["x", "y", "z"], keys: [0, 1, 2], onKeyChange: vi.fn(), cmap: "viridis", cmapOptions: ["viridis"], onCmapChange: vi.fn(),
      logZ: false, onToggleLogZ: vi.fn(), contourOn: false, onToggleContour: vi.fn(), cutSpace: null, gridable: true, cutMode: "h",
      onSetCutMode: vi.fn(), cutWidth: 0, onSetCutWidth: vi.fn(), cutWidthTooltip: "", onProjection: vi.fn(), roiMode: "off", onToggleRoi: vi.fn(),
      rulerMode: "off", onToggleRuler: vi.fn(), wedgeMode: "off", onToggleWedge: vi.fn(), boxDrawable: false, pickMode: "off", onTogglePick: vi.fn(), onExport: vi.fn(),
    }) as MapToolbarProps;

  it("a wide stage leaves the toolbar without an overlay (the stage docks it); a narrow one keeps the overlay", async () => {
    useApp.setState({ layoutMode: "classic" });
    localStorage.setItem(MAP3D_PANEL_PREFS_KEY, JSON.stringify({ open: true }));
    const spy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
    const wide = render(<div className="qzk-stage"><MapToolbar {...props()} /></div>);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("group", { name: "3-D view" })).toBeNull();
    expect(screen.getByRole("button", { name: "3-D view" }).getAttribute("aria-expanded")).toBe("true");
    wide.unmount();
    spy.mockReturnValue(700);
    render(<div className="qzk-stage"><MapToolbar {...props()} /></div>);
    expect(await screen.findByRole("group", { name: "3-D view" })).toBeTruthy();
  });
});
