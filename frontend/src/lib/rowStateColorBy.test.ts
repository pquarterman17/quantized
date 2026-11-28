// G24 row states on a COLOUR-BY and a SIZE-BY series (plan item 51, "Row windows"; #1236 left them plain). Canvas <->
// export parity, the FRONTEND half: from ONE row style it builds what the canvas paints for each point (the colour
// scale's spec with the row states laid over it, `rowStyleSpecs.withRowStates` over `buildColorByColumns` +
// `marksImpl.withSizes`, read by the one fill rule the two plugins share) and the real export request
// (`figureSpec.buildFigureSpec`), and pins both as `tests/fixtures/wire/row_states_colorby.json`. The backend half
// (`tests/test_export_row_states_colorby.py`) renders each request and reads every drawn point back.
//
// A row WITH a state takes its colour and glyph; every other row keeps the scale's colour (colour-by) or the series'
// stroke (size-only) and the series' glyph. Sizes are unchanged by row states.
//
// Regenerate only after a DELIBERATE rule change:
//   ROW_STATES_COLORBY_FIXTURE_WRITE=1 npx vitest run src/lib/rowStateColorBy.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildColorByColumns, colorScatterFill, type ColorScatterSpec } from "./colorscatter";
import { buildFigureSpec, type FigureRenderOpts } from "./figureSpec";
import { withSizes } from "./marksImpl";
import { defaultPlotView } from "./plotview";
import { buildRowStyle } from "./rowStyleBuild";
import { withRowStateWire, type RowStateWire } from "./rowStyleExport";
import { withRowStates } from "./rowStyleSpecs";
import { SERIES_VARS } from "./seriesStyleCycle";
import type { Dataset, SeriesStyle } from "./types";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/wire/row_states_colorby.json");
const PALETTE = ["#0b6e4f", "#c3423f", "#2d3047", "#f2a541", "#5e548e", "#1b998b", "#e84855", "#3e2f5b"];
const SERIES_COLOR = "#336699";
const OPTS = { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" };

const root = document.documentElement;
beforeEach(() => PALETTE.forEach((c, i) => root.style.setProperty(SERIES_VARS[i], c)));
afterEach(() => SERIES_VARS.forEach((v) => root.style.removeProperty(v)));

// ch0 Group (a, b, c: the row style's source), ch1 Signal (plotted), ch2 Temp (colour), ch3 Mass (size).
// Row 3 is excluded; row 6 has no Group (no state, so it keeps the scale's colour); row 5's Temp is missing.
function dataset(): Dataset {
  const base: Dataset = {
    id: "rs",
    name: "rows.csv",
    data: {
      time: [0, 1, 2, 3, 4, 5, 6, 7],
      values: [[0, 1.0, 10, 1], [1, 1.5, 20, 2], [2, 2.0, 30, 4], [0, 2.5, 40, 3], [1, 3.0, 50, 5], [2, 3.5, NaN, 6], [NaN, 4.0, 70, 8], [1, 4.5, 80, 7]],
      labels: ["Group", "Signal", "Temp", "Mass"],
      units: ["", "V", "K", "g"],
      metadata: {},
      cat_levels: { 0: ["a", "b", "c"] },
    },
    excludedRows: [3],
  };
  const built = buildRowStyle(base.data, { column: 0, mode: "levels", color: true, marker: true });
  if (!built.ok) throw new Error(built.reason);
  return { ...base, rowStyle: built.style };
}

const KEPT = [0, 1, 2, 4, 5, 6, 7];
const CASES: Record<string, SeriesStyle> = {
  colorBy: { color: SERIES_COLOR, rowStates: true, colorBy: 2 },
  sizeBy: { color: SERIES_COLOR, rowStates: true, sizeBy: 3 },
  both: { color: SERIES_COLOR, rowStates: true, colorBy: 2, sizeBy: 3 },
};
const request = (ds: Dataset, style: SeriesStyle, o: Partial<FigureRenderOpts> = {}) =>
  buildFigureSpec(() => ({}) as never, ds, "rows", { ...OPTS, ...o }, {}, { ...defaultPlotView(), yKeys: [1], seriesStyles: { 1: style } });

/** The canvas spec of series channel 1 with the row states laid over it, as `usePlotPayload` builds it. */
function screenSpec(ds: Dataset, style: SeriesStyle): ColorScatterSpec {
  const styles = { 1: style };
  const base = withSizes(buildColorByColumns(ds.data, [1], styles), ds.data, [1], styles);
  return withRowStates(base, ds, [1], styles).get(1) as ColorScatterSpec;
}

/** What the two plugins paint for row `r`: the one fill rule, the glyph, the diameter (null: not sized). */
const point = (spec: ColorScatterSpec, ds: Dataset, r: number) => ({
  y: ds.data.values[r][1],
  state: !!spec.fills?.[r],
  fill: colorScatterFill(spec, r) ?? (spec.flat ? SERIES_COLOR : null),
  shape: spec.shapes?.[r] ?? spec.shape ?? "circle",
  diam: spec.diam?.[r] ?? null,
});

describe("row states over a colour-by / size-by series", () => {
  it("rows with a state take its colour and glyph; the others keep the scale colour or the stroke (hand-stated cells)", () => {
    const ds = dataset();
    const pts = KEPT.map((r) => point(screenSpec(ds, CASES.colorBy), ds, r));
    // Group cells: a -> s1 circle, b -> s2 square, c -> s3 triangle; row 6 has none (a scale colour, the default glyph).
    expect(pts.map((p) => p.state)).toEqual([true, true, true, true, true, false, true]);
    expect(pts.map((p) => p.shape)).toEqual(["circle", "square", "triangle", "square", "triangle", "circle", "square"]);
    expect(pts.filter((p) => p.state).map((p) => p.fill)).toEqual(["#0b6e4f", "#c3423f", "#2d3047", "#c3423f", "#2d3047", "#c3423f"]);
    expect(pts[5].fill).toMatch(/^rgb\(/); // row 6: the colour scale (Temp 70 of 10..80)
    const sized = KEPT.map((r) => point(screenSpec(ds, CASES.sizeBy), ds, r));
    expect(sized.map((p) => p.fill)).toEqual(["#0b6e4f", "#c3423f", "#2d3047", "#c3423f", "#2d3047", SERIES_COLOR, "#c3423f"]);
    expect(sized.every((p) => p.diam !== null && p.diam > 0)).toBe(true);
  });

  it("a row's size is unchanged by its state", () => {
    const ds = dataset();
    const plain = withSizes(new Map(), ds.data, [1], { 1: { color: SERIES_COLOR, sizeBy: 3 } }).get(1) as ColorScatterSpec;
    expect(screenSpec(ds, CASES.sizeBy).diam).toEqual(plain.diam);
  });

  it("without a colour or size column the series takes the flat plain row states, as before", () => {
    const spec = screenSpec(dataset(), { color: SERIES_COLOR, rowStates: true });
    expect(spec.flat).toBe(true);
    expect(spec.diam).toBeUndefined();
  });

  it("an empty colour column draws plain: no spec to lay the row states over, so none are added", () => {
    const ds = dataset();
    const blank = { ...ds, data: { ...ds.data, values: ds.data.values.map((v) => [v[0], v[1], NaN, v[3]]) } };
    const styles = { 1: CASES.colorBy };
    const base = buildColorByColumns(blank.data, [1], styles);
    expect(base.size).toBe(0);
    expect(withRowStates(base, blank, [1], styles)).toBe(base);
  });

  it("the export carries the row arrays for a colour-by / size-by series, over the kept rows", () => {
    const ds = dataset();
    for (const style of Object.values(CASES)) {
      const wire = request(ds, style).series_styles?.[0] as RowStateWire;
      expect(wire.row_colors).toHaveLength(KEPT.length);
      expect(wire.row_markers).toEqual(["circle", "square", "triangle", "square", "triangle", null, "square"]);
    }
    // No flag: still none (the option is opt-in).
    expect((request(ds, { color: SERIES_COLOR, colorBy: 2 }).series_styles?.[0] as RowStateWire).row_colors).toBeUndefined();
    const plain = [{ color: SERIES_COLOR }];
    expect(withRowStateWire(plain, [1], { 1: { color: SERIES_COLOR, colorBy: 2 } }, ds, KEPT.length)).toBe(plain);
  });

  it("matches the committed wire fixture the backend half renders", () => {
    const ds = dataset();
    const cases = Object.fromEntries(
      Object.entries(CASES).map(([name, style]) => [
        name,
        { request: request(ds, style), screen: { points: KEPT.map((r) => point(screenSpec(ds, style), ds, r)) } },
      ]),
    );
    const current = JSON.parse(JSON.stringify({ cases })) as unknown;
    if (process.env.ROW_STATES_COLORBY_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, `${JSON.stringify(current, null, 2)}\n`);
    expect(current).toEqual(JSON.parse(readFileSync(FIXTURE, "utf-8")));
  });
});
