// MapStage ⤓ while the map is regridding. Switching dataset (or channels)
// keeps the previous grid on screen until the new one lands; an export in
// that window used to send the OLD dataset's grid under the NEW dataset's
// filename, colour limits and log scale. Forced here by holding the second
// regrid open.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function grid(id: string, z: string): Dataset {
  const values: number[][] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) values.push([i, j, 1 + i * 4 + j]);
  return {
    id,
    name: `${id}.dat`,
    data: { time: values.map((_, k) => k), values, labels: ["X", "Y", z], units: ["mm", "mm", "V"], metadata: {} },
  };
}

// Requests fail over to the offline grid at once until `hold` is set; after
// that they hang (until aborted), so the next regrid stays pending.
let hold = false;
let held = 0;
function fetchStub(_url: string, init?: RequestInit): Promise<never> {
  if (!hold) return Promise.reject(new Error("offline"));
  held += 1;
  return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
}

let widthSpy: PropertyDescriptor | undefined;
let heightSpy: PropertyDescriptor | undefined;

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("fetch", fetchStub);
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
  hold = false;
  held = 0;
  vi.mocked(exportMapFigure).mockClear();
  vi.mocked(askParams).mockResolvedValue({ fmt: "svg", style: "default", title: "" });
  useApp.getState().loadWorkspace({ datasets: [grid("scan", "Signal"), grid("probe", "Height")], activeId: "scan" });
  useApp.setState({ mapViews: EMPTY_MAP_VIEWS, mapRes: 50, status: "" });
});

describe("MapStage export while the map is still regridding", () => {
  it("never exports the previous dataset's grid under the new dataset's name", async () => {
    render(<MapStage />);
    await waitFor(() => expect(useApp.getState().status).toMatch(/offline grid/));
    hold = true;
    act(() => useApp.setState({ activeId: "probe" }));
    await waitFor(() => expect(held).toBeGreaterThan(0)); // probe's regrid is in flight

    fireEvent.click(await screen.findByTitle(/^Export map/));
    await waitFor(() => expect(useApp.getState().status).toMatch(/still loading/));
    expect(exportMapFigure).not.toHaveBeenCalled();
    expect(askParams).not.toHaveBeenCalled();
  });
});
