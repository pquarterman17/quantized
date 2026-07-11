// PanelPlotWindow is the composite-window content dispatcher (MAIN_PLAN #19
// v1): row/column/grid render one PlotViewport (via PanelCell) PER dataset in
// a CSS grid shaped by panelGridShape; overlay renders exactly ONE viewport
// (via PanelOverlayWindow) fed the union-x merged payload. A removed/missing
// dataset id is skipped, never crashes; an emptied panel shows a placeholder.
//
// Real uPlot needs a browser canvas/layout engine neither jsdom nor this test
// cares about — the constructor is mocked to a lightweight recorder (the
// WindowCanvas.test.tsx / BackgroundPlotWindow.test.tsx pattern).

import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import type { DataStruct, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import PanelPlotWindow from "./PanelPlotWindow";

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

function dataset(id: string, name: string, time: number[], units: string[] = ["emu"]): Dataset {
  const data: DataStruct = {
    time,
    values: time.map((t) => [t * 10]),
    labels: ["a"],
    units,
    metadata: {},
  };
  return { id, name, data };
}

const A = dataset("a", "Alpha", [0, 1, 2]);
const B = dataset("b", "Beta", [0, 1, 2]);
const C = dataset("c", "Gamma", [0, 1, 2]);

function win(over: Partial<PlotWindow> = {}): PlotWindow {
  return {
    id: "pw1",
    kind: "panel",
    title: "Panel",
    datasetId: null,
    geometry: { x: 0, y: 0, w: 760, h: 560 },
    z: 1,
    winState: "normal",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
    panel: { datasetIds: ["a", "b", "c"], layout: "grid" },
    ...over,
  };
}

beforeAll(() => vi.stubGlobal("ResizeObserver", MockResizeObserver));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  created.length = 0;
  useApp.setState({ datasets: [A, B, C] });
});

describe("PanelPlotWindow — row/column/grid layouts render N viewports", () => {
  it("grid: one PanelCell per dataset, grid-template sized by panelGridShape", async () => {
    const { container } = render(<PanelPlotWindow win={win({ panel: { datasetIds: ["a", "b", "c"], layout: "grid" } })} datasets={[A, B, C]} />);
    await waitFor(() => expect(created.length).toBe(3));
    expect(container.querySelectorAll(".qzk-panel-cell")).toHaveLength(3);
    const grid = container.querySelector(".qzk-panel-grid") as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, 1fr)"); // sqrt-balanced for n=3
    expect(grid.style.gridTemplateRows).toBe("repeat(2, 1fr)");
  });

  it("row: forces a single row (1xN)", async () => {
    const { container } = render(<PanelPlotWindow win={win({ panel: { datasetIds: ["a", "b"], layout: "row" } })} datasets={[A, B, C]} />);
    await waitFor(() => expect(created.length).toBe(2));
    const grid = container.querySelector(".qzk-panel-grid") as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, 1fr)");
    expect(grid.style.gridTemplateRows).toBe("repeat(1, 1fr)");
  });

  it("column: forces a single column (Nx1)", async () => {
    const { container } = render(<PanelPlotWindow win={win({ panel: { datasetIds: ["a", "b"], layout: "column" } })} datasets={[A, B, C]} />);
    await waitFor(() => expect(created.length).toBe(2));
    const grid = container.querySelector(".qzk-panel-grid") as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe("repeat(1, 1fr)");
    expect(grid.style.gridTemplateRows).toBe("repeat(2, 1fr)");
  });

  it("skips a dataset id that no longer resolves (removed since the window opened)", async () => {
    const { container } = render(
      <PanelPlotWindow win={win({ panel: { datasetIds: ["a", "gone", "c"], layout: "row" } })} datasets={[A, C]} />,
    );
    await waitFor(() => expect(created.length).toBe(2));
    expect(container.querySelectorAll(".qzk-panel-cell")).toHaveLength(2);
  });
});

describe("PanelPlotWindow — overlay layout renders exactly ONE viewport", () => {
  it("renders a single merged viewport, no per-dataset cells", async () => {
    const { container } = render(
      <PanelPlotWindow win={win({ panel: { datasetIds: ["a", "b"], layout: "overlay" } })} datasets={[A, B, C]} />,
    );
    await waitFor(() => expect(created.length).toBe(1));
    expect(container.querySelectorAll(".qzk-panel-cell")).toHaveLength(0);
    expect(container.querySelector(".qzk-panel-overlay")).not.toBeNull();
    // The merged payload carries both datasets' series, prefixed by name
    // (buildOpts appends the unit to the legend label, same as every other
    // plot — the raw series label built in lib/panelwindow is "Alpha: a").
    const series = (created[0].opts as { series: { label?: string }[] }).series;
    const labels = series.slice(1).map((s) => s.label);
    expect(labels).toEqual(["Alpha: a (emu)", "Beta: a (emu)"]);
  });
});

describe("PanelPlotWindow — empty state", () => {
  it("shows a placeholder when every dataset in the panel was removed", () => {
    const { getByText } = render(
      <PanelPlotWindow win={win({ panel: { datasetIds: ["gone1", "gone2"], layout: "grid" } })} datasets={[A]} />,
    );
    expect(getByText(/every dataset in this panel was removed/i)).toBeInTheDocument();
    expect(created).toHaveLength(0);
  });

  it("shows the placeholder for a panel window with no panel field at all", () => {
    const { getByText } = render(<PanelPlotWindow win={win({ panel: undefined })} datasets={[A, B]} />);
    expect(getByText(/every dataset in this panel was removed/i)).toBeInTheDocument();
  });
});

