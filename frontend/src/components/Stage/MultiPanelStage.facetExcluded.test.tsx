// F4.2c (a) on a FACET grid: with the app-wide "Excluded rows" mode on
// "greyed", each facet panel draws its own excluded / filter-dropped rows as
// muted "(excluded)" companions, exactly as the flat plot does — on screen
// (this file renders the real `MultiPanelStage` over a recording uPlot) and in
// the export (`buildFigureSpecFromDocument` with the greying transform sends
// each panel's FULL level rows, the dataset `rows` behind them, and the mask as
// `excluded_rows` + `grey_excluded`; the route draws the companions).
//
// The panels stay the screen's own partition (the analysis view's levels), so
// a level whose every row is excluded has no panel in either mode.
//
// Request + screen are the committed wire fixture
// `tests/fixtures/wire/facet_excluded.json`, which the BACKEND half
// (`tests/test_export_facet_excluded.py`) posts to the real route and reads
// back line by line. To regenerate after a DELIBERATE rule change:
//   GRAPH_ENCODING_FIXTURE_WRITE=1 npx vitest run src/components/Stage/MultiPanelStage.facetExcluded.test.tsx

import { act, render, waitFor } from "@testing-library/react";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withExcludedGhosts } from "../../lib/excludedRowsExport";
import { createFigureDocument } from "../../lib/figureDocument";
import { buildFigureSpecFromDocument } from "../../lib/figureSpec";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset, DataStruct } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import RealMultiPanelStage from "./MultiPanelStage";
import { useEffectiveComposition } from "./useEffectiveComposition";

function MultiPanelStage() {
  const active = useActiveDataset();
  return <RealMultiPanelStage composition={useEffectiveComposition(active)} />;
}

type SeriesOpts = { label?: string };
type Cols = readonly (readonly (number | null)[])[];
const { created, MockUPlot } = vi.hoisted(() => {
  const created: { opts: { title?: string; series: SeriesOpts[] }; data: Cols }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(opts: { title?: string; series: SeriesOpts[] }, data: Cols) {
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

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "../../../../tests/fixtures/wire/facet_excluded.json");

// ch0 B (x), ch1 level (the facet column), ch2 M. Rows 1 and 5 are excluded
// inside their levels; row 6 is the ONLY row of level 2, so that level has no
// panel (the screen's partition is the analysis view's).
const ROWS = [
  [0, 0, 1.0], [1, 0, 1.5], [2, 0, 1.2],
  [0, 1, 3.0], [1, 1, 2.5], [2, 1, 2.8],
  [0, 2, 9.0],
];
const DATA: DataStruct = {
  time: ROWS.map((_, i) => i),
  values: ROWS,
  labels: ["B", "level", "M"],
  units: ["T", "", "emu"],
  metadata: {},
};
const DS: Dataset = { id: "fx", name: "excluded.csv", data: DATA, excludedRows: [1, 5, 6] };
const OPTS = { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" };

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  useApp.setState({
    datasets: [DS], activeId: "fx", xKey: 0, yKeys: [2], y2Keys: null, seriesOrder: null, stackMode: true,
    composition: null, facetKey: null, groupKey: null, seriesLabels: {}, seriesStyles: {}, hiddenChannels: [],
    plotTemplate: "screen", defaultLineWidth: 1.5, defaultTrace: "Line",
  });
  useApp.getState().setPref("excludedDisplay", "grey");
});
afterEach(() => {
  vi.unstubAllGlobals();
  useApp.setState({ facetKey: null, composition: null });
  useApp.getState().setPref("excludedDisplay", "hide");
});

const written: Record<string, unknown> = {};
afterAll(() => {
  if (process.env.GRAPH_ENCODING_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, `${JSON.stringify(written, null, 2)}\n`);
});

const lastGrid = () => created.slice(-2);
const columnsOf = () => lastGrid().map((c) => c.data.map((col) => [...col]));

describe("MultiPanelStage — greyed excluded rows on a facet grid", () => {
  it("each panel greys its own excluded rows on screen and in the export request", async () => {
    useApp.getState().facetByColumn("fx", 1);
    render(<MultiPanelStage />);
    await waitFor(() =>
      expect(columnsOf()).toEqual([
        [[0, 1, 2], [1.0, null, 1.2], [null, 1.5, null]],
        [[0, 1, 2], [3.0, 2.5, null], [null, null, 2.8]],
      ]),
    );
    const grid = lastGrid();
    expect(grid.map((c) => c.opts.title)).toEqual(["0", "1"]);
    const screen = grid.map((c) => ({
      label: c.opts.title ?? "",
      x: [...c.data[0]],
      series: c.opts.series.slice(1).map((s, j) => ({ label: s.label, y: [...c.data[j + 1]] })),
    }));

    // The export: the full level rows, their dataset rows, and the mask.
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [2], facetKey: 1 };
    const doc = createFigureDocument({ id: "w", name: "w", datasetId: "fx", view, facetKey: 1, mark: "line" });
    const request = buildFigureSpecFromDocument(doc, DS, "fx", { ...OPTS, greyExcluded: withExcludedGhosts });
    expect(request.facets?.map((f) => [f.label, f.x, f.rows, f.series.map((s) => s.y)])).toEqual([
      ["0", [0, 1, 2], [0, 1, 2], [[1.0, 1.5, 1.2]]],
      ["1", [0, 1, 2], [3, 4, 5], [[3.0, 2.5, 2.8]]],
    ]);
    expect(request.excluded_rows).toEqual([1, 5, 6]);
    expect(request.grey_excluded).toBe(true);
    expect(request.encoding).toBeUndefined();
    // The omit build is untouched: pruned panels, no mask.
    const omit = buildFigureSpecFromDocument(doc, DS, "fx", OPTS);
    expect(omit.facets?.map((f) => [f.x, f.rows])).toEqual([[[0, 2], undefined], [[0, 1], undefined]]);
    expect(omit).not.toHaveProperty("excluded_rows");

    const current = JSON.parse(JSON.stringify({ request, screen })) as unknown;
    written.grey = current;
    expect(current).toEqual(JSON.parse(readFileSync(FIXTURE, "utf-8")).grey);
  });

  it("hides them again when the mode flips back", async () => {
    useApp.getState().facetByColumn("fx", 1);
    render(<MultiPanelStage />);
    await waitFor(() => expect(columnsOf()[0]).toHaveLength(3));
    act(() => useApp.getState().setPref("excludedDisplay", "hide"));
    await waitFor(() =>
      expect(columnsOf()).toEqual([
        [[0, 2], [1.0, 1.2]],
        [[0, 1], [3.0, 2.5]],
      ]),
    );
  });
});
