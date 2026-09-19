// COLD-path DOM coverage for the RENDER seams taken out of the eager bundle on
// 2026-09-18 (`plans/BUNDLE_HEADROOM.md` slice 3) and 2026-09-19 (slice 5):
//
//   * `components/windows/PanelPlotWindow.tsx` — the `win.kind === "panel"`
//     renderer, now `lazy()` in WindowCanvas beside BackgroundPlotWindow;
//   * `components/Stage/PolarStage.tsx` — PlotStage's third runtime-conditional
//     alternate mode, now `lazy()` beside MultiPanelStage/StatStage; and
//   * `components/windows/SnapshotPlotWindow.tsx` (slice 5) — the
//     `win.kind === "snapshot"` renderer, the same dispatch branch one line
//     from the panel one.
//
// `src/architecture.test.ts`'s SEAMS list holds the STATIC half (nothing may
// value-import either, and the loader must reach it with a dynamic `import()`);
// that grep cannot see whether the thing still RENDERS. Each test below asserts
// both halves of the seam at the DOM layer the user actually experiences:
// nothing on the first synchronous flush (the `Suspense fallback={null}` while
// the chunk is in flight — which is what proves the seam is real rather than
// a no-op refactor), and the real content once it resolves.
//
// Both boundaries inherit the repo-wide `lazy()` caveat: a chunk that will not
// load has no reporting of its own, and unmounts the React root at the nearest
// boundary. That is UX-003 in `plans/BUGS_AND_ISSUES.md` for all 19 sites at
// once, not something these two seams introduced or can fix locally — so there
// is deliberately no load-failure test here, unlike the `runLazy`-shaped and
// store-shaped seams, which DO report.
//
// uPlot is mocked to a lightweight recorder, the WindowCanvas.test.tsx /
// PanelPlotWindow.test.tsx pattern — jsdom has no canvas/layout engine and
// neither of these assertions needs one.

import { render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import type { DataStruct, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import WindowCanvas from "./WindowCanvas";

const { created, MockUPlot } = vi.hoisted(() => {
  const created: { opts: unknown; data: unknown }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(opts: unknown, data: unknown) {
      created.push({ opts, data });
    }
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  }
  return { created, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));

// Records whether `SnapshotPlotWindow` has actually been IMPORTED. The DOM
// assertions below prove the seam SUSPENDS, but not that the gate is real:
// `win.kind === "snapshot" && win.snapshot ?` sits in a ternary chain, and the
// cheapest way to break the seam is to widen the branch rather than delete it.
// The recorder says precisely which chunks a render asked for. Same
// `vi.hoisted` pattern as `Library/lazySectionSeams.test.tsx`; the factory runs
// once, on first import, and hands back the real module so the window still
// renders for real.
const { loaded, track } = vi.hoisted(() => {
  const loaded = new Set<string>();
  const track =
    (name: string) =>
    async (importOriginal: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> => {
      loaded.add(name);
      return await importOriginal();
    };
  return { loaded, track };
});
vi.mock("./SnapshotPlotWindow", track("SnapshotPlotWindow"));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [[10], [20], [30]],
  labels: ["a"],
  units: [""],
  metadata: {},
};
const A: Dataset = { id: "a", name: "Alpha", data: DATA };
const B: Dataset = { id: "b", name: "Beta", data: DATA };

const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "",
  datasetId: "a",
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z: 0,
  winState: "maximized",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
  ...over,
});

beforeAll(() => vi.stubGlobal("ResizeObserver", MockResizeObserver));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  created.length = 0;
  useApp.setState({
    datasets: [A, B],
    activeId: "a",
    selectedIds: ["a"],
    polarMode: false,
    stackMode: false,
    composition: null,
    facetKey: null,
  });
});

afterEach(() => {
  useApp.setState({
    datasets: [],
    activeId: null,
    selectedIds: [],
    plotWindows: [],
    focusedWindowId: null,
    polarMode: false,
  });
});

describe("panel window — chunk-deferred renderer", () => {
  it("renders its cells only after the chunk resolves", async () => {
    useApp.setState({
      plotWindows: [
        win({ id: "w1", kind: "panel", title: "Panel", datasetId: null, winState: "normal", panel: { datasetIds: ["a", "b"], layout: "grid" } }),
        win({ id: "w2", winState: "normal" }),
      ],
      focusedWindowId: "w2",
    });

    const { container } = render(<WindowCanvas />);
    // The seam itself: the panel's frame is up, its CONTENT is not — the
    // Suspense fallback is null while the chunk is in flight.
    expect(container.querySelectorAll(".qzk-plotwin").length).toBeGreaterThan(0);
    expect(container.querySelector(".qzk-panel-grid")).toBeNull();

    await waitFor(() => expect(container.querySelector(".qzk-panel-grid")).not.toBeNull());
    expect(container.querySelectorAll(".qzk-panel-cell")).toHaveLength(2);
  });
});

describe("polar mode — chunk-deferred renderer", () => {
  it("renders the polar stage only after the chunk resolves", async () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", winState: "maximized" })],
      focusedWindowId: "w1",
      polarMode: true,
    });

    const { container } = render(<WindowCanvas />);
    // PolarStage's own "back to cartesian" toggle is the marker: PlotStage
    // returns the suspended boundary instead of its cartesian tree, so on the
    // first flush neither that button nor a uPlot instance exists.
    expect(container.querySelector('[title="Back to a cartesian plot"]')).toBeNull();
    expect(created).toHaveLength(0);

    await waitFor(() => expect(container.querySelector('[title="Back to a cartesian plot"]')).not.toBeNull());
    // …and it really is the polar tree, not the cartesian one falling through.
    expect(created).toHaveLength(0);
  });
});

describe("snapshot window — chunk-deferred renderer (slice 5)", () => {
  // A frozen bundle with a distinctive y column, the same fixture shape
  // `SnapshotPlotWindow.test.tsx` uses, so the uPlot the recorder captures is
  // unambiguously the snapshot's.
  const FROZEN = {
    payload: {
      data: [
        [0, 1, 2],
        [99, 98, 97],
      ],
      series: [{ label: "a", unit: "" }],
      xLabel: "x",
      xUnit: "",
    },
    styleList: null,
    labelList: null,
    errorBars: [],
    plotted: [0],
    colorByColumns: [],
    hidden: null,
  } as unknown as NonNullable<PlotWindow["snapshot"]>;

  it("renders its frozen bundle only after the chunk resolves", async () => {
    // The gate half first, and it is a claim about every test above too: none
    // of them put a `kind: "snapshot"` window on the canvas, so nothing should
    // have requested this chunk yet. A widened branch would have.
    expect([...loaded]).not.toContain("SnapshotPlotWindow");

    useApp.setState({
      plotWindows: [
        win({ id: "w1", kind: "snapshot", title: "Frozen", datasetId: null, winState: "normal", snapshot: FROZEN }),
      ],
      // A snapshot window is never the focus target (the store guarantees it).
      focusedWindowId: null,
    });

    const { container } = render(<WindowCanvas />);
    // The seam itself: the frame is up, its CONTENT is not — `fallback={null}`
    // while the chunk is in flight, so no uPlot has been constructed.
    expect(container.querySelectorAll(".qzk-plotwin").length).toBeGreaterThan(0);
    expect(created).toHaveLength(0);

    await waitFor(() => expect(created.length).toBeGreaterThan(0));
    expect([...loaded]).toContain("SnapshotPlotWindow");
    // …and it drew the FROZEN bundle, not a live dataset.
    expect(JSON.stringify(created[0]?.data)).toContain("99");
  });
});
