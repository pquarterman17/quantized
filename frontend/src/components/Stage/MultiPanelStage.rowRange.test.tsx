// The plain per-channel stack honours the plot's row window (ROW_RANGE_CONTRACT 3.3, item 31); a facet, break or
// spatial arrangement cannot (its panels are built from the whole sheet), so its chip says "this plot kind draws every
// row" and the figure draws every row too, never a different row set than the chip claims.
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildFigureSpecFromDocument } from "../../lib/figureSpec";
import { createFigureDocument } from "../../lib/figureDocument";
import { spatialComposition, type Composition } from "../../lib/composition";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import MultiPanelStage from "./MultiPanelStage";
import { stackDataset } from "./stackRows";

const { created, MockUPlot } = vi.hoisted(() => {
  const created: { data: unknown[][] }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(_opts: unknown, data: unknown[][]) {
      created.push({ data });
    }
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  }
  return { created, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));

const N = 200;
const ds: Dataset = {
  id: "d1", name: "stack", excludedRows: [25],
  data: {
    time: Array.from({ length: N }, (_v, r) => r),
    values: Array.from({ length: N }, (_v, r) => [r, r % 2]),
    labels: ["a", "g"], units: ["", ""], metadata: {},
  },
};
const WINDOW = { from: 20, to: 43 };

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [ds], activeId: "d1", stackMode: true, yKeys: [0, 1], rowRange: WINDOW });
});
afterEach(() => vi.unstubAllGlobals());

describe("stackDataset", () => {
  it("narrows the analysis rows to the window, keeps no exclusion to re-apply, and ignores a window that does not fit", () => {
    const w = stackDataset(ds, WINDOW);
    expect(w.data.time).toEqual(Array.from({ length: 24 }, (_v, i) => 20 + i).filter((r) => r !== 25));
    expect(w.excludedRows).toEqual([]);
    expect(stackDataset(ds, { from: 20, to: 999 }).data.time).toHaveLength(N - 1);
    expect(stackDataset(ds).data.time).toHaveLength(N - 1);
  });
});

describe("the per-channel stack", () => {
  it("draws only the window's rows in each panel, with the chip claiming exactly that", async () => {
    render(<MultiPanelStage composition={null} />);
    await waitFor(() => expect(created.length).toBeGreaterThan(0));
    expect(created.every((c) => c.data[0].length === 23)).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("rows 21-44 of 200");
    expect(screen.getByRole("status").textContent).not.toContain("draws every row");
  });

  it("a facet arrangement draws every row and its chip says so", async () => {
    render(<MultiPanelStage composition={{ kind: "facet", panels: [] } as Composition} />);
    expect(screen.getByRole("status").textContent).toContain("rows 21-44 · this plot kind draws every row");
  });

  it("a spatial arrangement draws every row and its chip says so", () => {
    const spatial = spatialComposition([{ datasetId: "d1", xKey: null, yKeys: [0], xLim: [0, 2], yLim: [1, 3], xLog: false, yLog: false, row: 0, col: 0 }]);
    render(<MultiPanelStage composition={spatial} />);
    expect(screen.getByRole("status").textContent).toContain("this plot kind draws every row");
  });
});

describe("a facet or break figure draws every row, like its stage; a flat figure the window", () => {
  const flat = { ...defaultPlotView(), yKeys: [0], rowRange: WINDOW };
  const spec = (view: typeof flat, facetKey?: number) => buildFigureSpecFromDocument(createFigureDocument({ id: "w", name: "W", datasetId: "d1", view, facetKey }), ds, "s", { fmt: "svg" });

  it("holds the window's rows when flat", () => {
    expect(spec(flat).dataset.time).toHaveLength(23);
  });

  it("holds every analysis row when faceted (the window is not applied)", () => {
    const faceted = spec(flat, 1);
    expect(faceted.facets?.length ?? 0).toBeGreaterThan(0);
    expect(faceted.facets?.every((f) => f.x.length > 23)).toBe(true); // 100 rows a level, not the window's 12
  });
});
