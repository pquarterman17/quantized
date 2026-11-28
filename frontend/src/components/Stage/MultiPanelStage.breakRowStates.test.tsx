// G24 "Use row states" on an AXIS BREAK (plan item 31): each panel draws its rows in their own colour and glyph, on
// screen and in the export, with and without a row window. The break is the user's (`breakAtGaps`), the window is set
// the way the user sets it (`setPlotRowRange`), the arrangement is the real hook's (`useEffectiveComposition`), the
// panels are `MultiPanelStage`'s own, and the figure is the Stage's own export (`buildStageFigureSpec`).
//
// The expected colours and glyphs are stated by hand from the sheet's row cells, never from the code under test. The
// screen's points and the export request are pinned together as `tests/fixtures/wire/row_states_break.json`; the
// backend half (`tests/test_export_row_states_break.py`) renders the request and reads every panel's points back.
//
// Regenerate only after a DELIBERATE rule change:
//   ROW_STATES_BREAK_FIXTURE_WRITE=1 npx vitest run src/components/Stage/MultiPanelStage.breakRowStates.test.tsx
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ColorScatterSpec } from "../../lib/colorscatter";
import { createFigureDocument } from "../../lib/figureDocument";
import { buildStageFigureSpec } from "../../lib/figureSpecStage";
import { defaultPlotView } from "../../lib/plotview";
import { SERIES_VARS } from "../../lib/seriesStyleCycle";
import type { Dataset, SeriesStyle } from "../../lib/types";
import { setPlotRowRange } from "../../store/plotRowRangeSet";
import { useActiveDataset, useApp } from "../../store/useApp";
import MultiPanelStage from "./MultiPanelStage";
import { useEffectiveComposition } from "./useEffectiveComposition";

const { created, scatter, MockUPlot } = vi.hoisted(() => {
  const created: { x: number[]; specs: Map<number, ColorScatterSpec> | null }[] = [];
  const scatter: { last: Map<number, ColorScatterSpec> | null } = { last: null };
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(_opts: unknown, data: unknown[][]) {
      created.push({ x: data[0] as number[], specs: scatter.last });
      scatter.last = null; // buildOpts runs right before `new uPlot`, one panel at a time
    }
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  }
  return { created, scatter, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));
vi.mock("../../lib/uplotOverlays", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/uplotOverlays")>();
  return {
    ...real,
    colorScatterPlugin: (specs: Map<number, ColorScatterSpec>) => {
      scatter.last = specs;
      return real.colorScatterPlugin(specs);
    },
  };
});

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "tests", "fixtures", "wire", "row_states_break.json");
const PALETTE = ["#0b6e4f", "#c3423f", "#2d3047", "#f2a541", "#5e548e", "#1b998b", "#e84855", "#3e2f5b"];
const SERIES_COLOR = "#336699"; // the series' own colour: what a row with no state takes
const N = 60;
const WINDOW = { from: 20, to: 43 };
const EXCLUDED = 25;
/** x = row, with a gap after row 29 (x jumps by 100); y = 2 * row + 1. */
const xOf = (r: number) => (r < 30 ? r : r + 100);
/** The sheet's row cells: a theme slot, a literal hex, a gap; a glyph or none. */
const COLOR = ["s1", "s2", "#abcdef", ""] as const;
const MARKER = ["circle", "square", "triangle", ""] as const;
const colorCell = (r: number) => COLOR[r % 4];
const markerCell = (r: number) => MARKER[(r + 1) % 4];
const hexOf = (cell: string): string | null => (cell === "" ? null : cell.startsWith("#") ? cell : PALETTE[Number(cell.slice(1)) - 1]);

const sheet = (extra: Partial<Dataset> = {}): Dataset => ({
  id: "d1", name: "sheet", excludedRows: [EXCLUDED],
  data: { time: Array.from({ length: N }, (_v, r) => xOf(r)), values: Array.from({ length: N }, (_v, r) => [2 * r + 1]), labels: ["y"], units: [""], metadata: {} },
  rowStyle: { color: Array.from({ length: N }, (_v, r) => colorCell(r)), marker: Array.from({ length: N }, (_v, r) => markerCell(r)) },
  ...extra,
});

function Arranged() {
  const active = useActiveDataset();
  return <MultiPanelStage composition={useEffectiveComposition(active)} />;
}

function setup(opts: { ds?: Dataset; style?: SeriesStyle | null; window?: boolean; facet?: boolean } = {}): void {
  PALETTE.forEach((c, i) => document.documentElement.style.setProperty(SERIES_VARS[i], c));
  useApp.setState(useApp.getInitialState(), true);
  const style = opts.style === undefined ? { color: SERIES_COLOR, rowStates: true } : opts.style;
  useApp.setState({
    datasets: [opts.ds ?? sheet()], activeId: "d1", xKey: null, yKeys: [0], stackMode: false, history: [], future: [], excludedDisplay: "hide",
    seriesStyles: style ? { 0: style } : {},
    plotWindows: [{
      id: "w1", kind: "plot", title: "", datasetId: "d1", geometry: { x: 0, y: 0, w: 480, h: 360 }, z: 0, winState: "normal",
      bg: "theme", linkGroup: null, pinned: false, view: defaultPlotView(),
      document: createFigureDocument({ id: "fig-w1", name: "w1", datasetId: "d1", view: defaultPlotView() }),
    }],
    focusedWindowId: "w1", ...(opts.facet ? { facetKey: 0 } : {}),
  });
  if (!opts.facet) useApp.getState().breakAtGaps("d1", [[29, 130]]);
  if (opts.window) setPlotRowRange(WINDOW);
}

