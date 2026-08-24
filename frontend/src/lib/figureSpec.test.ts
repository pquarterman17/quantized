import { describe, expect, it } from "vitest";

import {
  buildFigureSpec,
  buildFigureSpecFromDocument,
  buildStageFigureSpec,
  resolveFigureDocumentData,
  viewOverrides,
} from "./figureSpec";
import { facetPanelsOf } from "./composition";
import { createFigureDocument, figureDocumentToPlotView, updateFigureDocumentFromPlotView } from "./figureDocument";
import { facetCompositionFromBinding } from "./facet";
import { defaultPlotView } from "./plotview";
import type { Dataset, DataStruct } from "./types";

const data: DataStruct = {
  time: [0, 1, 2],
  values: [
    [10, 100, 1, 2, 0.1, 0.01],
    [20, 200, 3, 4, 0.2, 0.02],
    [30, 300, 5, 6, 0.3, 0.03],
  ],
  labels: ["group", "signal", "right", "plus", "minus", "x error"],
  units: ["", "V", "A", "V", "V", "s"],
  metadata: {},
};

const dataset: Dataset = {
  id: "dataset-1",
  name: "device.csv",
  data,
  channelRoles: { 5: "ignore" },
};

function richView() {
  return {
    ...defaultPlotView(),
    xKey: null,
    yKeys: [1, 2],
    y2Keys: [2],
    y2Scale: "log" as const,
    y2Fmt: { mode: "sci" as const, digits: 3 },
    y2Step: 2,
    y2AxisLabel: "Right axis",
    xScale: "log" as const,
    yScale: "reciprocal" as const,
    xFmt: { mode: "fixed" as const, digits: 1 },
    yFmt: { mode: "eng" as const, digits: 2 },
    xStep: 0.5,
    yStep: 4,
    plotTitle: "Canonical export",
    xAxisLabel: "Time (s)",
    yAxisLabel: "Response",
    seriesOrder: [2, 1],
    seriesLabels: { 1: "left trace" },
    seriesStyles: { 1: { color: "#123456", width: 3, marker: true, markerSize: 7 } },
    showLegend: true,
    legendXY: [0.2, 0.8] as [number, number],
    legendTitle: "Signals",
    showGrid: true,
    showAxisBox: true,
    xLim: [0.1, 10] as [number, number],
    yLim: [1, 9] as [number, number],
    y2Lim: [2, 20] as [number, number],
    annotations: [{ id: "a", x: 1, y: 2, text: "peak", size: 14, frame: { pad: 3 } }],
    shapes: [{ id: "s", kind: "rect" as const, x1: 0, y1: 1, x2: 2, y2: 3, stroke: "#f00" }],
    refLines: [{ id: "r", axis: "x" as const, value: 5 }],
    regionShades: [{ id: "sh", x1: 0, x2: 2, y1: 1, y2: 3, fill: "#336699", axis: 1 as const }],
    pageSetup: {
      width: 10,
      height: 5,
      unit: "cm" as const,
      margins: { left: 1, right: 2, top: 0.5, bottom: 1.5 },
      aspectDerived: false,
    },
  };
}

