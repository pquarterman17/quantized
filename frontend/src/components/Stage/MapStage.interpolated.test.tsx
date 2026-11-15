// The Map tab labels an interpolated map (backend `interpolated` flag ->
// payload -> badge) and the vector export carries the same wording.

import { render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { interpolatedNote, type MapPayload } from "../../lib/mapdataFetch";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import MapStage from "./MapStage";
import { mapFigureBody } from "./mapFigureExport";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const cloud: Dataset = {
  id: "c1",
  name: "cloud",
  data: {
    time: [0.1, 4.2, 2.5, 3.3, 1.7, 0.9],
    values: [[1.2, 3], [0.4, 5], [3.1, 2], [2.2, 8], [4.0, 1], [3.5, 6]],
    labels: ["Y", "Z"],
    units: ["", ""],
    metadata: { scatteredXYZ: true },
  },
};

let interpolated = true;

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          x_axis: [0, 1], y_axis: [0, 1], z_grid: [[1, 2], [3, 4]],
          x: { label: "X", unit: "" }, y: { label: "Y", unit: "" },
          z: { label: "Z", unit: "", min: 1, max: 4 },
          interpolated, n_points: 6,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  interpolated = true;
  useApp.getState().loadWorkspace({ datasets: [cloud], activeId: "c1" });
});

describe("interpolated map label", () => {
  it("shows the badge when the backend says the points were interpolated", async () => {
    render(<MapStage />);
    expect(await screen.findByText(interpolatedNote(6))).toBeInTheDocument();
  });

  it("shows no badge for a gridded map", async () => {
    interpolated = false;
    const { container } = render(<MapStage />);
    await waitFor(() => expect(container.querySelector("[data-map-host]")).toBeTruthy());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Interpolated onto/)).toBeNull();
  });
});

describe("mapFigureBody", () => {
  const view = { cmap: "viridis", logZ: false, contour: { on: false, levelCount: 8, scale: "linear" } } as never;
  const opts = { fmt: "pdf", style: "default", title: "", filename: "m" } as never;
  const base: MapPayload = {
    xAxis: [0, 1], yAxis: [0, 1], zGrid: [[1, 2], [3, 4]],
    xLabel: "X", xUnit: "", yLabel: "Y", yUnit: "", zLabel: "Z", zUnit: "", zMin: 1, zMax: 4,
  };

  it("adds the interpolation footnote only for an interpolated map", () => {
    expect(mapFigureBody({ ...base, interpolated: { nPoints: 6 } }, view, opts).note).toBe(interpolatedNote(6));
    expect(mapFigureBody(base, view, opts).note).toBeUndefined();
  });
});
