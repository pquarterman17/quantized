// The Box tool on a map that is NOT an RSM axis pair, and the Pick tool, at the
// layer the user touches: the toolbar buttons and the canvas pointer gestures
// of the real MapStage. (Gesture geometry itself is pinned in lib/roi.test.ts;
// the RSM Box is unchanged and is covered by the existing map tests.)
//
// jsdom lays nothing out, so clientWidth/Height are stubbed to give the stage a
// host box, and `fetch` rejects so the map takes its offline regrid fallback
// (deterministic; its status line is what the helpers wait on).

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getMapPick, setMapPick } from "../../lib/mapPick";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import MapStage from "./MapStage";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const grid = (n: number) => {
  const values: number[][] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) values.push([i, j + 10, i * 10 + j]);
  return values;
};

/** A plain long-form map: X is the sheet's row axis, Y and Z are channels. */
const plain: Dataset = {
  id: "plain",
  name: "plain.csv",
  data: {
    time: grid(5).map((r) => r[0]!),
    values: grid(5).map((r) => [r[1]!, r[2]!]),
    labels: ["Y", "Z"],
    units: ["", ""],
    metadata: { x_column_name: "X" },
  },
};

/** An angular RSM with Q columns: the one view where pixel extraction reads its axes. */
const rsm: Dataset = {
  id: "rsm",
  name: "rsm.xrdml",
  data: {
    time: grid(5).map((_, k) => k),
    values: grid(5).map(([i, j, z]) => [30 + i!, 15 + (j! - 10), z!, 28 + i! * 2, 13 + (j! - 10) * 2]),
    labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"],
    units: ["deg", "deg", "counts", "Ang^-1", "Ang^-1"],
    metadata: { is2D: true, axis1_name: "Omega", map_shape: [5, 5] },
  },
};

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
  setMapPick(null);
  useApp.getState().loadWorkspace({ datasets: [plain, rsm], activeId: "plain" });
  useApp.setState({ mapRes: 100, mapRoi: null, history: [], future: [], status: "" });
});

async function mapReady() {
  await waitFor(() => expect(useApp.getState().status).toMatch(/offline grid/));
}