beforeEach(() => {
  created.length = 0;
  scatter.last = null;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  SERIES_VARS.forEach((v) => document.documentElement.style.removeProperty(v));
});

const exportSpec = () => buildStageFigureSpec(useApp.getState, useApp.getState().datasets[0], "break", { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" });

/** The rows a break panel draws, by hand: the kept rows of the window (or the sheet) on its side of the gap. */
const panelRows = (win: boolean) => {
  const rows = Array.from({ length: win ? WINDOW.to - WINDOW.from + 1 : N }, (_v, i) => (win ? WINDOW.from : 0) + i).filter((r) => r !== EXCLUDED);
  return [rows.filter((r) => r < 30), rows.filter((r) => r >= 30)];
};
const want = (rows: number[]) => ({
  x: rows.map(xOf),
  fills: rows.map((r) => hexOf(colorCell(r))),
  shapes: rows.map((r) => markerCell(r) || null),
});
const drawn = (n: number) => created.slice(-n).map((c) => {
  const spec = c.specs?.get(1);
  return { x: c.x, fills: spec?.fills, shapes: spec?.shapes, flat: spec?.flat };
});
const ready = () => created.length >= 2 && drawn(2).every((p) => p.fills);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe.each([["every row", false], ["a row window", true]])("axis break row states over %s", (_name, win) => {
  it("on screen: each panel's points are in their own sheet row's colour and glyph", async () => {
    setup({ window: win });
    render(<Arranged />);
    const [left, right] = panelRows(win);
    await waitFor(() => expect(ready()).toBe(true));
    expect(drawn(2)).toEqual([left, right].map((rows) => ({ ...want(rows), flat: true })));
  });

  it("in the export: the request's per-row arrays are those same rows' colours and glyphs, in request order", () => {
    setup({ window: win });
    const spec = exportSpec();
    const rows = panelRows(win).flat();
    const wire = spec.series_styles?.[0] as { row_colors?: (string | null)[]; row_markers?: (string | null)[] };
    expect(spec.overrides?.x_breaks).toEqual([[29, 130]]);
    expect(spec.dataset.time).toEqual(rows.map(xOf));
    expect(wire.row_colors).toEqual(rows.map((r) => hexOf(colorCell(r))));
    expect(wire.row_markers).toEqual(rows.map((r) => markerCell(r) || null));
  });
});

describe("axis break row states: when they are not drawn", () => {
  it("a series that does not ask for them draws its break panels plain", async () => {
    setup({ style: { color: SERIES_COLOR } });
    render(<Arranged />);
    await waitFor(() => expect(created.length).toBeGreaterThanOrEqual(2));
    await settle();
    expect(created.every((c) => c.specs === null)).toBe(true);
    expect(exportSpec().series_styles?.[0]).not.toHaveProperty("row_colors");
  });

  it("a stale row style (its arrays no longer match the rows) draws none, never a colour on the wrong row", async () => {
    setup({ ds: sheet({ rowStyle: { color: ["s1", "s2"], marker: ["circle", "square"] } }) });
    render(<Arranged />);
    await waitFor(() => expect(created.length).toBeGreaterThanOrEqual(2));
    await settle();
    expect(created.every((c) => c.specs === null)).toBe(true);
  });

  it("a facet grid draws none on screen and sends none in the export (unchanged)", async () => {
    setup({ facet: true });
    render(<Arranged />);
    await settle();
    expect(created.every((c) => c.specs === null)).toBe(true);
    expect(JSON.stringify(exportSpec().facets)).not.toContain("row_colors");
  });
});

describe("the wire fixture", () => {
  it("pins the screen's points and the export request together (the backend half renders the request)", async () => {
    const cases = [];
    for (const win of [false, true]) {
      created.length = 0;
      setup({ window: win });
      const view = render(<Arranged />);
      await waitFor(() => expect(ready()).toBe(true));
      const panels = created.slice(-2).map((c) => {
        const spec = c.specs?.get(1) as ColorScatterSpec;
        return { points: c.x.map((x, j) => ({ x, fill: spec.fills?.[j] ?? SERIES_COLOR, shape: spec.shapes?.[j] ?? "circle" })) };
      });
      cases.push({ name: win ? "an axis break over rows 21-44 of 60, row 26 excluded" : "an axis break over 60 rows, row 26 excluded", request: exportSpec(), screen: { panels } });
      view.unmount();
    }
    const now = JSON.parse(JSON.stringify({ seriesColor: SERIES_COLOR, cases })) as unknown;
    if (process.env.ROW_STATES_BREAK_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`);
    expect(now).toEqual(JSON.parse(readFileSync(FIXTURE, "utf-8")));
  });
});
