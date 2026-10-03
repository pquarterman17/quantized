// Plot audit round 2: the map's floating dock wraps to two rows on a narrow
// stage and covered the top tick label and the colour bar's maximum. The map
// host must start below the dock's MEASURED bottom edge, and follow it when the
// dock wraps or unwraps.
//
// jsdom lays nothing out, so the dock's offsetTop/offsetHeight are stubbed (the
// GridViewport.test.tsx precedent) and ResizeObserver is a manual fake whose
// callback the test fires.

import { act, render, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_MAP_VIEWS } from "../../lib/mapView";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import MapStage from "./MapStage";
import { DOCK_GAP } from "./useDockClearance";

let dockHeight = 44;
const observers: (() => void)[] = [];

class FakeResizeObserver {
  constructor(private cb: () => void) {}
  observe() {
    observers.push(this.cb);
  }
  unobserve() {}
  disconnect() {}
}

function rsm(): Dataset {
  const values: number[][] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) values.push([30 + i, 15 + j, 100 * (i + 1) + j]);
  return {
    id: "ds-a",
    name: "ds-a.xrdml",
    data: {
      time: values.map((_, k) => k),
      values,
      labels: ["2Theta", "Omega", "Intensity"],
      units: ["deg", "deg", "counts"],
      metadata: { is2D: true, map_shape: [4, 4] },
    },
  };
}

const saved: Record<string, PropertyDescriptor | undefined> = {};
const isDock = (el: HTMLElement) => el.classList.contains("qzk-float-tools");

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
  for (const k of ["clientWidth", "clientHeight", "offsetTop", "offsetHeight"]) {
    saved[k] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, k);
  }
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 400 });
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      return isDock(this) ? 12 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return isDock(this) ? dockHeight : 0;
    },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const [k, d] of Object.entries(saved)) if (d) Object.defineProperty(HTMLElement.prototype, k, d);
});

beforeEach(() => {
  dockHeight = 44;
  observers.length = 0;
  useApp.getState().loadWorkspace({ datasets: [rsm()], activeId: "ds-a" });
  useApp.setState({ mapViews: EMPTY_MAP_VIEWS, status: "" });
});

describe("MapStage — the map starts below its dock", () => {
  it("puts the host's top edge under the dock's measured bottom, and follows a wrap", async () => {
    const view = render(<MapStage />);
    const host = () => view.container.querySelector("canvas")!.parentElement as HTMLElement;
    await waitFor(() => expect(host().style.top).toBe(`${12 + 44 + DOCK_GAP}px`));

    // The stage narrows and the dock wraps to a second row.
    dockHeight = 84;
    act(() => observers.forEach((cb) => cb()));
    expect(host().style.top).toBe(`${12 + 84 + DOCK_GAP}px`);
  });
});