describe("FigureDocument FigureSpec adapter", () => {
  it("preserves an explicitly bound Y channel that is also the X channel", () => {
    const document = createFigureDocument({
      id: "same-x-y",
      name: "Resistance against itself and voltage",
      datasetId: dataset.id,
      view: { ...defaultPlotView(), xKey: 0, yKeys: [0, 1] },
      publication: {
        overrides: null,
        seriesStyles: [{ color: "#3366cc" }, { color: "#cc6633" }],
      },
    });

    const spec = buildFigureSpecFromDocument(document, dataset, "same-x-y");

    expect(spec.x_key).toBe(0);
    expect(spec.y_keys).toEqual([0, 1]);
    expect(spec.series_styles).toEqual([{ color: "#3366cc" }, { color: "#cc6633" }]);
  });

  it("keeps the established StoreGet FigureSpec wire shape byte/deep-equal", () => {
    const view = richView();
    const get = (() => view) as never;
    const opts = { fmt: "svg", style: "thesis", dpi: 600, title: "Override", xLabel: "X", yLabel: "Y" };

    const spec = buildFigureSpec(get, dataset, "device", opts);

    const expected = {
      dataset: { ...data, labels: ["group", "left trace", "right", "plus", "minus", "x error"] },
      x_key: undefined,
      y_keys: [2, 1],
      x_scale: "log",
      y_scale: "reciprocal",
      x_fmt: { mode: "fixed", digits: 1 },
      y_fmt: { mode: "eng", digits: 2 },
      x_step: 0.5,
      y_step: 4,
      y2_keys: [2],
      y2_label: "Right axis",
      y2_scale: "log",
      y2_fmt: { mode: "sci", digits: 3 },
      y2_step: 2,
      fmt: "svg",
      style: "thesis",
      dpi: 600,
      width_in: 10 / 2.54,
      height_in: 5 / 2.54,
      title: "Override",
      x_label: "X",
      y_label: "Y",
      series_styles: [
        { color: "#8b5cf6" },
        { color: "#123456", width: 3, marker: true, marker_size: 7 },
      ],
      overrides: {
        legend: { show: true, loc: "custom", anchor: [0.2, 0.8], title: "Signals" },
        annotations: [{ x: 1, y: 2, text: "peak", size: 14, frame: { pad: 3 } }],
        shapes: [{ kind: "rect", x1: 0, y1: 1, x2: 2, y2: 3, stroke: "#f00" }],
        ref_lines: [{ axis: "x", value: 5 }],
        region_shades: [{ x1: 0, x2: 2, y1: 1, y2: 3, fill: "#336699", axis: 1 }],
        x_lim: [0.1, 10],
        y_lim: [1, 9],
        grid: true,
        spines: { top: true, right: true },
        margins: { left: 0.1, right: 0.2, top: 0.1, bottom: 0.3 },
        y2_lim: [2, 20],
        ticks: { minor: true },
      },
      filename: "device",
    };
    expect(spec).toEqual(expected);
    expect(JSON.stringify(spec)).toBe(JSON.stringify(expected));
  });

  it("exports canonical bindings, rich display state, page setup, output defaults, and x breaks", () => {
    const document = createFigureDocument({
      id: "figure-1",
      name: "Device figure",
      datasetId: dataset.id,
      view: richView(),
      axisBreaks: { x: [[0.4, 0.6]], y: [[3, 4]], y2: [[5, 6]] },
      errors: [
        { target: 1, channel: 3, axis: "y", side: "+" },
        { target: 1, channel: 4, axis: "y", side: "-" },
        { target: -1, channel: 5, axis: "x", side: "both" },
      ],
      output: { format: "png", stylePreset: "nature", dpi: 450, transparent: true, filename: "saved-device" },
    });
    const documentBefore = structuredClone(document);
    const datasetBefore = structuredClone(dataset);

    const spec = buildFigureSpecFromDocument(document, dataset, "fallback");

    expect(spec).toMatchObject({
      x_key: undefined,
      y_keys: [2, 1],
      y2_keys: [2],
      y2_scale: "log",
      y2_fmt: { mode: "sci", digits: 3 },
      x_fmt: { mode: "fixed", digits: 1 },
      y_fmt: { mode: "eng", digits: 2 },
      fmt: "png",
      style: "nature",
      dpi: 450,
      transparent: true,
      filename: "saved-device",
      width_in: 10 / 2.54,
      height_in: 5 / 2.54,
      series_styles: [
        { color: "#8b5cf6" },
        { color: "#123456", width: 3, marker: true, marker_size: 7 },
      ],
    });
    expect(spec.error_spans).toEqual([
      { x: { plus: [0.01, 0.02, 0.03], minus: [0.01, 0.02, 0.03] } },
      {
        x: { plus: [0.01, 0.02, 0.03], minus: [0.01, 0.02, 0.03] },
        y: { plus: [2, 4, 6], minus: [0.1, 0.2, 0.3] },
      },
    ]);
    expect(spec.overrides).toMatchObject({
      legend: { show: true, loc: "custom", anchor: [0.2, 0.8], title: "Signals" },
      annotations: [{ text: "peak", frame: { pad: 3 } }],
      shapes: [{ kind: "rect", stroke: "#f00" }],
      // Export-fidelity gap (2026-08-11): confirms refLines/regionShades
      // flow through the buildFigureSpecFromDocument path too (the shared
      // core viewOverrides feeds, per figureDocumentToPlotView), not just
      // the StoreGet path the byte-equality test above pins.
      ref_lines: [{ axis: "x", value: 5 }],
      region_shades: [{ x1: 0, x2: 2, y1: 1, y2: 3, fill: "#336699", axis: 1 }],
      x_breaks: [[0.4, 0.6]],
      margins: { left: 0.1, right: 0.2, top: 0.1, bottom: 0.3 },
    });

    expect(buildFigureSpecFromDocument(document, dataset, "fallback", {
      fmt: "svg", dpi: 72, transparent: false, filename: null,
    })).toMatchObject({ fmt: "svg", dpi: 72, transparent: false, filename: "fallback" });
    expect(document).toEqual(documentBefore);
    expect(dataset).toEqual(datasetBefore);
  });

  it("keeps canonical-only rich errors, mark/facet, breaks, and output across the PlotView facade round trip", () => {
    const document = createFigureDocument({
      id: "round-trip",
      name: "Round trip",
      datasetId: dataset.id,
      view: { ...defaultPlotView(), errKeys: { 1: 3 } },
      mark: "scatter",
      facetKey: 2,
      errors: [{ target: -1, channel: 5, axis: "x", side: "both" }, { target: 1, channel: 4, axis: "y", side: "+" }],
      axisBreaks: { x: [[1, 2]], y: [[3, 4]], y2: [[5, 6]] },
      output: { format: "tiff", dpi: 900, transparent: true, filename: "canonical" },
      publication: {
        overrides: { font_name: "Helvetica", margins: { left: 0.1 }, ticks: { dir: "in" } },
        seriesStyles: [{ color: "#111111", line: "none", marker: true }],
      },
    });

    const restored = updateFigureDocumentFromPlotView(document, { view: figureDocumentToPlotView(document) });

    expect(restored.bindings.errors).toEqual(document.bindings.errors);
    expect(restored.bindings.facetKey).toBe(2);
    expect(restored.plot.mark).toBe("scatter");
    expect(restored.plot.axisBreaks).toEqual(document.plot.axisBreaks);
    expect(restored.output).toEqual(document.output);
    expect(restored.publication).toEqual(document.publication);
  });

  it("merges publication overrides by explicit nested field and honors absent/null/exact series styles", () => {
    const base = {
      id: "publication", name: "Publication", datasetId: dataset.id,
      view: { ...richView(), yKeys: [1], y2Keys: [], y2Scale: null, y2Fmt: null, y2Step: null, y2AxisLabel: "" },
    };
    const absent = createFigureDocument(base);
    expect(buildFigureSpecFromDocument(absent, dataset, "absent").series_styles).toHaveLength(1);

    const nullStyles = createFigureDocument({ ...base, publication: { overrides: null, seriesStyles: null } });
    expect(buildFigureSpecFromDocument(nullStyles, dataset, "null")).not.toHaveProperty("series_styles");

    const exactStyles = [{ color: "#fedcba", line: "none" as const, marker: true, marker_size: 9 }];
    const publication = createFigureDocument({
      ...base,
      publication: {
        overrides: { font_size: 11, legend: { title: "Publication legend" }, margins: { left: 0.33 }, ticks: { dir: "in" } },
        seriesStyles: exactStyles,
      },
    });
    const spec = buildFigureSpecFromDocument(publication, dataset, "publication");
    expect(spec.overrides).toMatchObject({
      font_size: 11,
      legend: { show: true, loc: "custom", anchor: [0.2, 0.8], title: "Publication legend" },
      margins: { left: 0.33, right: 0.2, top: 0.1, bottom: 0.3 },
      ticks: { dir: "in", minor: true },
    });
    expect(spec.series_styles).toEqual(exactStyles);
    expect(spec.series_styles).not.toBe(exactStyles);
  });

  it("rejects a mismatched live dataset and resolves frozen documents from their snapshot", () => {
    const live = createFigureDocument({ id: "live", name: "Live", datasetId: dataset.id, view: richView() });
    expect(() => buildFigureSpecFromDocument(live, { ...dataset, id: "other" }, "bad")).toThrow('bound to dataset "dataset-1"');
    expect(() => buildFigureSpecFromDocument(live, undefined, "missing")).toThrow('requires dataset "dataset-1"');

    const frozen = createFigureDocument({
      id: "frozen",
      name: "Frozen",
      datasetId: null,
      view: { ...defaultPlotView(), yKeys: [1] },
      data: { mode: "frozen", snapshot: data },
    });
    const resolved = resolveFigureDocumentData(frozen);
    expect(resolved.data).toEqual(data);
    expect(resolved.data).not.toBe(data);
    expect(buildFigureSpecFromDocument(frozen, undefined, "frozen").dataset).toEqual(data);
  });

  it("exports grouping without y2 and rejects the backend-invalid grouped+y2 combination", () => {
    const grouped = createFigureDocument({
      id: "grouped",
      name: "Grouped",
      datasetId: dataset.id,
      view: { ...richView(), y2Keys: [], y2Scale: null, y2Fmt: null, y2Step: null, y2AxisLabel: "" },
      groupKey: 0,
    });
    expect(buildFigureSpecFromDocument(grouped, dataset, "grouped").group_col).toBe(0);

    const invalid = createFigureDocument({
      id: "invalid",
      name: "Grouped y2",
      datasetId: dataset.id,
      view: richView(),
      groupKey: 0,
    });
    expect(() => buildFigureSpecFromDocument(invalid, dataset, "invalid"))
      .toThrow("grouped figures cannot use a secondary Y axis");
  });
});

