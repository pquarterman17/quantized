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

import { omitOnlyReason, withExcludedGhosts } from "../../lib/excludedRowsExport";
import { createFigureDocument } from "../../lib/figureDocument";
import { buildFigureSpecFromDocument } from "../../lib/figureSpec";
import type { FigureEncoding } from "../../lib/plotEncodingBinding";
import { defaultPlotView } from "../../lib/plotview";
import { SERIES_VARS } from "../../lib/seriesStyleCycle";
import type { Dataset, DataStruct } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import { withFocusedEncoding } from "../../store/focusedEncoding";
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
const PALETTE = ["#0b6e4f", "#c3423f", "#2d3047", "#f2a541", "#5e548e", "#1b998b", "#e84855", "#3e2f5b"];
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
  useApp.setState((s) => ({
    facetKey: null, composition: null, groupKey: null,
    plotWindows: withFocusedEncoding(s.plotWindows, s.focusedWindowId, undefined),
  }));
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

// A SPLIT grid (Color by `sample`, or Group by it alone): ch3 `sample` (s1/s2).
// Row 1 is excluded inside level 0; rows 6 and 7 are level 1's only s2 rows, so
// that panel keeps no s2 series and its companion holds them; row 8 is level
// 2's only row (no panel). Each panel draws ONE grey companion per Y channel,
// after its split series, never recoloured by level.
const SPLIT_ROWS = [
  [0, 0, 1.0, 0], [1, 0, 1.5, 1], [2, 0, 1.2, 0], [3, 0, 1.4, 1],
  [0, 1, 3.0, 0], [1, 1, 2.5, 0], [2, 1, 2.8, 1], [3, 1, 2.6, 1],
  [0, 2, 9.0, 0],
];
const SPLIT_DATA: DataStruct = {
  time: SPLIT_ROWS.map((_, i) => i),
  values: SPLIT_ROWS,
  labels: ["B", "level", "M", "sample"],
  units: ["T", "", "emu", ""],
  metadata: {},
  cat_levels: { 3: ["s1", "s2"] },
};
const SPLIT_DS: Dataset = { id: "fs", name: "split.csv", data: SPLIT_DATA, excludedRows: [1, 6, 7, 8] };
const SPLIT_CASES: { key: string; picks?: FigureEncoding; groupKey?: number }[] = [
  { key: "split_color", picks: { color: 3 } },
  { key: "split_group", groupKey: 3 },
];
const root = document.documentElement;

describe("MultiPanelStage — greyed excluded rows on a SPLIT facet grid", () => {
  beforeEach(() => {
    SERIES_VARS.forEach((v, i) => root.style.setProperty(v, PALETTE[i]));
    useApp.setState({ datasets: [SPLIT_DS], activeId: "fs" });
  });
  afterEach(() => SERIES_VARS.forEach((v) => root.style.removeProperty(v)));

  it.each(SPLIT_CASES)("$key: one grey companion per panel, on screen and in the export", async (c) => {
    useApp.setState({ groupKey: c.groupKey ?? null });
    useApp.getState().facetByColumn("fs", 1);
    if (c.picks) useApp.setState((s) => ({ plotWindows: withFocusedEncoding(s.plotWindows, s.focusedWindowId, c.picks) }));
    render(<MultiPanelStage />);
    await waitFor(() =>
      expect(columnsOf()).toEqual([
        [[0, 1, 2, 3], [1.0, null, 1.2, null], [null, null, null, 1.4], [null, 1.5, null, null]],
        [[0, 1, 2, 3], [3.0, 2.5, null, null], [null, null, 2.8, 2.6]],
      ]),
    );
    const grid = lastGrid();
    const screen = grid.map((p) => ({
      label: p.opts.title ?? "",
      x: [...p.data[0]],
      series: p.opts.series.slice(1).map((s, j) => ({ label: s.label, y: [...p.data[j + 1]] })),
    }));
    // The companion is each panel's last series, named for its channel and
    // drawn in the dim ink, never in a level's colour.
    for (const p of grid) {
      const series = p.opts.series.slice(1) as { label?: string; stroke?: unknown }[];
      const ghost = series[series.length - 1];
      expect(ghost.label).toBe("M (excluded) (emu)");
      expect(series.slice(0, -1).map((s) => s.stroke)).not.toContain(ghost.stroke);
    }

    const view = { ...defaultPlotView(), xKey: 0, yKeys: [2], facetKey: 1 };
    const doc = createFigureDocument({
      id: "w", name: "w", datasetId: "fs", view, facetKey: 1, mark: "line",
      ...(c.picks ? { encoding: c.picks } : {}), ...(c.groupKey != null ? { groupKey: c.groupKey } : {}),
    });
    const request = buildFigureSpecFromDocument(doc, SPLIT_DS, "fs", { ...OPTS, greyExcluded: withExcludedGhosts });
    expect(request.facets?.map((f) => [f.label, f.x, f.rows, f.channels])).toEqual([
      ["0", [0, 1, 2, 3], [0, 1, 2, 3], [2]],
      ["1", [0, 1, 2, 3], [4, 5, 6, 7], [2]],
    ]);
    expect(request.excluded_rows).toEqual([1, 6, 7, 8]);
    expect(request.grey_excluded).toBe(true);
    expect(omitOnlyReason(request)).toBeNull();
    // The omit build is untouched: the analysis view's rows, no mask.
    const omit = buildFigureSpecFromDocument(doc, SPLIT_DS, "fs", OPTS);
    expect(omit.facets?.map((f) => [f.x, f.rows])).toEqual([[[0, 2, 3], [0, 2, 3]], [[0, 1], [4, 5]]]);
    expect(omit).not.toHaveProperty("excluded_rows");

    const current = JSON.parse(JSON.stringify({ request, screen })) as unknown;
    written[c.key] = current;
    expect(current).toEqual(JSON.parse(readFileSync(FIXTURE, "utf-8"))[c.key]);
  });
});
