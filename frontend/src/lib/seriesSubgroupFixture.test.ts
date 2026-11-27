// Plan item 24: subgroup increments in the dash / marker cycle (Origin's Plot Details > Group), screen ==
// export, as a SHARED wire fixture (`tests/fixtures/wire/series_subgroup.json`). With a subgroup size N the
// colour changes per run of N series and the dash and marker per series within the run. The canvas
// (`uplotSeries.buildSeriesDefs` over `displayPositions(N, ...)`) and the export request
// (`buildFigureSpecFromDocument` with the same N) are recorded; `tests/test_series_subgroup.py` posts the
// request and asserts matplotlib draws the same colour, dash and marker per series.
//
// Regenerate only after a DELIBERATE rule change:
//   SERIES_SUBGROUP_FIXTURE_WRITE=1 npx vitest run src/lib/seriesSubgroupFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveToHex } from "./color";
import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { buildColumns, composeDisplayPayload, effectiveChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import { displayPositions, resolveSeriesStyle, SERIES_VARS } from "./seriesStyleCycle";
import type { Dataset } from "./types";
import { buildSeriesDefs } from "./uplotSeries";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "series_subgroup.json");
const PALETTE = ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777", "#888888"];
const COLORS = { accentColor: "#00f", inkColor: "#eef0f6", inkDimColor: "#888", isDarkBg: false };

const N_SERIES = 7;
const ds: Dataset = {
  id: "d1", name: "item 24",
  data: {
    time: [0, 1, 2, 3],
    values: [0, 1, 2, 3].map((r) => Array.from({ length: N_SERIES }, (_, c) => r + c)),
    labels: Array.from({ length: N_SERIES }, (_, c) => `S${c}`), units: Array.from({ length: N_SERIES }, () => "u"), metadata: {},
  },
};
const view = (): PlotView => ({
  ...defaultPlotView(),
  seriesStyles: Object.fromEntries(Array.from({ length: N_SERIES }, (_, c) => [c, { marker: true, width: 1.5 }])),
});

beforeAll(() => { PALETTE.forEach((c, i) => document.documentElement.style.setProperty(SERIES_VARS[i], c)); });
afterAll(() => { SERIES_VARS.forEach((v) => document.documentElement.style.removeProperty(v)); });

function canvas(sub: number | boolean) {
  const v = view();
  const channels = effectiveChannels(ds.data, v.yKeys, v.xKey, ds.channelRoles, v.seriesOrder);
  const payload = composeDisplayPayload(buildColumns(ds.data, null, v.xKey, channels), {
    id: ds.id, waterfall: 0, dropped: new Set(), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
  const cycle = displayPositions(sub, channels.length);
  const styleList = payload.series.map((_, i) => v.seriesStyles[channels[i]]);
  const { series } = buildSeriesDefs(payload, { seriesStyles: styleList, seriesCycle: cycle }, channels.map(String), true, COLORS);
  return channels.map((_, i) => ({
    color: resolveToHex(String(series[i + 1].stroke)),
    dash: series[i + 1].dash ?? null,
    marker_shape: resolveSeriesStyle(styleList[i], i, cycle)?.markerShape,
  }));
}

function request(sub: number | boolean) {
  const doc = createFigureDocument({ id: "w1", name: "A", datasetId: "d1", view: view() });
  return buildFigureSpecFromDocument(doc, ds, "subgroup", { fmt: "svg", autoSeriesStyles: sub });
}

const fresh = () => ({ sub: 3, palette: PALETTE, canvas: canvas(3), request: request(3) });

describe("subgroup increments, screen == export (shared wire fixture)", () => {
  it("colour per run of N, dash and marker per member", () => {
    const c = canvas(3);
    expect(c.map((s) => s.color)).toEqual(["#111111", "#111111", "#111111", "#222222", "#222222", "#222222", "#333333"]);
    expect(c.map((s) => s.marker_shape)).toEqual(["circle", "square", "triangle", "circle", "square", "triangle", "circle"]);
    expect(c.map((s) => s.dash)).toEqual([null, [8, 4], [2, 4], null, [8, 4], [2, 4], null]);
  });

  it("with no size the cycle is the plain one: one colour per series, as before", () => {
    expect(canvas(true).map((s) => s.color)).toEqual(PALETTE.slice(0, 7));
    expect(canvas(true).map((s) => s.marker_shape)).toEqual(["circle", "square", "triangle", "diamond", "downtriangle", "plus", "cross"]);
    expect(displayPositions(2, 4)).toMatchObject({ sub: 2 });
    expect(displayPositions(true, 4)).not.toHaveProperty("sub");
    expect(displayPositions(false, 4)).toBeNull();
  });

  it("an explicit series colour or dash wins over the cycle", () => {
    const pos = displayPositions(2, 4);
    expect(resolveSeriesStyle({ color: "#abcdef", line: "dotted" }, 3, pos)).toMatchObject({ color: "#abcdef", line: "dotted", markerShape: "square" });
  });

  it("the export carries the same colour, dash and marker per series", () => {
    const styles = request(3).series_styles ?? [];
    expect(styles.map((s) => s?.color)).toEqual(canvas(3).map((s) => s.color));
    expect(styles.map((s) => s?.marker_shape)).toEqual(canvas(3).map((s) => s.marker_shape));
    expect(styles.map((s) => s?.line)).toEqual(["solid", "dashed", "dotted", "solid", "dashed", "dotted", "solid"]);
  });

  it("matches the committed wire fixture", () => {
    const now = JSON.parse(JSON.stringify(fresh()));
    if (process.env.SERIES_SUBGROUP_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, JSON.stringify(now, null, 2) + "\n", "utf8");
    expect(now).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });
});