// F2.5b (FIGURE_AUTHORING_WORKFLOW_PLAN): Stage copy/export ("Copy figure",
// "Copy figure (vector)", "Export figure…") used to build its spec via
// buildFigureSpec — the live PlotView singleton, which cannot represent
// groupKey/axisBreaks/publication overrides at all (no fields for them) — so
// a Stage copy/export of a grouped, axis-broken, or publication-styled
// window silently dropped all three, even though the SAME window's
// Publication Preview export and F3.6's page-panel export kept them (both
// already routed through buildFigureSpecFromDocument). buildStageFigureSpec
// is the fix: it prefers the focused window's canonical document and only
// falls back to the legacy builder when no canonical document applies.
describe("buildStageFigureSpec (F2.5b — Stage copy/export routing)", () => {
  /** A StoreGet-shaped closure carrying richView()'s fields (what the
   *  FALLBACK path reads) plus the window-focus fields buildStageFigureSpec
   *  itself reads. Defaults to "nothing focused" so a bare fakeStage()
   *  always exercises the fallback, matching every pre-F2.5b test's shape. */
  function fakeStage(over: Record<string, unknown> = {}) {
    const state = { ...richView(), focusedWindowId: null, windowsForSave: () => [], ...over };
    return (() => state) as never;
  }
  const opts = { fmt: "pdf", style: "default", dpi: 300, title: "", xLabel: "", yLabel: "" };

  it("CHARACTERIZATION: the legacy builder cannot carry grouping/breaks/publication overrides at all; routing through the focused window's document closes the gap", () => {
    const document = createFigureDocument({
      id: "stage-window",
      name: "Stage window",
      datasetId: dataset.id,
      // y2 disabled on the document's own view — grouping + a secondary axis
      // is a separate, deliberately rejected combination (tested below).
      view: { ...richView(), y2Keys: [], y2Scale: null, y2Fmt: null, y2Step: null, y2AxisLabel: "" },
      groupKey: 0,
      axisBreaks: { x: [[0.4, 0.6]] },
      publication: { overrides: { font_size: 11 } },
    });

    // BEFORE (the audited gap): the legacy builder, with no focused window
    // routed in, cannot carry any of the three fields onto the wire.
    const legacy = buildFigureSpec(fakeStage(), dataset, "device", opts);
    expect(legacy.group_col).toBeUndefined();
    expect(legacy.overrides?.x_breaks).toBeUndefined();
    expect(legacy.overrides?.font_size).toBeUndefined();

    // AFTER (the fix): the SAME dataset/stem/opts, but with the document
    // reachable as the focused window — all three now reach the wire.
    const routed = buildStageFigureSpec(
      fakeStage({ focusedWindowId: "w1", windowsForSave: () => [{ id: "w1", kind: "plot", document }] }),
      dataset,
      "device",
      opts,
    );
    expect(routed.group_col).toBe(0);
    expect(routed.overrides?.x_breaks).toEqual([[0.4, 0.6]]);
    expect(routed.overrides?.font_size).toBe(11);
  });

  it("dialog/copy-default choices win over the document's saved output settings, and the dataset stem still names the file", () => {
    const document = createFigureDocument({
      id: "stage-window-2",
      name: "Stage window 2",
      datasetId: dataset.id,
      view: richView(),
      output: { format: "tiff", stylePreset: "nature", dpi: 900, filename: "saved-name" },
    });
    const spec = buildStageFigureSpec(
      fakeStage({ focusedWindowId: "w1", windowsForSave: () => [{ id: "w1", kind: "plot", document }] }),
      dataset,
      "device-stem",
      { fmt: "svg", style: "thesis", dpi: 72, title: "Caller title", xLabel: "", yLabel: "" },
    );
    expect(spec.fmt).toBe("svg");
    expect(spec.style).toBe("thesis");
    expect(spec.dpi).toBe(72);
    expect(spec.title).toBe("Caller title");
    // filename: null (Stage's convention) — never the document's own saved
    // output filename.
    expect(spec.filename).toBe("device-stem");
  });

  // FIGURE_AUTHORING_WORKFLOW_PLAN F4.4 (export half, closed): this test
  // used to pin the OLD documented scope boundary -- a facet-bound window
  // exported byte-identically to the same view without a facet binding,
  // because FigureSpec had no transport fields for `facetKey` at all (see
  // `buildFigureSpecFromDocument`'s prior header). That gap is now closed:
  // a durable facet binding must render as the SAME small-multiples grid
  // Stage shows on screen, not a silently-dropped, single overlaid plot.
  // This replaces that pin with the new honest behavior deliberately, not
  // as an incidental diff -- see `buildFacetSpecs`'s own doc for exactly
  // what gets resolved onto the wire and why.
  it("exports a facet-bound window as a resolved facet grid, not identically to the same view without one", () => {
    const withFacet = createFigureDocument({
      id: "faceted-window", name: "Faceted", datasetId: dataset.id, view: richView(), facetKey: 1,
    });
    const withoutFacet = createFigureDocument({
      id: "faceted-window", name: "Faceted", datasetId: dataset.id, view: richView(),
    });
    const specFor = (document: typeof withFacet) =>
      buildStageFigureSpec(
        fakeStage({ focusedWindowId: "w1", windowsForSave: () => [{ id: "w1", kind: "plot", document }] }),
        dataset,
        "device",
        opts,
      );
    const flat = specFor(withoutFacet);
    const faceted = specFor(withFacet);

    // Absent when there's no facet binding at all (today's byte-identical
    // behaviour for every non-faceted export is unchanged).
    expect(flat.facets).toBeUndefined();

    // Present, and resolved into one panel per distinct level of channel 1
    // ("signal": values 100/200/300 in `data` above, all distinct) -- the
    // SAME partition `lib/facet.facetPayloads` builds for the on-screen grid.
    expect(faceted.facets).toHaveLength(3);
    expect(faceted.facets?.map((f) => f.label)).toEqual(["100", "200", "300"]);
    expect(faceted.facets?.every((f) => f.series.length === 2)).toBe(true); // yKeys: [1, 2]

    // Every OTHER field is untouched by faceting -- `facets` is additive,
    // not a replacement for the rest of the wire shape.
    expect(faceted).toEqual({ ...flat, facets: faceted.facets });
  });

  // Fix-round C2: an excluded row must drop out of the exported facet
  // partition -- and, when it was that level's LAST row, the whole panel
  // must disappear too -- exactly like the screen's own facet grid
  // (`facetCompositionFromBinding`'s `analysisData`-pruned view). Before
  // this fix the export partitioned the RAW dataset, so an export could
  // contain excluded rows the screen never showed, or even carry an extra
  // panel for a level that's fully excluded on screen.
  it("partitions facets from the SAME row-excluded view the screen's facet grid uses", () => {
    const excludedDataset: Dataset = { ...dataset, id: "excluded", excludedRows: [0] }; // drops the row where signal=100
    const document = createFigureDocument({
      id: "excluded-facet", name: "Excluded", datasetId: excludedDataset.id, view: richView(), facetKey: 1,
    });

    const spec = buildFigureSpecFromDocument(document, excludedDataset, "excluded");

    // The screen's own facet grid for the IDENTICAL (dataset, facetKey,
    // xKey, yKeys) state -- the ground truth this export must never disagree
    // with.
    const view = richView();
    const screenComposition = facetCompositionFromBinding(excludedDataset, 1, view.xKey, view.yKeys);
    const screenLabels = facetPanelsOf(screenComposition)!.map((p) => p.label);

    expect(screenLabels).toEqual(["200", "300"]); // sanity: the exclusion actually dropped a level
    expect(spec.facets).toHaveLength(2);
    expect(spec.facets?.map((f) => f.label)).toEqual(screenLabels);
  });

  // Fix-round C5: mirrors the SCREEN's own fallback for the identical state
  // (`facetCompositionFromBinding` returns null when the facet column has no
  // finite levels, and `useEffectiveComposition` then renders the ordinary
  // flat plot) -- an export must never refuse outright for a state the
  // screen itself renders fine. Replaces the prior throw-test, which pinned
  // the OLD, reversed "fail loudly" behavior.
  it("falls back to the unfaceted spec when the facet column has no finite levels, mirroring the screen", () => {
    const allNonFinite: DataStruct = { ...data, values: data.values.map((row) => [NaN, ...row.slice(1)]) };
    const withFacet = createFigureDocument({
      id: "degenerate-facet", name: "Degenerate", datasetId: "degenerate", view: richView(), facetKey: 0,
    });
    const withoutFacet = createFigureDocument({
      id: "degenerate-facet", name: "Degenerate", datasetId: "degenerate", view: richView(),
    });
    const degenerateDataset: Dataset = { ...dataset, id: "degenerate", data: allNonFinite };

    const faceted = buildFigureSpecFromDocument(withFacet, degenerateDataset, "degenerate");
    const flat = buildFigureSpecFromDocument(withoutFacet, degenerateDataset, "degenerate");

    expect(faceted.facets).toBeUndefined();
    expect(faceted).toEqual(flat);
  });

  it("applies extra.transparent LAST, winning even on the fallback (no-document) path", () => {
    const spec = buildStageFigureSpec(fakeStage(), dataset, "device", opts, { transparent: true });
    expect(spec.transparent).toBe(true);
  });

  it("falls back to the legacy builder when no window is focused", () => {
    const spec = buildStageFigureSpec(fakeStage({ focusedWindowId: null }), dataset, "device", opts);
    expect(spec.group_col).toBeUndefined();
  });

  it('falls back to the legacy builder when the focused window is not kind:"plot"', () => {
    const spec = buildStageFigureSpec(
      fakeStage({ focusedWindowId: "snap1", windowsForSave: () => [{ id: "snap1", kind: "snapshot" }] }),
      dataset,
      "device",
      opts,
    );
    expect(spec.group_col).toBeUndefined();
  });

  it("falls back to the legacy builder when the focused plot window has no document yet", () => {
    const spec = buildStageFigureSpec(
      fakeStage({
        focusedWindowId: "w1",
        windowsForSave: () => [{ id: "w1", kind: "plot", document: undefined }],
      }),
      dataset,
      "device",
      opts,
    );
    expect(spec.group_col).toBeUndefined();
  });

  it("falls back to the legacy builder when the focused window's LIVE document is bound to a DIFFERENT dataset (the resolveDataset-race guard)", () => {
    // Reachable when the user refocuses to a different window/dataset WHILE
    // exportActive's async resolveDataset() for the ORIGINAL activeId is
    // still in flight — the module doc's third fallback bullet. Falling
    // back here keeps the export honest to `dataset` instead of throwing
    // (buildFigureSpecFromDocument rejects a mismatched live dataset
    // outright) or silently pairing a stranger's styling with this data.
    const document = createFigureDocument({
      id: "stage-window-3",
      name: "Stage window 3",
      datasetId: "other-dataset",
      view: richView(),
      groupKey: 0,
    });
    expect(() =>
      buildStageFigureSpec(
        fakeStage({ focusedWindowId: "w1", windowsForSave: () => [{ id: "w1", kind: "plot", document }] }),
        dataset,
        "device",
        opts,
      ),
    ).not.toThrow();
    const spec = buildStageFigureSpec(
      fakeStage({ focusedWindowId: "w1", windowsForSave: () => [{ id: "w1", kind: "plot", document }] }),
      dataset,
      "device",
      opts,
    );
    expect(spec.group_col).toBeUndefined();
  });

  it("routes a FROZEN focused document through the canonical builder even though its dataset binding does not match `ds` — frozen documents ignore the passed dataset by design", () => {
    const frozenSnapshot: DataStruct = {
      time: [9, 8],
      values: [[1], [2]],
      labels: ["frozen-only"],
      units: [""],
      metadata: {},
    };
    const document = createFigureDocument({
      id: "stage-window-frozen",
      name: "Stage window frozen",
      datasetId: null, // every real frozen document has no live dataset binding
      view: { ...defaultPlotView(), yKeys: [0] },
      data: { mode: "frozen", snapshot: frozenSnapshot },
    });
    const spec = buildStageFigureSpec(
      fakeStage({ focusedWindowId: "w1", windowsForSave: () => [{ id: "w1", kind: "plot", document }] }),
      dataset, // a real, unrelated active dataset — must be ignored, not matched
      "device",
      opts,
    );
    expect(spec.dataset).toEqual(frozenSnapshot);
  });

  it("surfaces the grouped+secondary-axis rejection as a thrown error, same as the direct adapter (exportActive's catch turns this into a toast/status, tested at the command level)", () => {
    const document = createFigureDocument({
      id: "stage-window-invalid",
      name: "Stage window invalid",
      datasetId: dataset.id,
      view: richView(), // richView() plots y2Keys: [2] — grouped + y2 is invalid
      groupKey: 0,
    });
    expect(() =>
      buildStageFigureSpec(
        fakeStage({ focusedWindowId: "w1", windowsForSave: () => [{ id: "w1", kind: "plot", document }] }),
        dataset,
        "device",
        opts,
      ),
    ).toThrow("grouped figures cannot use a secondary Y axis");
  });
});

