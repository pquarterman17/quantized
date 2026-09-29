// MapStage ⤓ — the toolbar's export button sends THIS map's payload and view
// (colormap, log scale) to the vector map-figure route. Scaffolding mirrors
// MapStage.mapView.test.tsx: a stubbed host box and an offline regrid; the
// export's own status line is the state the test waits on.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../../lib/api/mapFigure", () => ({ exportMapFigure: vi.fn(() => Promise.resolve()) }));

import { exportMapFigure } from "../../lib/api/mapFigure";
import { EMPTY_MAP_VIEWS } from "../../lib/mapView";
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
  return {
    id,
    name: `${id}.dat`,
    data: {
      time: values.map((_, k) => k),
      values,
      labels: ["X", "Y", "Signal"],
      units: ["mm", "mm", "V"],
      metadata: {},
    },
  };
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
  useApp.getState().loadWorkspace({ datasets: [grid("scan")], activeId: "scan" });
  useApp.setState({ mapViews: EMPTY_MAP_VIEWS, mapRes: 50, status: "" });
});

describe("MapStage export", () => {
  it("⤓ exports this map's grid and view through the vector route", async () => {
    vi.mocked(askParams).mockResolvedValue({ fmt: "svg", style: "default", title: "" });
    render(<MapStage />);
    await waitFor(() => expect(useApp.getState().status).toMatch(/offline grid/));
    useApp.getState().setMapColormap("scan", "rdbu");
    useApp.getState().setMapLogZ("scan", true);

    fireEvent.click(await screen.findByTitle(/^Export map/));
    await waitFor(() => expect(useApp.getState().status).toBe("exported scan_map.svg"));

    const body = vi.mocked(exportMapFigure).mock.calls[0]![0];
    expect(body).toMatchObject({
      fmt: "svg",
      kind: "heatmap",
      cmap: "RdBu_r",
      x_label: "X (mm)",
      y_label: "Y (mm)",
      z_label: "log₁₀ Signal (V)",
      filename: "scan_map",
    });
    expect(body.z_grid!.length).toBe(body.y_axis.length);
  });
});
