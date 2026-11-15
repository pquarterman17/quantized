// A native-grid dataset (image, Igor wave, NeXus grid: metadata.map_grid ===
// "native") is shown as crisp cells whatever the Antialias preference says; any
// other map still follows the preference.

import { render, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_MAP_VIEWS } from "../../lib/mapView";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import MapStage from "./MapStage";
import * as mapRender from "./mapRender";

vi.mock("./mapRender", async (orig) => ({
  ...(await orig<typeof import("./mapRender")>()),
  draw: vi.fn(() => null),
}));

function grid(meta: Record<string, unknown>): Dataset {
  const values: number[][] = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) values.push([i, j, 10 * j + i]);
  return {
    id: "g",
    name: "g.png",
    data: {
      time: values.map((r) => r[0]),
      values,
      labels: ["X", "Y", "Intensity"],
      units: ["px", "px", ""],
      metadata: { is2D: true, map_shape: [4, 4], ...meta },
    },
  };
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 400 });
});
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.mocked(mapRender.draw).mockClear();
  useApp.setState({ mapViews: EMPTY_MAP_VIEWS, status: "", antialias: true });
});

const smoothArg = () => vi.mocked(mapRender.draw).mock.calls.at(-1)?.[6];

describe("MapStage native grids are drawn crisp", () => {
  it("turns smoothing off for map_grid native even when Antialias is on", async () => {
    useApp.getState().loadWorkspace({ datasets: [grid({ map_grid: "native" })], activeId: "g" });
    render(<MapStage />);
    await waitFor(() => expect(smoothArg()).toBeDefined());
    expect(smoothArg()).toBe(false);
  });

  it("keeps the preference for any other map", async () => {
    useApp.getState().loadWorkspace({ datasets: [grid({})], activeId: "g" });
    render(<MapStage />);
    await waitFor(() => expect(smoothArg()).toBeDefined());
    expect(smoothArg()).toBe(true);
  });
});