const drag = (canvas: HTMLElement, from: [number, number], to: [number, number]) => {
  fireEvent.pointerDown(canvas, { clientX: from[0], clientY: from[1], button: 0 });
  fireEvent.pointerMove(canvas, { clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(canvas, { clientX: to[0], clientY: to[1], button: 0 });
};

const click = (canvas: HTMLElement, at: [number, number]) => {
  fireEvent.pointerDown(canvas, { clientX: at[0], clientY: at[1], button: 0 });
  fireEvent.pointerUp(canvas, { clientX: at[0], clientY: at[1], button: 0 });
};

describe("Box tool on a plain map", () => {
  it("draws, previews, and keeps its commit buttons off (no RSM route to send them to)", async () => {
    const view = render(<MapStage />);
    await mapReady();
    // No RSM pair: the cut tools are absent but the Box is offered.
    expect(screen.queryByLabelText("H-cut")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Integration box" }));
    const canvas = view.container.querySelector("canvas")!;
    drag(canvas, [200, 120], [350, 250]);

    const roi = useApp.getState().mapRoi!;
    expect(roi.space).toBe("map");
    expect(roi.axes?.[1]).toBe("Y");
    expect(roi.x0).toBeLessThan(roi.x1);
    expect(roi.y0).toBeLessThan(roi.y1);
    expect(roi.x0).toBeGreaterThanOrEqual(0);
    expect(roi.x1).toBeLessThanOrEqual(4);

    // The bar shows the local preview readout, and offers neither ∫ nor Stats.
    expect(await screen.findByLabelText("Remove this box")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("N").nextElementSibling).not.toHaveTextContent("—"));
    expect(screen.queryByRole("button", { name: /^∫/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stats" })).toBeNull();
  });

  it("a click that never grows into a box leaves nothing drawn (the gesture is unchanged)", async () => {
    const view = render(<MapStage />);
    await mapReady();
    fireEvent.click(screen.getByRole("button", { name: "Integration box" }));
    drag(view.container.querySelector("canvas")!, [200, 120], [201, 121]);
    expect(useApp.getState().mapRoi).toBeNull();
  });

  it("belongs to the axes it was drawn on: other channels hide it, the same ones bring it back", async () => {
    const view = render(<MapStage />);
    await mapReady();
    fireEvent.click(screen.getByRole("button", { name: "Integration box" }));
    drag(view.container.querySelector("canvas")!, [200, 120], [350, 250]);
    expect(await screen.findByLabelText("Remove this box")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Y channel"), { target: { value: "2" } });
    await waitFor(() => expect(screen.queryByLabelText("Remove this box")).toBeNull());
    expect(useApp.getState().mapRoi).not.toBeNull(); // kept, not reinterpreted

    fireEvent.change(screen.getByLabelText("Y channel"), { target: { value: "1" } });
    expect(await screen.findByLabelText("Remove this box")).toBeInTheDocument();
  });

  it("is not saved as a named ROI (the project file only knows the RSM spaces)", async () => {
    const view = render(<MapStage />);
    await mapReady();
    fireEvent.click(screen.getByRole("button", { name: "Integration box" }));
    drag(view.container.querySelector("canvas")!, [200, 120], [350, 250]);
    const before = useApp.getState().savedRois.length;
    expect(useApp.getState().saveRoi("plain box")).toBeNull();
    expect(useApp.getState().savedRois).toHaveLength(before);
  });
});

describe("Pick tool", () => {
  it("fills the extraction location from a click on the maps' own axes", async () => {
    useApp.getState().loadWorkspace({ datasets: [rsm], activeId: "rsm" });
    const view = render(<MapStage />);
    await mapReady();
    fireEvent.click(screen.getByRole("button", { name: "Pick point" }));
    click(view.container.querySelector("canvas")!, [250, 160]);
    const pick = getMapPick()!;
    expect(pick.axes).toEqual(["2Theta", "Omega"]);
    expect(pick.x).toBeGreaterThan(30);
    expect(pick.x).toBeLessThan(34);
    expect(useApp.getState().status).toMatch(/^Picked \(/);
  });

  it("refuses a click on the Q view, with the reason, and picks nothing", async () => {
    useApp.getState().loadWorkspace({ datasets: [rsm], activeId: "rsm" });
    const view = render(<MapStage />);
    await mapReady();
    fireEvent.click(screen.getByRole("button", { name: "Q-space axes" }));
    await act(async () => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Pick point" }));
    click(view.container.querySelector("canvas")!, [250, 160]);
    expect(getMapPick()).toBeNull();
    expect(useApp.getState().status).toMatch(/2Theta and Omega/);
  });

  it("refuses a plain map (its axes are not the ones extraction reads)", async () => {
    const view = render(<MapStage />);
    await mapReady();
    fireEvent.click(screen.getByRole("button", { name: "Pick point" }));
    click(view.container.querySelector("canvas")!, [250, 160]);
    expect(getMapPick()).toBeNull();
    expect(useApp.getState().status).toMatch(/Pixel extraction/);
  });

  it("is exclusive with the Box: arming one disarms the other, and a drag is not a pick", async () => {
    useApp.getState().loadWorkspace({ datasets: [rsm], activeId: "rsm" });
    const view = render(<MapStage />);
    await mapReady();
    const box = screen.getByRole("button", { name: "Integration box" });
    const pickBtn = screen.getByRole("button", { name: "Pick point" });
    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pickBtn);
    expect(box).toHaveAttribute("aria-pressed", "false");
    expect(pickBtn).toHaveAttribute("aria-pressed", "true");
    drag(view.container.querySelector("canvas")!, [200, 120], [350, 250]);
    expect(getMapPick()).toBeNull();
    expect(useApp.getState().mapRoi).toBeNull();
    fireEvent.click(box);
    expect(pickBtn).toHaveAttribute("aria-pressed", "false");
  });
});
