// F4.2c (a): greyed excluded rows on the export wire (`excludedRowsExport.ts`)
// and the page-level builders that thread the choice.

import { beforeEach, describe, expect, it } from "vitest";

import type { FigureSpec } from "./api/figures";
import { excludedChoiceMatters, EXCLUDED_GHOST_STYLE, withExcludedGhosts } from "./excludedRowsExport";
import { pageExcludedChoiceMatters } from "./excludedRowsChoice";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { createFigureDocument } from "./figureDocument";
import { createPageDocument } from "./pageDocumentActions";
import { defaultPlotView } from "./plotview";
import type { DataStruct, Dataset } from "./types";
import { buildPageSpecFromDocument } from "../components/workshops/figurepage/panelResolve";
import { useApp } from "../store/useApp";

const DATA: DataStruct = {
  time: [1, 2, 3, 4],
  values: [
    [10, 5, 0.1],
    [20, 6, 0.2],
    [30, 7, 0.3],
    [40, 8, 0.4],
  ],
  labels: ["M", "N", "X"],
  units: ["emu", "emu", "T"],
  metadata: {},
};
const DS: Dataset = { id: "d1", name: "scan.dat", data: DATA, excludedRows: [1] };

function build(view: Partial<ReturnType<typeof defaultPlotView>>, mode: "grey" | "omit", ds: Dataset = DS) {
  const doc = createFigureDocument({ id: "f1", name: "fig", datasetId: ds.id, view: { ...defaultPlotView(), ...view } });
  return buildFigureSpecFromDocument(doc, ds, "fig", { greyExcluded: mode === "grey" ? withExcludedGhosts : undefined });
}

describe("withExcludedGhosts (F4.2c (a))", () => {
  it("omit keeps today's pruned wire; grey appends one greyed companion per plotted series", () => {
    const omit = build({ yKeys: [0, 1] }, "omit");
    const grey = build({ yKeys: [0, 1] }, "grey");
    expect(omit.dataset.time).toEqual([1, 3, 4]);
    expect(omit.y_keys).toEqual([0, 1]);
    expect(grey.y_keys).toEqual([0, 1, 3, 4]);
    expect(grey.dataset.labels).toEqual(["M", "N", "X", "M (excluded)", "N (excluded)"]);
    expect(grey.dataset.units).toEqual(["emu", "emu", "T", "emu", "emu"]);
    // Kept rows first, in order, exactly where the omit export put them ...
    expect(grey.dataset.time).toEqual([1, 3, 4, 2]);
    expect(grey.dataset.values.slice(0, 3).map((r) => r.slice(0, 3))).toEqual(omit.dataset.values);
    for (const r of grey.dataset.values.slice(0, 3)) expect(r.slice(3)).toEqual([NaN, NaN]);
    // ... then the dropped row: plotted channels blank, ghosts carry its values.
    expect(grey.dataset.values[3]).toEqual([NaN, NaN, 0.2, 20, 6]);
    expect(grey.series_styles?.slice(2)).toEqual([EXCLUDED_GHOST_STYLE, EXCLUDED_GHOST_STYLE]);
    expect(excludedChoiceMatters(grey, omit)).toBe(true);
  });

  it("keeps an explicit X channel's value on a dropped row, even when X is also plotted", () => {
    const grey = build({ xKey: 2, yKeys: [0] }, "grey");
    expect(grey.x_key).toBe(2);
    expect(grey.dataset.values[3]).toEqual([NaN, 6, 0.2, 20]);
    // A document may plot its X channel as a Y series too (allowExplicitXAsY).
    const both = build({ xKey: 2, yKeys: [0, 2] }, "grey");
    expect(both.y_keys).toEqual([0, 2, 3, 4]);
    expect(both.dataset.values[3]).toEqual([NaN, 6, 0.2, 20, 0.2]);
  });

  it("a ghost follows its parent onto the secondary axis and keeps its legend rename", () => {
    const grey = build({ yKeys: [0, 1], y2Keys: [1], seriesLabels: { 0: "Moment" } }, "grey");
    expect(grey.y2_keys).toEqual([1, 4]);
    expect(grey.series_styles?.[2]?.legend).toBe("Moment (excluded)");
    expect(grey.series_styles?.[3]?.legend).toBeUndefined();
  });

  it("is an identity with nothing dropped, so no question is asked", () => {
    const clean: Dataset = { ...DS, excludedRows: undefined };
    const grey = build({ yKeys: [0] }, "grey", clean);
    const omit = build({ yKeys: [0] }, "omit", clean);
    expect(grey).toEqual(omit);
    expect(excludedChoiceMatters(grey, omit)).toBe(false);
  });

  it("repeats the parent's waterfall/decade offsets and pads error spans for the ghosts", () => {
    const spec: FigureSpec = {
      dataset: { ...DATA, time: [1, 3, 4], values: [DATA.values[0], DATA.values[2], DATA.values[3]] },
      y_keys: [0, 1],
      waterfall_offsets: [0, 5],
      log_offsets: [1, 2],
      error_spans: [{ y: { plus: [1, 1, 1], minus: [1, 1, 1] } }, null],
    };
    const grey = withExcludedGhosts(spec, DATA, new Set([1]));
    expect(grey.waterfall_offsets).toEqual([0, 5, 0, 5]);
    expect(grey.log_offsets).toEqual([1, 2, 1, 2]);
    expect(grey.error_spans).toEqual([spec.error_spans![0], null, null, null]);
  });

  it("leaves faceted and encoded requests alone (their renderers cannot grey)", () => {
    const base: FigureSpec = { dataset: { ...DATA, time: [1, 3, 4], values: [] }, y_keys: [0] };
    const faceted = { ...base, facets: [] as never[] };
    const encoded = { ...base, encoding: { color_col: 2 } };
    expect(withExcludedGhosts(faceted, DATA, new Set([1]))).toBe(faceted);
    expect(withExcludedGhosts(encoded, DATA, new Set([1]))).toBe(encoded);
  });

  it("refuses a spec whose rows are not the pruned view of this data", () => {
    const stale: FigureSpec = { dataset: DATA, y_keys: [0] };
    expect(withExcludedGhosts(stale, DATA, new Set([1]))).toBe(stale);
  });
});

describe("page exports thread the choice to every panel (F4.2c (a))", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [DS], editableFigures: [] });
  });

  it("buildPageSpecFromDocument greys a panel's excluded rows only when asked", async () => {
    const fig = createFigureDocument({ id: "f1", name: "fig", datasetId: "d1", view: { ...defaultPlotView(), yKeys: [0] } });
    const page = createPageDocument({ id: "p1", name: "page", panels: [{ figureId: "f1", label: null, title: null }] });
    const omit = await buildPageSpecFromDocument(page, [fig]);
    const grey = await buildPageSpecFromDocument(page, [fig], withExcludedGhosts);
    expect(omit!.panels[0].figure.y_keys).toEqual([0]);
    expect(grey!.panels[0].figure.y_keys).toEqual([0, 3]);
    expect(pageExcludedChoiceMatters(grey, omit)).toBe(true);
    expect(pageExcludedChoiceMatters(omit, omit)).toBe(false);
    expect(pageExcludedChoiceMatters(null, null)).toBe(false);
  });
});
