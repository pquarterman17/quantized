// WindowCanvas is the item-3/4 migration-guarantee boundary: a single
// maximized window renders `PlotStage` alone (no chrome, no extra host div —
// pixel-identical to the pre-MULTI_PLOT_PLAN Stage); ≥2 windows get MDI
// chrome, with the focused frame hosting the full `PlotStage` and every
// other frame hosting a live, non-interactive `BackgroundPlotWindow` (item
// 4's focused-window routing). Also proves the item-4 row-state requirement:
// two windows on the SAME dataset both reflect a live exclusion toggle, with
// no `architecture.test.ts` allowlist change (this file imports only
// `lib/rowstate`'s existing consumers, never `Dataset.excludedRows` raw).
//
// Real uPlot needs a browser canvas/layout engine neither jsdom nor this
// test cares about; the constructor is mocked to a lightweight recorder (the
// MultiPanelStage.test.tsx pattern) so both PlotStage's and
// BackgroundPlotWindow's render effects can run headlessly.

import { fireEvent, render, waitFor } from "@testing-library/react";
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

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [20], [30], [40]],
  labels: ["a"],
  units: [""],
  metadata: {},
};

const DATASET: Dataset = { id: "d1", name: "ds1", data: DATA };

const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "",
  datasetId: "d1",
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z: 0,
  winState: "normal",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
  ...over,
});

// Stubbed for the WHOLE file (not per-test): a fetchPlot promise that
// resolves after a test's own `afterEach` has already unstubbed globals would
// otherwise throw "ResizeObserver is not defined" from a stray PlotViewport
// mount effect, misattributed to whatever test happened to run next.
beforeAll(() => vi.stubGlobal("ResizeObserver", MockResizeObserver));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  created.length = 0;
  useApp.setState({ datasets: [DATASET], activeId: "d1", selectedIds: ["d1"] });
});
afterEach(() => {
  useApp.setState({
    datasets: [],
    activeId: null,
    selectedIds: [],
    plotWindows: [win({ winState: "maximized" })],
    focusedWindowId: "w1",
  });
});

describe("WindowCanvas — single maximized window (migration guarantee)", () => {
  it("renders PlotStage alone — no wincanvas host, no plotwin chrome", async () => {
    useApp.setState({ plotWindows: [win({ id: "w1", winState: "maximized" })], focusedWindowId: "w1" });
    const { container } = render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBeGreaterThan(0));
    expect(container.querySelector(".qzk-wincanvas")).toBeNull();
    expect(container.querySelector(".qzk-plotwin")).toBeNull();
    expect(container.querySelector(".qzk-stage")).not.toBeNull();
    expect(created).toHaveLength(1); // exactly one live plot instance
  });
});

