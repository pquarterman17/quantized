// PanelPlotWindow is the composite-window content dispatcher (MAIN_PLAN #19
// v1): row/column/grid render one PlotViewport (via PanelCell) PER dataset in
// a CSS grid shaped by panelGridShape; overlay renders exactly ONE viewport
// (via PanelOverlayWindow) fed the union-x merged payload. A removed/missing
// dataset id is skipped, never crashes; an emptied panel shows a placeholder.
//
// Real uPlot needs a browser canvas/layout engine neither jsdom nor this test
// cares about — the constructor is mocked to a lightweight recorder (the
// WindowCanvas.test.tsx / BackgroundPlotWindow.test.tsx pattern).

import { render, waitFor } from "@testing-library/react";
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
