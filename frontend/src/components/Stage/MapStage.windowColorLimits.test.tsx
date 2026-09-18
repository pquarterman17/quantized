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

// Two independent z-like channels on the SAME dataset — Z1 100…403 (the
// `plainMap` formula, unchanged), Z2 1000…4003 (same shape, one decade up) —
// so two windows on this ONE dataset, each picked to a different z channel,
// paint two genuinely different ranges (round 7, finding 1).
function twoZChannelMap(id: string): Dataset {
  const values: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) values.push([i, j, 100 * (i + 1) + j, 1000 * (i + 1) + j]);
  }
  return {
    id,
    name: `${id}.xrdml`,
    data: {
      time: values.map((_, k) => k),
      values,
      labels: ["X", "Y", "Z1", "Z2"],
      units: ["", "", "counts", "counts"],
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

  // Review round 7, finding 1 (real defect): the painted pair is a property
  // of the WINDOW (its own z-channel pick), but before this round the store
  // slot that reported it was keyed by DATASET alone. Two windows on the
  // SAME dataset with different z channels fought over that one slot — every
  // window's toolbar ended up showing whichever window painted LAST.
  it("two windows on the SAME dataset with different z channels each show their OWN painted pair", async () => {
    useApp.getState().loadWorkspace({ datasets: [twoZChannelMap("ds-a")], activeId: "ds-a" });
    useApp.setState({ mapViews: EMPTY_MAP_VIEWS, mapPaintedLimits: {}, history: [], future: [], status: "" });
    // An explicit pair the log floor cannot honour at all (both ends
    // negative) so the renderer falls all the way back to each window's own
    // auto extent — that extent is what differs between the two channels,
    // and only because `colorLimits` (null-checked) is non-null does
    // `effective` ever render, so the hint is observable in the DOM.
    useApp.getState().setMapColorLimits("ds-a", [-5, -1]);
    useApp.getState().setMapLogZ("ds-a", true);
    const ds = useApp.getState().datasets[0]!;

    const win1 = render(<MapStage dataset={ds} />); // defaults to Z1 (channel 2)
    const win1Effective = await within(win1.container).findByTestId("map-toolbar-colour-limits-effective");
    expect(win1Effective).toHaveTextContent(/^eff 100–403$/);

    const win2 = render(<MapStage dataset={ds} />); // also defaults to Z1 at first
    await within(win2.container).findByTestId("map-toolbar-colour-limits-effective");
    // Switch window 2's own Z channel to Z2 (channel 3, index 3 in the
    // picker's options) — window 1 never touches this control.
    fireEvent.change(within(win2.container).getByLabelText("Z"), { target: { value: "3" } });
    await waitFor(() =>
      expect(within(win2.container).getByTestId("map-toolbar-colour-limits-effective")).toHaveTextContent(
        /^eff 1000–4003$/,
      ),
    );

    // Window 1's own toolbar is still painting Z1 — it must still say so,
    // not window 2's Z2 pair (the bug: both toolbars read one shared slot).
    expect(within(win1.container).getByTestId("map-toolbar-colour-limits-effective")).toHaveTextContent(
      /^eff 100–403$/,
    );

    win1.unmount();
    win2.unmount();
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