describe("WindowCanvas — ≥2 windows (MDI chrome + focused-window routing)", () => {
  it("renders one PlotWindowFrame per window; only the focused one hosts the full PlotStage", async () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", winState: "normal" }), win({ id: "w2", winState: "normal" })],
      focusedWindowId: "w1",
    });
    const { container } = render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(2)); // one uPlot per window
    const frames = container.querySelectorAll(".qzk-plotwin");
    expect(frames).toHaveLength(2);
    // Exactly one frame carries the "focused" highlight class + the full
    // PlotStage chrome (.qzk-stage); the toolbar (focused-only chrome) also
    // appears exactly once.
    expect(container.querySelectorAll(".qzk-plotwin.focused")).toHaveLength(1);
    expect(container.querySelectorAll(".qzk-stage")).toHaveLength(1);
  });

  it("row-state proof: two windows on the SAME dataset both reflect a live exclusion toggle", async () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", winState: "normal" }), win({ id: "w2", winState: "normal" })],
      focusedWindowId: "w1",
    });
    render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(2));

    useApp.getState().toggleRowExcluded("d1", 0);

    // Both PlotViewport instances rebuild. usePlotPayload's fetch effect keys
    // off the `active`/`dataset` object REFERENCE (unchanged, pre-existing
    // behavior — not something this plan's new code controls): the exclusion
    // toggle replaces that reference, so each window rebuilds TWICE — once
    // synchronously from the new `dropped` set against the still-in-flight
    // payload, once more when the re-fetch resolves — 2 windows × (1 initial
    // + 2 rebuilds) = 6. What matters for the row-state proof is that EVERY
    // rebuild after the toggle reflects it in EVERY window, which the loop
    // below checks regardless of exactly how many rebuilds that takes.
    await waitFor(() => expect(created.length).toBe(6));
    const latest = created.slice(2);
    expect(latest.length).toBeGreaterThanOrEqual(2); // at least one per window
    for (const c of latest) {
      const data = c.data as (number | null)[][];
      expect(data[1][0]).toBeNull(); // row 0 dropped in every window's payload
    }
  });

  it("an unbound (removed-dataset) background window shows its empty state, not a crash", async () => {
    useApp.setState({
      plotWindows: [
        win({ id: "w1", winState: "normal", datasetId: "d1" }),
        win({ id: "w2", winState: "normal", datasetId: null }),
      ],
      focusedWindowId: "w1",
    });
    const { container } = render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(1)); // only the focused (bound) window plots
    expect(container.textContent).toContain("No dataset");
  });

  it("ORIGIN_FILE_DECODE_PLAN #38: fetches full data for a background window's pending dataset", async () => {
    const pendingDs: Dataset = {
      id: "d2",
      name: "lazy",
      data: { time: [0, 1], values: [[1], [2]], labels: ["a"], units: [""], metadata: {} },
      pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 999, cols: 1 },
    };
    useApp.setState({ datasets: [DATASET, pendingDs] });
    const spy = vi.spyOn(useApp.getState(), "ensureBookData").mockImplementation(() => {});
    useApp.setState({
      plotWindows: [win({ id: "w1", winState: "normal" }), win({ id: "w2", winState: "normal", datasetId: "d2" })],
      focusedWindowId: "w1",
    });
    render(<WindowCanvas />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("d2"));
  });

  it("shows a channel-count/rows badge (item 10) for a window bound to a live dataset", async () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", winState: "normal" }), win({ id: "w2", winState: "normal" })],
      focusedWindowId: "w1",
    });
    const { container } = render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(2));
    expect(container.textContent).toContain("1ch");
    expect(container.textContent).toContain("4pts");
  });
});

describe("WindowCanvas — cross-window link groups (item 13)", () => {
  type SyncOpts = {
    cursor: { sync?: { key: string } };
    hooks?: { setScale?: unknown[]; setSelect?: unknown[] };
  };

  it("same-group windows get the SAME uPlot cursor-sync key + an x-range sync hook — focused AND background alike", async () => {
    useApp.setState({
      plotWindows: [
        win({ id: "w1", winState: "normal", linkGroup: 1 }),
        win({ id: "w2", winState: "normal", linkGroup: 1 }),
      ],
      focusedWindowId: "w1",
    });
    render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(2));
    for (const c of created) {
      const opts = c.opts as SyncOpts;
      expect(opts.cursor.sync?.key).toBe("qz-win-link-1");
      expect(opts.hooks?.setScale).toHaveLength(1);
      // buildOpts's own setSelect hook is APPENDED to, never clobbered.
      expect(opts.hooks?.setSelect).toHaveLength(1);
    }
  });

  it("windows in DIFFERENT groups get different sync keys (no cross-group coupling)", async () => {
    useApp.setState({
      plotWindows: [
        win({ id: "w1", winState: "normal", linkGroup: 1 }),
        win({ id: "w2", winState: "normal", linkGroup: 2 }),
      ],
      focusedWindowId: "w1",
    });
    render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(2));
    const keys = created.map((c) => (c.opts as SyncOpts).cursor.sync?.key);
    expect(keys).toContain("qz-win-link-1");
    expect(keys).toContain("qz-win-link-2");
  });

  it("unlinked windows get NO sync patch at all — linking is opt-in, never automatic same-dataset coupling", async () => {
    // Both windows show the SAME dataset (d1) yet stay unsynced: the owner
    // decision pinned in MULTI_PLOT_PLAN's "Key decisions".
    useApp.setState({
      plotWindows: [win({ id: "w1", winState: "normal" }), win({ id: "w2", winState: "normal" })],
      focusedWindowId: "w1",
    });
    render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(2));
    for (const c of created) {
      const opts = c.opts as SyncOpts;
      expect(opts.cursor.sync).toBeUndefined();
      expect(opts.hooks?.setScale).toBeUndefined();
    }
  });
});

// Item 14 — jsdom DnD harness (the FolderRow.test.tsx pattern): hand-built
// events with a stub dataTransfer + explicit client coordinates.
function datasetTransfer(id: string) {
  return {
    types: ["application/x-qz-dataset"], // DATASET_DND (useLibraryTree)
    getData: (t: string) => (t === "application/x-qz-dataset" ? id : ""),
    setData: () => {},
  };
}