// Drag-to-rearrange follow-up: jsdom has no real DragEvent/DnD (same
// workaround as DatasetRow.test.tsx / ZoneWell.test.tsx's header notes) — a
// hand-built Event + a real setData/getData-backed dataTransfer, dispatched
// via RTL's low-level fireEvent. Unlike those two, THIS drag round-trips
// through the component's own onDragStart (it calls dataTransfer.setData
// itself), so the fake needs actual storage, not a hardcoded getData().
//
// The window under test is created through the real `createPanelWindow`
// store action (not a bare object literal) so its id lives in
// `useApp.getState().plotWindows` — `PanelCell`'s reorder/remove calls look
// the window up there, exactly like the live app would.
class FakeDataTransfer {
  private store = new Map<string, string>();
  types: string[] = [];
  effectAllowed = "";
  setData(type: string, data: string) {
    this.store.set(type, data);
    if (!this.types.includes(type)) this.types.push(type);
  }
  getData(type: string) {
    return this.store.get(type) ?? "";
  }
}

function fireDrag(el: Element, type: string, dataTransfer: unknown) {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dataTransfer, configurable: true });
  fireEvent(el, evt);
}

function currentWin(id: string) {
  return useApp.getState().plotWindows.find((w) => w.id === id)!;
}

describe("PanelPlotWindow — drag cell headers to rearrange", () => {
  it("dropping cell A's header on cell C's header splices A into C's slot", async () => {
    const id = useApp.getState().createPanelWindow(["a", "b", "c"], "grid");
    const { container, rerender } = render(<PanelPlotWindow win={currentWin(id)} datasets={[A, B, C]} />);
    await waitFor(() => expect(container.querySelectorAll(".qzk-panel-cell-hd")).toHaveLength(3));

    const headers = container.querySelectorAll(".qzk-panel-cell-hd");
    expect([...headers].map((h) => h.querySelector(".qzk-panel-cell-title")?.textContent)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);

    const dt = new FakeDataTransfer();
    fireDrag(headers[0], "dragstart", dt); // grab Alpha (index 0)
    fireDrag(headers[2], "dragover", dt); // hover Gamma (index 2)
    fireDrag(headers[2], "drop", dt); // drop on Gamma

    expect(currentWin(id).panel?.datasetIds).toEqual(["b", "c", "a"]); // Alpha spliced into Gamma's slot

    rerender(<PanelPlotWindow win={currentWin(id)} datasets={[A, B, C]} />);
    const reordered = container.querySelectorAll(".qzk-panel-cell-hd");
    expect([...reordered].map((h) => h.querySelector(".qzk-panel-cell-title")?.textContent)).toEqual([
      "Beta",
      "Gamma",
      "Alpha",
    ]);
  });

  it("shows a drop-target highlight on dragover, clears it on dragleave", async () => {
    const id = useApp.getState().createPanelWindow(["a", "b"], "row");
    const { container } = render(<PanelPlotWindow win={currentWin(id)} datasets={[A, B]} />);
    await waitFor(() => expect(container.querySelectorAll(".qzk-panel-cell-hd")).toHaveLength(2));

    const cells = container.querySelectorAll(".qzk-panel-cell");
    const headers = container.querySelectorAll(".qzk-panel-cell-hd");
    const dt = new FakeDataTransfer();
    fireDrag(headers[0], "dragstart", dt);
    expect(cells[0]).toHaveClass("dragging");

    fireDrag(headers[1], "dragover", dt);
    expect(cells[1]).toHaveClass("drop-target");
    fireEvent.dragLeave(headers[1]);
    expect(cells[1]).not.toHaveClass("drop-target");
  });

  it("dropping a header onto itself is a no-op", async () => {
    const id = useApp.getState().createPanelWindow(["a", "b", "c"], "grid");
    const { container } = render(<PanelPlotWindow win={currentWin(id)} datasets={[A, B, C]} />);
    await waitFor(() => expect(container.querySelectorAll(".qzk-panel-cell-hd")).toHaveLength(3));

    const headers = container.querySelectorAll(".qzk-panel-cell-hd");
    const dt = new FakeDataTransfer();
    fireDrag(headers[1], "dragstart", dt);
    fireDrag(headers[1], "drop", dt);

    expect(currentWin(id).panel?.datasetIds).toEqual(["a", "b", "c"]);
  });

  it("ignores a foreign drag (e.g. an OS file drop) — no highlight, no reorder", async () => {
    const id = useApp.getState().createPanelWindow(["a", "b"], "row");
    const { container } = render(<PanelPlotWindow win={currentWin(id)} datasets={[A, B]} />);
    await waitFor(() => expect(container.querySelectorAll(".qzk-panel-cell-hd")).toHaveLength(2));

    const cells = container.querySelectorAll(".qzk-panel-cell");
    const headers = container.querySelectorAll(".qzk-panel-cell-hd");
    const foreign = { types: ["Files"], getData: () => "", setData: () => {} };
    fireDrag(headers[1], "dragover", foreign);
    expect(cells[1]).not.toHaveClass("drop-target");
    fireDrag(headers[1], "drop", foreign);
    expect(currentWin(id).panel?.datasetIds).toEqual(["a", "b"]);
  });

  it("the x chip removes a dataset from the panel", async () => {
    const id = useApp.getState().createPanelWindow(["a", "b", "c"], "grid");
    const { container } = render(<PanelPlotWindow win={currentWin(id)} datasets={[A, B, C]} />);
    await waitFor(() => expect(container.querySelectorAll(".qzk-panel-cell-remove")).toHaveLength(3));

    fireEvent.click(container.querySelectorAll(".qzk-panel-cell-remove")[1]); // remove Beta
    expect(currentWin(id).panel?.datasetIds).toEqual(["a", "c"]);
  });
});
