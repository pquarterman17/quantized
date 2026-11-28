// A plot's row window on a FACET grid and an AXIS BREAK, pinned as a shared wire fixture
// (`tests/fixtures/wire/row_range_panels.json`, ROW_RANGE_CONTRACT 3.3 / R2; siblings: `row_range_figure.json` for
// the flat plot, `row_range_overlay.json` for overlays).
//
// THE RULE: a panel set is built from the window's rows alone, on screen (`Stage/useEffectiveComposition`) and in
// the export (`lib/figureRowRange`), through the one `lib/rowWindowDataset`. The Stage export request is pinned here,
// each case hand-stating `want`: for a facet grid the x values of every level's panel, for a break the x values of
// every segment. The panel-by-panel canvas half is `Stage/MultiPanelStage.windowKinds.test.tsx`; the backend half
// (`tests/test_export_row_range_panels.py`) renders the request and compares each panel's line with a numpy
// selection of the same rows.
//
// Regenerate only after a DELIBERATE rule change:
//   ROW_RANGE_PANELS_FIXTURE_WRITE=1 npx vitest run src/lib/rowRangePanelsFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import { buildStageFigureSpec } from "./figureSpecStage";
import { defaultPlotView } from "./plotview";
import type { Dataset } from "../lib/types";
import { setPlotRowRange } from "../store/plotRowRangeSet";
import { useApp } from "../store/useApp";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "row_range_panels.json");

const N = 200;
const WINDOW = { from: 20, to: 43 };
/** x = row, with a gap after row 29 (x jumps by 100); y = 2 * row + 1; facet level = row % 3. Row 25 is excluded. */
const xOf = (r: number) => (r < 30 ? r : r + 100);
const rows = Array.from({ length: WINDOW.to - WINDOW.from + 1 }, (_v, i) => WINDOW.from + i).filter((r) => r !== 25);
const ds = (): Dataset => ({
  id: "d1", name: "sheet", excludedRows: [25],
  data: { time: Array.from({ length: N }, (_v, r) => xOf(r)), values: Array.from({ length: N }, (_v, r) => [2 * r + 1, r % 3]), labels: ["y", "lvl"], units: ["", ""], metadata: {} },
});

function setup(extra: Record<string, unknown>): void {
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({
    datasets: [ds()], activeId: "d1", xKey: null, yKeys: [0], stackMode: false, history: [], future: [], excludedDisplay: "hide",
    plotWindows: [{
      id: "w1", kind: "plot", title: "", datasetId: "d1", geometry: { x: 0, y: 0, w: 480, h: 360 }, z: 0, winState: "normal",
      bg: "theme", linkGroup: null, pinned: false, view: defaultPlotView(),
      document: createFigureDocument({ id: "fig-w1", name: "w1", datasetId: "d1", view: defaultPlotView() }),
    }],
    focusedWindowId: "w1", ...extra,
  });
  setPlotRowRange(WINDOW);
}

const requestOf = () => buildStageFigureSpec(useApp.getState, useApp.getState().datasets[0], "panels", { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" });

interface Built { name: string; request: unknown; want: { panels: { x: number[]; y: number[] }[] } }
const CASES: { name: string; make: () => Built }[] = [
  {
    name: "a facet grid over rows 21-44 of 200, row 26 excluded",
    make() {
      setup({ facetKey: 1 });
      const level = (l: number) => rows.filter((r) => r % 3 === l);
      return { name: this.name, request: requestOf(), want: { panels: [0, 1, 2].map((l) => ({ x: level(l).map(xOf), y: level(l).map((r) => 2 * r + 1) })) } };
    },
  },
  {
    name: "an axis break over rows 21-44 of 200, row 26 excluded",
    make() {
      setup({});
      useApp.getState().breakAtGaps("d1", [[29, 130]]);
      setPlotRowRange(WINDOW);
      return { name: this.name, request: requestOf(), want: { panels: [rows.filter((r) => r < 30), rows.filter((r) => r >= 30)].map((side) => ({ x: side.map(xOf), y: side.map((r) => 2 * r + 1) })) } };
    },
  },
];

beforeEach(() => undefined);

describe("a windowed facet grid and axis break: the Stage export request", () => {
  it("a facet request holds one panel per level, each with the window's rows of that level", () => {
    const { request, want } = CASES[0].make();
    const facets = (request as { facets: { x: number[]; series: { y: number[] }[] }[] }).facets;
    expect(facets.map((f) => ({ x: f.x, y: f.series[0].y }))).toEqual(want.panels);
  });

  it("a break request holds exactly the window's rows, with the break ranges the renderer panels them by", () => {
    const { request, want } = CASES[1].make();
    const spec = request as { dataset: { time: number[]; values: number[][] }; overrides: { x_breaks: number[][] } };
    expect(spec.overrides.x_breaks).toEqual([[29, 130]]);
    expect(spec.dataset.time).toEqual(want.panels.flatMap((p) => p.x));
    expect(spec.dataset.values.map((v) => v[0])).toEqual(want.panels.flatMap((p) => p.y));
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = { cases: CASES.map((c) => c.make()) };
    if (process.env.ROW_RANGE_PANELS_FIXTURE_WRITE) writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