// Export-fidelity gap (2026-08-11): `viewOverrides`' doc comment used to say
// "region/ref-line concepts remain unsupported here" — a PDF/SVG/PNG/
// clipboard export silently dropped Hc/Tc reference-line markers and
// Origin-decoded region shades that the screen showed. These tests exercise
// `viewOverrides` directly (it is a pure function of a PlotView-shaped
// object, no dataset/document machinery needed) for the new mapping's own
// contract; the byte-equality and toMatchObject tests above already cover
// it flowing through both the StoreGet and FigureDocument entry points.
describe("viewOverrides — reference lines and region shades", () => {
  it("closes the silent-drop gap: refLines/regionShades now reach the export overrides", () => {
    // Before this change, viewOverrides had NO mapping for either field —
    // ref_lines/region_shades would be absent from the result no matter
    // what the view carried. They must now be present and correctly shaped.
    const ov = viewOverrides({
      ...defaultPlotView(),
      refLines: [{ id: "r", axis: "x" as const, value: 3 }],
      regionShades: [{ id: "s", x1: 0, x2: 1, y1: 0, y2: 1, fill: "#112233" }],
    });
    expect(ov?.ref_lines).toEqual([{ axis: "x", value: 3 }]);
    expect(ov?.region_shades).toEqual([{ x1: 0, x2: 1, y1: 0, y2: 1, fill: "#112233" }]);
  });

  it("strips the screen-only id from both wire shapes", () => {
    const ov = viewOverrides({
      ...defaultPlotView(),
      refLines: [{ id: "should-not-appear", axis: "y" as const, value: 1 }],
      regionShades: [{ id: "also-not-appear", x1: 0, x2: 1, y1: 0, y2: 1, fill: "#abcdef" }],
    });
    expect(ov?.ref_lines?.[0]).not.toHaveProperty("id");
    expect(ov?.region_shades?.[0]).not.toHaveProperty("id");
  });

  it("filters non-finite ref line values and region shade coordinates", () => {
    const ov = viewOverrides({
      ...defaultPlotView(),
      refLines: [
        { id: "bad", axis: "x" as const, value: NaN },
        { id: "good", axis: "y" as const, value: 2 },
      ],
      regionShades: [
        { id: "bad", x1: Infinity, x2: 1, y1: 0, y2: 1, fill: "#112233" },
        { id: "good", x1: 0, x2: 1, y1: 0, y2: 1, fill: "#445566" },
      ],
    });
    expect(ov?.ref_lines).toEqual([{ axis: "y", value: 2 }]);
    expect(ov?.region_shades).toEqual([{ x1: 0, x2: 1, y1: 0, y2: 1, fill: "#445566" }]);
  });

  it("passes axis:1 through explicitly but omits axis:0/absent (both mean primary)", () => {
    const ov = viewOverrides({
      ...defaultPlotView(),
      regionShades: [
        { id: "primary-absent", x1: 0, x2: 1, y1: 0, y2: 1, fill: "#111111" },
        { id: "primary-explicit", x1: 0, x2: 1, y1: 0, y2: 1, fill: "#222222", axis: 0 as const },
        { id: "secondary", x1: 0, x2: 1, y1: 0, y2: 1, fill: "#333333", axis: 1 as const },
      ],
    });
    expect(ov?.region_shades).toEqual([
      { x1: 0, x2: 1, y1: 0, y2: 1, fill: "#111111" },
      { x1: 0, x2: 1, y1: 0, y2: 1, fill: "#222222" },
      { x1: 0, x2: 1, y1: 0, y2: 1, fill: "#333333", axis: 1 },
    ]);
  });

  it("omits both keys entirely when no ref lines or region shades are set", () => {
    const ov = viewOverrides(defaultPlotView());
    expect(ov?.ref_lines).toBeUndefined();
    expect(ov?.region_shades).toBeUndefined();
  });
});
