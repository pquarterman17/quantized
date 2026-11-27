// The bar / vector controls of the 3-D panel, and the marks they draw: each edit
// is one write of the stored view's `ext`; bars and vectors paint through the
// same `drawScene` as the other kinds, inside the plot's clip.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_MAP3D, type Map3dView } from "../../lib/mapView3d";
import { useApp } from "../../store/useApp";
import { drawScene } from "./Map3D/render3d";
import { frameFor } from "./Map3D/render3dAxes";
import { sceneFromBody, type Scene3d } from "./Map3D/scene3d";
import Map3dExtFields from "./Map3dExtFields";

const INK = { text: "#000", dim: "#555", grid: "#ccc", pane: "#eee", border: "#999", ui: "sans-serif", mesh: "#111", drop: "#555" };

function setup(v3: Partial<Map3dView>) {
  useApp.getState().loadWorkspace({
    datasets: [{ id: "d", name: "d.dat", data: { time: [0], values: [[1, 2, 3, 4]], labels: ["A", "B", "C", "D"], units: ["", "", "", ""], metadata: {} } }],
    activeId: "d",
  });
  const edit = vi.fn();
  render(<Map3dExtFields datasetId="d" view3d={{ ...DEFAULT_MAP3D, ...v3 }} edit={edit} />);
  return edit;
}

describe("Map3dExtFields", () => {
  it("renders nothing for the other kinds", () => {
    const edit = setup({ kind: "surface" });
    expect(screen.queryByLabelText("Bar width")).toBeNull();
    expect(edit).not.toHaveBeenCalled();
  });

  it("bar width commits on Enter, refuses a value above 1, and the colour toggle writes a hex", () => {
    const edit = setup({ kind: "bars3d" });
    const w = screen.getByLabelText("Bar width");
    fireEvent.change(w, { target: { value: "1.5" } });
    fireEvent.keyDown(w, { key: "Enter" });
    expect(edit).not.toHaveBeenCalled();
    expect(w.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(w, { target: { value: "0.5" } });
    fireEvent.keyDown(w, { key: "Enter" });
    expect(edit).toHaveBeenLastCalledWith({ ext: { barW: 0.5 } });
    fireEvent.click(screen.getByLabelText("Bar colour: fixed colour"));
    expect(edit).toHaveBeenLastCalledWith({ ext: { barColor: "#4c78a8" } });
  });

  it("vector columns list the dataset's channels and write the picked index", () => {
    const edit = setup({ kind: "vectors3d", ext: { vecDx: 3 } });
    const dx = screen.getByLabelText("Vector dX") as HTMLSelectElement;
    expect(dx.value).toBe("3");
    expect(Array.from(dx.options).map((o) => o.text)).toEqual(["(pick a column)", "X (first column)", "A", "B", "C", "D"]);
    fireEvent.change(screen.getByLabelText("Vector dY"), { target: { value: "4" } });
    expect(edit).toHaveBeenLastCalledWith({ ext: { vecDx: 3, vecDy: 4 } });
    fireEvent.change(screen.getByLabelText("Vector form"), { target: { value: "end" } });
    expect(edit).toHaveBeenLastCalledWith({ ext: { vecDx: 3, vecEnd: true } });
  });
});

describe("bars and vectors draw inside the plot's clip", () => {
  function painted(b: object) {
    const scene = sceneFromBody(b as never) as Scene3d;
    const f = frameFor(scene, { elev: 30, azim: -60, zoom: 1 }, 800, 600);
    const calls: string[] = [];
    const sets: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, p: string) => (p in t ? t[p] : p === "measureText" ? () => ({ width: 10 }) : p === "createLinearGradient" ? () => ({ addColorStop() {} }) : (..._a: unknown[]) => void calls.push(p)),
      set: (t, p: string, v) => ((t[p] = v), sets.push(`${p}=${String(v)}`), true),
    });
    const stats = drawScene(ctx as unknown as CanvasRenderingContext2D, f, scene, INK, false, 1);
    return { stats, calls, sets };
  }

  it("bars paint three faces a bar, filled and stroked", () => {
    const { stats, calls } = painted({ kind: "bars3d", x_axis: [0, 1, 2], y_axis: [0, 1], z_grid: [[1, 2, 3], [2, 3, 4]] });
    expect(stats.drawn).toBe(18);
    expect(calls.filter((c) => c === "fill").length).toBeGreaterThanOrEqual(18);
  });

  it("vectors paint one stroked path of every segment, in their own colour", () => {
    const { stats, sets } = painted({
      kind: "vectors3d", contour_source: "points", x_axis: [0, 1], y_axis: [0, 1], z_values: [0, 1],
      vec_dx: [1, 1], vec_dy: [0, 1], vec_dz: [1, 0], vec_color: "#aa3311",
    });
    expect(stats.drawn).toBe(2);
    expect(sets).toContain("strokeStyle=#aa3311");
  });
});
