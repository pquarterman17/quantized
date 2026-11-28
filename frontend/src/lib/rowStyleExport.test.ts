// G24 row states: canvas <-> export PARITY, and "off means unchanged".
//
// The FRONTEND half of the screen/export check, the sibling of
// plotEncodingGradient.test.ts. From ONE row style it builds what the canvas
// paints (`rowStyleSpecs.withRowStates` -> `colorScatterFill` / `shapes`) and the
// real export request (`figureSpec.buildFigureSpecForView`, the window export's
// own builder), and pins both as `tests/fixtures/wire/row_states.json`
// ({request, screen}). The BACKEND half (`tests/test_export_row_states.py`)
// posts that request to /api/export/figure and reads every drawn point's fill and
// glyph back out of the SVG.
//
// To regenerate after a DELIBERATE rule change:
//   ROW_STATES_FIXTURE_WRITE=1 npx vitest run src/lib/rowStyleExport.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { colorScatterFill, type ColorScatterSpec } from "./colorscatter";
import { buildFigureSpec, type FigureRenderOpts } from "./figureSpec";
import { defaultPlotView } from "./plotview";
import { padRowStateWire, rowHex, withRowStateWire, type RowStateWire } from "./rowStyleExport";
import { buildRowStyle } from "./rowStyleBuild";
import { withRowStates } from "./rowStyleSpecs";
import { withExcludedGhosts } from "./excludedRowsExport";
import { SERIES_VARS } from "./seriesStyleCycle";
import type { Dataset, SeriesStyle } from "./types";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/wire/row_states.json");
const PALETTE = ["#0b6e4f", "#c3423f", "#2d3047", "#f2a541", "#5e548e", "#1b998b", "#e84855", "#3e2f5b"];
const SERIES_COLOR = "#336699"; // the series' own colour: what a row with no state takes
const OPTS = { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" };

const root = document.documentElement;
beforeEach(() => PALETTE.forEach((c, i) => root.style.setProperty(SERIES_VARS[i], c)));
afterEach(() => SERIES_VARS.forEach((v) => root.style.removeProperty(v)));

// ch0 Group (levels a, b, c), ch1 Signal. Row 3 (a) is excluded; row 6's Group
// is missing, so it has no state and draws in the series colour.
function dataset(): Dataset {
  const base: Dataset = {
    id: "rs",
    name: "rows.csv",
    data: {
      time: [0, 1, 2, 3, 4, 5, 6, 7],
      values: [[0, 1.0], [1, 1.5], [2, 2.0], [0, 2.5], [1, 3.0], [2, 3.5], [NaN, 4.0], [1, 4.5]],
      labels: ["Group", "Signal"],
      units: ["", "V"],
      metadata: {},
      cat_levels: { 0: ["a", "b", "c"] },
    },
    excludedRows: [3],
  };
  const built = buildRowStyle(base.data, { column: 0, mode: "levels", color: true, marker: true });
  if (!built.ok) throw new Error(built.reason);
  return { ...base, rowStyle: built.style };
}

const styles = (extra: SeriesStyle = {}): Record<number, SeriesStyle> => ({ 1: { color: SERIES_COLOR, rowStates: true, ...extra } });
const request = (ds: Dataset, seriesStyles: Record<number, SeriesStyle>, o: Partial<FigureRenderOpts> = {}) =>
  buildFigureSpec(() => ({}) as never, ds, "rows", { ...OPTS, ...o }, {}, { ...defaultPlotView(), yKeys: [1], seriesStyles });

describe("rowHex", () => {
  it("resolves a theme slot through --series-N and passes a literal hex through", () => {
    expect(rowHex("s1")).toBe("#0b6e4f");
    expect(rowHex("s8")).toBe("#3e2f5b");
    expect(rowHex("#ABCDEF")).toBe("#abcdef");
    expect(rowHex("")).toBeNull();
    expect(rowHex(undefined)).toBeNull();
  });
  it("a palette switch re-themes the same row cells (the project stores slots, not colours)", () => {
    root.style.setProperty(SERIES_VARS[0], "#112233");
    expect(rowHex("s1")).toBe("#112233");
  });
});

describe("canvas and export draw the same per-point colours and glyphs", () => {
  it("the canvas spec's per-row fill/shape equals the export's row_colors/row_markers (kept rows, same order)", () => {
    const ds = dataset();
    const spec = withRowStates(new Map(), ds, [1], styles()).get(1) as ColorScatterSpec;
    const wire = request(ds, styles()).series_styles?.[0] as RowStateWire;
    const kept = [0, 1, 2, 4, 5, 6, 7]; // row 3 is excluded: the export prunes it, the canvas blanks it
    const screenFill = kept.map((r) => colorScatterFill(spec, r) ?? SERIES_COLOR); // a row with no state keeps the series colour
    const screenShape = kept.map((r) => spec.shapes?.[r] ?? null);
    expect(wire.row_colors?.map((c) => c ?? SERIES_COLOR)).toEqual(screenFill);
    expect(wire.row_markers).toEqual(screenShape);
    expect(screenFill).toEqual(["#0b6e4f", "#c3423f", "#2d3047", "#c3423f", "#2d3047", SERIES_COLOR, "#c3423f"]);
    expect(screenShape).toEqual(["circle", "square", "triangle", "square", "triangle", null, "square"]);
  });

  it("the request matches the committed wire fixture byte for byte (the backend half renders it)", () => {
    const ds = dataset();
    const spec = withRowStates(new Map(), ds, [1], styles()).get(1) as ColorScatterSpec;
    const kept = [0, 1, 2, 4, 5, 6, 7];
    const current = JSON.parse(JSON.stringify({
      request: request(ds, styles()),
      screen: { points: kept.map((r) => ({ fill: colorScatterFill(spec, r) ?? SERIES_COLOR, shape: spec.shapes?.[r] ?? "circle" })) },
    })) as unknown;
    if (process.env.ROW_STATES_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, `${JSON.stringify(current, null, 2)}\n`);
    expect(current).toEqual(JSON.parse(readFileSync(FIXTURE, "utf-8")));
  });
});

describe("the option is OFF by default: existing figures are unchanged", () => {
  it("no rowStates flag: the canvas specs are the very same Map, the export carries no row arrays", () => {
    const ds = dataset();
    const base = new Map<number, ColorScatterSpec>();
    expect(withRowStates(base, ds, [1], { 1: { color: SERIES_COLOR } })).toBe(base);
    const wire = request(ds, { 1: { color: SERIES_COLOR } }).series_styles?.[0] as RowStateWire & { color?: string };
    expect(wire.row_colors).toBeUndefined();
    expect(wire.row_markers).toBeUndefined();
    expect(JSON.stringify(request(ds, { 1: { color: SERIES_COLOR } }))).toBe(JSON.stringify(request({ ...ds, rowStyle: undefined }, { 1: { color: SERIES_COLOR } })));
  });

  it("the flag on a dataset without row states (or with a stale array) changes nothing", () => {
    const ds = dataset();
    const base = new Map<number, ColorScatterSpec>();
    expect(withRowStates(base, { ...ds, rowStyle: undefined }, [1], styles())).toBe(base);
    expect(withRowStates(base, { ...ds, rowStyle: { color: ["s1"] } }, [1], styles())).toBe(base);
    const none = request({ ...ds, rowStyle: undefined }, styles()).series_styles?.[0] as RowStateWire;
    expect(none.row_colors).toBeUndefined();
  });

  it("a colour-by or size-by series with nothing drawn (no base spec) gets no canvas row states", () => {
    // With a base spec the row states lay over it (rowStateColorBy.test.ts); an empty column draws plain.
    const ds = dataset();
    const base = new Map<number, ColorScatterSpec>();
    expect(withRowStates(base, ds, [1], styles({ colorBy: 0 }))).toBe(base);
    expect(withRowStates(base, ds, [1], styles({ sizeBy: 0 }))).toBe(base);
  });

  it("without a live dataset (a frozen document) no row arrays are sent", () => {
    const plain = [{ color: SERIES_COLOR }];
    expect(withRowStateWire(plain, [1], styles(), null, 8)).toBe(plain);
  });
});

describe("withRowStateWire", () => {
  it("fails closed when the request's row count is not the dataset's", () => {
    const ds = dataset();
    expect(withRowStateWire(null, [1], styles(), ds, 3)).toBeNull();
  });

  it("a grey-excluded export pads the arrays for the appended lost rows, so they stay aligned", () => {
    const ds = dataset();
    const req = request(ds, styles(), { greyExcluded: withExcludedGhosts });
    const main = req.series_styles?.[0] as RowStateWire;
    expect(req.dataset.time).toHaveLength(8); // 7 kept + 1 lost
    expect(main.row_colors).toHaveLength(8);
    expect(main.row_colors?.[7]).toBeNull();
    expect(padRowStateWire(null, 2)).toBeNull();
  });
});