function fireDrag(
  el: Element,
  type: "dragover" | "dragleave" | "drop",
  dataTransfer: unknown,
  at: { x: number; y: number } = { x: 0, y: 0 },
) {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "clientX", { value: at.x, configurable: true });
  Object.defineProperty(evt, "clientY", { value: at.y, configurable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dataTransfer, configurable: true });
  fireEvent(el, evt);
}

describe("WindowCanvas — item 14 (drop a dataset onto empty canvas = new window)", () => {
  it("a dataset drop on the canvas background creates + focuses a new window at the drop point", async () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", winState: "normal" }), win({ id: "w2", winState: "normal" })],
      focusedWindowId: "w1",
    });
    const { container } = render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(2));
    const host = container.querySelector(".qzk-wincanvas-frames")!;
    // jsdom rects are all zeros, so client coords ARE canvas coords; the
    // store's plotCanvasBounds is null (mock RO never fires) → the 1200×800
    // fallback, well clear of clamping for this drop point.
    fireDrag(host, "drop", datasetTransfer("d1"), { x: 200, y: 150 });
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(3);
    const dropped = s.plotWindows.find((w) => !["w1", "w2"].includes(w.id))!;
    expect(dropped.datasetId).toBe("d1");
    expect(dropped.geometry).toMatchObject({ x: 200, y: 150 });
    expect(s.focusedWindowId).toBe(dropped.id); // drop-created windows focus immediately
  });

  it("highlights the canvas during a dataset dragover and clears it on dragleave", async () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", winState: "normal" }), win({ id: "w2", winState: "normal" })],
      focusedWindowId: "w1",
    });
    const { container } = render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(2));
    const host = container.querySelector(".qzk-wincanvas-frames")!;
    fireDrag(host, "dragover", datasetTransfer("d1"));
    expect(host).toHaveClass("dropping");
    fireDrag(host, "dragleave", datasetTransfer("d1"));
    expect(host).not.toHaveClass("dropping");
    // An unrelated drag type never lights it up.
    fireDrag(host, "dragover", { types: ["Files"], getData: () => "", setData: () => {} });
    expect(host).not.toHaveClass("dropping");
  });

  it("a drop on a FRAME rebinds that window and does NOT also create a canvas window", async () => {
    const d2: Dataset = { id: "d2", name: "ds2", data: DATA };
    useApp.setState({
      datasets: [DATASET, d2],
      plotWindows: [win({ id: "w1", winState: "normal" }), win({ id: "w2", winState: "normal" })],
      focusedWindowId: "w1",
    });
    const { container } = render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(2));
    const frames = container.querySelectorAll(".qzk-plotwin");
    const background = frames[1]!; // w2's frame (render order follows plotWindows)
    fireDrag(background, "drop", datasetTransfer("d2"), { x: 10, y: 10 });
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(2); // stopPropagation — no new window
    expect(s.plotWindows.find((w) => w.id === "w2")?.datasetId).toBe("d2"); // rebound instead
    expect(s.focusedWindowId).toBe("w1");
  });
});

describe("WindowCanvas — minimized windows (item 8)", () => {
  it("a minimized window renders NEITHER a frame NOR a live plot — only a strip entry", async () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", winState: "normal" }), win({ id: "w2", winState: "minimized" })],
      focusedWindowId: "w1",
    });
    const { container } = render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(1)); // only w1 (visible) plots — w2 fully unmounted
    const frames = container.querySelectorAll(".qzk-plotwin");
    expect(frames).toHaveLength(1); // no frame at all for the minimized window
    const strip = container.querySelector(".qzk-winstrip");
    expect(strip).not.toBeNull();
    expect(strip!.querySelectorAll(".qzk-winstrip-item")).toHaveLength(1);
  });

  it("clicking a strip entry restores + focuses that window", async () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", winState: "normal" }), win({ id: "w2", winState: "minimized" })],
      focusedWindowId: "w1",
    });
    const { container } = render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(1));
    const item = container.querySelector(".qzk-winstrip-item") as HTMLButtonElement;
    item.click();
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "w2")?.winState).toBe("normal");
    expect(s.focusedWindowId).toBe("w2");
  });

  it("no strip renders when nothing is minimized", async () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", winState: "normal" }), win({ id: "w2", winState: "normal" })],
      focusedWindowId: "w1",
    });
    const { container } = render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(2));
    expect(container.querySelector(".qzk-winstrip")).toBeNull();
  });
});
