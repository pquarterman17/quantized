// PRIMARY_SOFTWARE_AUDIT_PLAN P2.8 residual (a) (review round 3, finding 8),
// end to end through a REAL map document window: `MapStage dataset={other}`
// is exactly what `components/windows/DocumentWindow.tsx`'s `MapWindow`
// mounts (MULTI_PLOT_PLAN item 17) — a map bound to an explicit dataset that
// need not be the Library-active one. Before this change that window's
// toolbar covered colormap/scale but had no colour-limit control at all;
// `MapToolbarColorLimits.test.tsx` proves the control's own contract in
// isolation, this file proves it is actually reachable and correctly wired
// once it sits inside a mounted `MapToolbar` inside a real `MapStage`.
//
// Same jsdom harness as `MapStage.mapView.test.tsx` (clientWidth/clientHeight
// stubs so MapStage measures a real host box; `fetch` stubbed to reject so
// `fetchMap` takes its offline client-regrid fallback).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_MAP_VIEWS, mapViewFor } from "../../lib/mapView";
import type { Dataset } from "../../lib/types";
import { serializeWorkspace } from "../../lib/workspace";
import { useApp } from "../../store/useApp";
import { shouldAutosave, type AutosaveState } from "../../useWorkspaceAutosave";
import MapStage from "./MapStage";

const W = 600;
const H = 400;

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function plainMap(id: string): Dataset {
  const values: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) values.push([i, j, 100 * (i + 1) + j]);
  }
  return {
    id,
    name: `${id}.xrdml`,
    data: {
      time: values.map((_, k) => k),
      values,
      labels: ["X", "Y", "Z"],
      units: ["", "", "counts"],
      metadata: {},
    },
  };
}

const viewOf = (id: string) => mapViewFor(useApp.getState().mapViews, id);

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
  useApp.getState().loadWorkspace({ datasets: [plainMap("ds-a"), plainMap("ds-b")], activeId: "ds-a" });
  useApp.setState({ mapViews: EMPTY_MAP_VIEWS, mapPaintedLimits: {}, history: [], future: [], status: "" });
});

async function mapReady() {
  await waitFor(() => expect(useApp.getState().status).toMatch(/offline grid/));
}

describe("a map DOCUMENT WINDOW on a non-active dataset has a colour-limit control (P2.8 residual a)", () => {
  it("the control renders inside the window's own toolbar", async () => {
    const other = useApp.getState().datasets.find((d) => d.id === "ds-b")!;
    render(<MapStage dataset={other} />);
    await mapReady();
    expect(screen.getByLabelText("Map window colour minimum")).toBeInTheDocument();
    expect(screen.getByLabelText("Map window colour maximum")).toBeInTheDocument();
  });

  it("typing + Enter/blur commits to the WINDOW's dataset (ds-b), not the active one (ds-a)", async () => {
    const other = useApp.getState().datasets.find((d) => d.id === "ds-b")!;
    render(<MapStage dataset={other} />);
    await mapReady();

    const min = screen.getByLabelText("Map window colour minimum");
    const max = screen.getByLabelText("Map window colour maximum");
    fireEvent.change(min, { target: { value: "50" } });
    fireEvent.change(max, { target: { value: "300" } });
    fireEvent.keyDown(max, { key: "Enter" });
    fireEvent.blur(max);

    expect(viewOf("ds-b").colorLimits).toEqual([50, 300]);
    expect(viewOf("ds-a").colorLimits).toBeNull(); // the ACTIVE dataset — untouched
    expect(useApp.getState().history.map((h) => h.label)).toEqual([
      'change map colour limits "ds-b.xrdml"',
    ]);
  });

  it("a SECOND window on a THIRD dataset does not confuse the two open windows' controls", async () => {
    useApp.getState().loadWorkspace({
      datasets: [plainMap("ds-a"), plainMap("ds-b"), plainMap("ds-c")],
      activeId: "ds-a",
    });
    useApp.setState({ mapViews: EMPTY_MAP_VIEWS, mapPaintedLimits: {}, history: [], future: [], status: "" });
    const b = useApp.getState().datasets.find((d) => d.id === "ds-b")!;
    const c = useApp.getState().datasets.find((d) => d.id === "ds-c")!;

    const winB = render(<MapStage dataset={b} />);
    await mapReady();
    const winC = render(<MapStage dataset={c} />);
    await waitFor(() =>
      expect(within(winC.container).getByLabelText("Map window colour minimum")).toBeInTheDocument(),
    );

    const minB = within(winB.container).getByLabelText("Map window colour minimum");
    fireEvent.change(minB, { target: { value: "5" } });
    fireEvent.change(within(winB.container).getByLabelText("Map window colour maximum"), {
      target: { value: "9" },
    });
    fireEvent.keyDown(within(winB.container).getByLabelText("Map window colour maximum"), { key: "Enter" });
    fireEvent.blur(within(winB.container).getByLabelText("Map window colour maximum"));

    expect(viewOf("ds-b").colorLimits).toEqual([5, 9]);
    expect(viewOf("ds-c").colorLimits).toBeNull();
    // ds-c's own field never reflects ds-b's typed value.
    expect((within(winC.container).getByLabelText("Map window colour minimum") as HTMLInputElement).value).toBe("");
    winB.unmount();
    winC.unmount();
  });

  it("shows the effective pair for a clamped log-mode window control", async () => {
    const other = useApp.getState().datasets.find((d) => d.id === "ds-b")!;
    useApp.getState().setMapColorLimits("ds-b", [-1, 2]);
    useApp.getState().setMapLogZ("ds-b", true);
    render(<MapStage dataset={other} />);
    await mapReady();
    const row = await screen.findByTestId("map-toolbar-colour-limits-effective");
    // z on this fixture runs 100…403, so the smallest positive cell is 100.
    expect(row).toHaveTextContent(/^eff 100–403$/);
  });

  it("Escape reverts the window field without committing", async () => {
    const other = useApp.getState().datasets.find((d) => d.id === "ds-b")!;
    useApp.getState().setMapColorLimits("ds-b", [10, 50]);
    render(<MapStage dataset={other} />);
    await mapReady();
    const min = screen.getByLabelText("Map window colour minimum");
    fireEvent.change(min, { target: { value: "999" } });
    fireEvent.keyDown(min, { key: "Escape" });
    expect((min as HTMLInputElement).value).toBe("10");
    expect(viewOf("ds-b").colorLimits).toEqual([10, 50]);
  });

  it("merely opening the window is not an edit — no write, no autosave, no field", async () => {
    const other = useApp.getState().datasets.find((d) => d.id === "ds-b")!;
    const before = useApp.getState().mapViews;
    const beforeDoc = serializeWorkspace(useApp.getState());
    const beforeAutosave = useApp.getState() as unknown as AutosaveState;

    render(<MapStage dataset={other} />);
    await mapReady();

    expect(useApp.getState().mapViews).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
    expect(shouldAutosave(useApp.getState() as unknown as AutosaveState, beforeAutosave)).toBe(false);
    const norm = (s: string) => s.replace(/"savedAt": "[^"]*"/, '"savedAt": "X"');
    expect(norm(serializeWorkspace(useApp.getState()))).toBe(norm(beforeDoc));
  });
});
