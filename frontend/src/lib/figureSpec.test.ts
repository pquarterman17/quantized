import { describe, expect, it } from "vitest";

import {
  buildFigureSpec,
  buildFigureSpecFromDocument,
  buildStageFigureSpec,
  resolveFigureDocumentData,
} from "./figureSpec";
import { viewOverrides } from "./figureViewOverrides";
import { facetPanelsOf } from "./composition";
import { createFigureDocument, figureDocumentToPlotView, updateFigureDocumentFromPlotView } from "./figureDocument";
import { facetCompositionFromBinding } from "./facet";
import { defaultPlotView } from "./plotview";
import { analysisData } from "./rowstate";
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

  // FIGURE_AUTHORING_WORKFLOW_PLAN: the flat (non-faceted) path's own,
  // separate row-exclusion gap -- explicitly left open when C2 fixed only
  // the facet path above ("a candidate for its own slice, not silently
  // inherited into facet's fix"). `buildFigureSpecForView` used to build the
  // wire `dataset` straight off the raw, row-unpruned `data`, so an excluded
  // row could reach a flat PNG/SVG/PDF/clipboard export the on-screen plot
  // never showed at all.
  describe("flat path: row exclusion / Data Filter pruning (the C2 note's own slice)", () => {
    it("prunes an excluded row from the exported dataset, matching the screen's analysisData view", () => {
      const excludedDataset: Dataset = { ...dataset, id: "flat-excluded", excludedRows: [0] }; // drops the row where signal=100
      const document = createFigureDocument({
        id: "flat-excluded-doc", name: "Flat excluded", datasetId: excludedDataset.id, view: richView(),
      });

      const spec = buildFigureSpecFromDocument(document, excludedDataset, "flat-excluded");

      expect(spec.facets).toBeUndefined(); // sanity: genuinely flat, not the facet path C2 already fixed

      // The screen's own analysis view for the IDENTICAL dataset -- the
      // ground truth this export must never disagree with.
      const screenView = analysisData(excludedDataset)!;
      expect(spec.dataset.time).toEqual([1, 2]); // sanity: the exclusion actually dropped a row
      expect(spec.dataset.time).toEqual(screenView.time);
      expect(spec.dataset.values).toEqual(screenView.values);
      expect(spec.dataset.metadata).toEqual(screenView.metadata);
    });

    it("prunes a Data-Filter-dropped row from the exported dataset, matching analysisData", () => {
      // Channel 1 ("signal") holds 100/200/300 -- a min:150 range filter
      // drops row 0 the same way an on-screen Data Filter card would.
      const filteredDataset: Dataset = {
        ...dataset,
        id: "flat-filtered",
        filter: [{ col: 1, kind: "range", min: 150 }],
      };
      const document = createFigureDocument({
        id: "flat-filtered-doc", name: "Flat filtered", datasetId: filteredDataset.id, view: richView(),
      });

      const spec = buildFigureSpecFromDocument(document, filteredDataset, "flat-filtered");

      const screenView = analysisData(filteredDataset)!;
      expect(spec.dataset.time).toEqual([1, 2]); // sanity: the filter actually dropped row 0
      expect(spec.dataset.time).toEqual(screenView.time);
      expect(spec.dataset.values).toEqual(screenView.values);
    });

    it("leaves a document-only (frozen) export's dataset untouched -- no live dataset to prune against", () => {
      const frozen = createFigureDocument({
        id: "flat-frozen", name: "Flat frozen", datasetId: null, view: defaultPlotView(),
        data: { mode: "frozen", snapshot: data },
      });
      // A dataset argument that WOULD prune a row if the frozen branch
      // consulted it -- proving it genuinely does not
      // (`resolveFigureDocumentData` never reads a frozen document's
      // `dataset` argument, and `buildFigureSpecFromDocument` nulls
      // `liveDataset` for `data.mode === "frozen"` regardless).
      const wouldPruneIfLive: Dataset = { ...dataset, id: "flat-frozen-live-lookalike", excludedRows: [0] };

      const spec = buildFigureSpecFromDocument(frozen, wouldPruneIfLive, "flat-frozen");

      expect(spec.dataset).toEqual(data); // byte-identical to the raw snapshot, every row present
    });

    // rowSidecars.ts (BUG-006): `text_columns`/`origin_text_columns` are
    // ROW-indexed -- a bar/box export resolving a category label by row
    // index must see the SAME row dropped from both the numeric columns and
    // the sidecar, or a label shifts onto a different row's cell than the
    // one it actually describes.
    it("keeps a row-indexed text-column sidecar aligned with its rows after pruning (bar/box category labels)", () => {
      const withTextColumn: DataStruct = {
        time: [0, 1, 2, 3],
        values: [[10], [20], [30], [40]],
        labels: ["signal"],
        units: [""],
        metadata: { text_columns: { category: ["A", "B", "C", "D"] } },
      };
      const sidecarDataset: Dataset = {
        id: "flat-sidecar", name: "sidecar.csv", data: withTextColumn, excludedRows: [1],
      };
      const document = createFigureDocument({
        id: "flat-sidecar-doc", name: "Flat sidecar", datasetId: sidecarDataset.id,
        view: { ...defaultPlotView(), yKeys: [0] },
      });

      const spec = buildFigureSpecFromDocument(document, sidecarDataset, "flat-sidecar");

      // Row 1 ("B") is dropped -- and its cell drops WITH it, not some
      // other row's.
      expect(spec.dataset.time).toEqual([0, 2, 3]);
      expect(spec.dataset.metadata.text_columns).toEqual({ category: ["A", "C", "D"] });
    });

    // The module doc for this line (`buildFigureSpecForView`, MAIN #36) claims
    // error_spans is "built from `wireDataset`, not the raw `data`, so a
    // pruned row's magnitude can never outnumber (and misalign with) the
    // pruned `dataset`/`y_keys` rows above" -- but nothing above exercises a
    // dataset with an ERROR BINDING *and* a pruned row together (the sidecar
    // case just above has no `errors` at all). Pin the claim directly: an
    // excluded row's uncertainty value must vanish from error_spans in the
    // same position it vanishes from `dataset`, not just leave the ARRAY
    // shorter by coincidence -- so this asserts the SURVIVING values, not
    // merely their count.
    it("prunes error_spans to match the pruned dataset, keeping row alignment (excluded row)", () => {
      const errData: DataStruct = {
        time: [0, 1, 2, 3],
        values: [[10, 1], [20, 2], [30, 3], [40, 4]],
        labels: ["signal", "sigma"],
        units: ["V", "V"],
        metadata: {},
      };
      // Row 1 (signal=20, sigma=2) is excluded -- surviving rows are 0, 2, 3.
      const excludedErrorDataset: Dataset = {
        id: "flat-error-excluded", name: "err.csv", data: errData, excludedRows: [1],
      };
      const document = createFigureDocument({
        id: "flat-error-excluded-doc",
        name: "Flat error excluded",
        datasetId: excludedErrorDataset.id,
        view: { ...defaultPlotView(), yKeys: [0] },
        // Channel 1 ("sigma") is a symmetric Y error for channel 0 ("signal").
        errors: [{ channel: 1, target: 0, axis: "y", side: "both" }],
      });

      const spec = buildFigureSpecFromDocument(document, excludedErrorDataset, "flat-error-excluded");

      expect(spec.dataset.time).toEqual([0, 2, 3]); // sanity: the exclusion actually dropped a row
      expect(spec.error_spans).toHaveLength(1); // one entry per plotted series (y_keys: [0])
      // The three SURVIVING sigma values (rows 0, 2, 3), in row order -- not
      // re-derived by calling exportErrorSpans/buildErrorSpans again (that
      // would only prove the helper agrees with itself), but the literal
      // numbers `errData` holds at the kept rows.
      expect(spec.error_spans?.[0]).toEqual({ y: { plus: [1, 3, 4], minus: [1, 3, 4] } });
    });

    it("prunes error_spans to match the pruned dataset, keeping row alignment (Data Filter)", () => {
      const errData: DataStruct = {
        time: [0, 1, 2, 3],
        values: [[10, 1], [20, 2], [30, 3], [40, 4]],
        labels: ["signal", "sigma"],
        units: ["V", "V"],
        metadata: {},
      };
      // Row 0 (signal=10 < 15) fails the filter -- surviving rows are 1, 2, 3.
      const filteredErrorDataset: Dataset = {
        id: "flat-error-filtered",
        name: "err.csv",
        data: errData,
        filter: [{ col: 0, kind: "range", min: 15 }],
      };
      const document = createFigureDocument({
        id: "flat-error-filtered-doc",
        name: "Flat error filtered",
        datasetId: filteredErrorDataset.id,
        view: { ...defaultPlotView(), yKeys: [0] },
        errors: [{ channel: 1, target: 0, axis: "y", side: "both" }],
      });

      const spec = buildFigureSpecFromDocument(document, filteredErrorDataset, "flat-error-filtered");

      expect(spec.dataset.time).toEqual([1, 2, 3]); // sanity: the filter actually dropped row 0
      expect(spec.error_spans).toHaveLength(1);
      // The three SURVIVING sigma values (rows 1, 2, 3), literal, same reason
      // as above.
      expect(spec.error_spans?.[0]).toEqual({ y: { plus: [2, 3, 4], minus: [2, 3, 4] } });
    });
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

  // Fix-round R4: the export used to throw "no visible series to export"
  // whenever every plotted channel was hidden, even for a FACETED view --
  // but the screen's own facet grid ignores hiddenChannels entirely (it
  // partitions st.xKey/st.yKeys directly, never the hidden-filtered
  // `plotted` list), so an all-hidden faceted view still renders fine on
  // screen. Only a genuinely empty (non-faceted, or degenerate-facet) view
  // has nothing left to export.
  it("does not throw for an all-hidden FACETED view, but still throws for an all-hidden flat view", () => {
    const allHidden = { ...richView(), hiddenChannels: [1, 2] }; // hides every yKey
    const faceted = createFigureDocument({
      id: "hidden-faceted", name: "Hidden faceted", datasetId: dataset.id, view: allHidden, facetKey: 1,
    });
    const flat = createFigureDocument({
      id: "hidden-flat", name: "Hidden flat", datasetId: dataset.id, view: allHidden,
    });

    const spec = buildFigureSpecFromDocument(faceted, dataset, "hidden-faceted");
    expect(spec.facets).toHaveLength(3);
    expect(spec.y_keys).toEqual([]); // the flat fields are still empty -- only the grid saves it

    expect(() => buildFigureSpecFromDocument(flat, dataset, "hidden-flat"))
      .toThrow("no visible series to export");
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

  // Fix-round R7: the live-view FALLBACK (no canonical document to route
  // through) reads the store's LIVE PlotView singleton -- a refocus-during-
  // async-export race (exportActive resolves `ds` before an awaited
  // resolve, during which the user can refocus a different window/dataset)
  // can leave `st.facetKey` belonging to a dataset other than `ds`. This
  // mirrors the pre-existing datasetId-mismatch guard the DOCUMENT-routing
  // branch already has (`canRouteThroughDocument`), applied to the fallback.
  it("omits facets on the fallback path when the store's active dataset doesn't match ds (refocus race)", () => {
    const spec = buildStageFigureSpec(
      fakeStage({ focusedWindowId: null, facetKey: 1, activeId: "some-other-dataset" }),
      dataset,
      "device",
      opts,
    );
    expect(spec.facets).toBeUndefined();
  });

  it("still facets on the fallback path when the store's active dataset matches ds", () => {
    const spec = buildStageFigureSpec(
      fakeStage({ focusedWindowId: null, facetKey: 1, activeId: dataset.id }),
      dataset,
      "device",
      opts,
    );
    expect(spec.facets).toHaveLength(3);
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

// ── P3.3 auto dash/marker cycle: the EXPORT side, end to end ────────────────
// `exportStyles.test.ts` pins the resolver and the canvas/export agreement on
// synthetic position lists. This block pins the thing those lists are supposed
// to be — what the real builder derives from a real view — plus the two gates
// that decide whether the cycle happens at all:
//
//   * WHICH VIEWS. A grouped, faceted or stacked view is refused, because the
//     render route ignores `series_styles` for the first two and renders one
//     panel for the third, while the screen splits into several.
//   * WHICH CALLERS. Only `buildStageFigureSpec` — the export the live Stage
//     canvas produces — opts in. A document rendered from a Figure Page panel
//     or the Figure Builder is uncycled, which is what makes a SAVED document
//     independent of whoever's preference is on when it is reopened.
describe("auto dash/marker cycle — figure requests (P3.3)", () => {
  const opts = { fmt: "pdf", style: "default", dpi: 300, title: "", xLabel: "", yLabel: "" };
  /** yKeys chosen so display order is [1, 2, 3] with nothing hidden. */
  const cycleView = (over: Record<string, unknown> = {}) => ({
    ...defaultPlotView(),
    xKey: 0,
    yKeys: [1, 2, 3],
    ...over,
  });
  const stageGet = (over: Record<string, unknown> = {}) =>
    (() => ({
      ...cycleView(),
      autoSeriesStyles: true,
      focusedWindowId: null,
      windowsForSave: () => [],
      ...over,
    })) as never;
  const lines = (spec: ReturnType<typeof buildFigureSpec>) =>
    (spec.series_styles ?? []).map((s) => s?.line);

  it("OFF: the request carries no line at all — byte-identical to before", () => {
    const spec = buildStageFigureSpec(stageGet({ autoSeriesStyles: false }), dataset, "d", opts);
    expect(lines(spec)).toEqual([undefined, undefined, undefined]);
  });

  it("ON: the Stage export cycles the plotted series by display position", () => {
    const spec = buildStageFigureSpec(stageGet(), dataset, "d", opts);
    expect(spec.y_keys).toEqual([1, 2, 3]);
    expect(lines(spec)).toEqual(["solid", "dashed", "dotted"]);
  });

  it("ON: a HIDDEN channel does not renumber the survivors (finding 2)", () => {
    // Channel 2 sits at display position 1 and the canvas keeps it there with
    // `show:false`. Dropping it from the request must leave channel 3 on
    // position 2 — DOTTED — not slide it up into position 1's dashed.
    const spec = buildStageFigureSpec(stageGet({ hiddenChannels: [2] }), dataset, "d", opts);
    expect(spec.y_keys).toEqual([1, 3]);
    expect(lines(spec)).toEqual(["solid", "dotted"]);
  });

  it("ON: a reordered legend follows seriesOrder, not channel number", () => {
    const spec = buildStageFigureSpec(stageGet({ seriesOrder: [3, 1, 2] }), dataset, "d", opts);
    expect(spec.y_keys).toEqual([3, 1, 2]);
    expect(lines(spec)).toEqual(["solid", "dashed", "dotted"]);
  });

  it("ON: an explicit per-series line still wins", () => {
    const spec = buildStageFigureSpec(
      stageGet({ seriesStyles: { 2: { line: "solid" as const } } }),
      dataset,
      "d",
      opts,
    );
    expect(lines(spec)).toEqual(["solid", "solid", "dotted"]);
  });

  // ── The views that must NOT cycle, on either side ─────────────────────────
  it("ON: a GROUPED view is refused — the renderer ignores series_styles there", () => {
    const document = createFigureDocument({
      id: "grouped",
      name: "Grouped",
      datasetId: dataset.id,
      view: cycleView(),
      groupKey: 0,
    });
    const spec = buildStageFigureSpec(
      stageGet({
        groupKey: 0,
        focusedWindowId: "w",
        windowsForSave: () => [{ id: "w", kind: "plot", document }],
      }),
      dataset,
      "d",
      opts,
    );
    expect(spec.group_col).toBe(0);
    expect(lines(spec)).toEqual([undefined, undefined, undefined]);
  });

  it("ON: a FACETED view is refused — facets make series_styles unused", () => {
    const spec = buildStageFigureSpec(stageGet({ facetKey: 0 }), dataset, "d", opts);
    expect(lines(spec)).toEqual([undefined, undefined, undefined]);
  });

  it("ON: a STACKED view is refused — the screen shows panels the figure does not", () => {
    const spec = buildStageFigureSpec(stageGet({ stackMode: true }), dataset, "d", opts);
    expect(lines(spec)).toEqual([undefined, undefined, undefined]);
  });

  // ── Saved documents: the cycle is never baked in (finding 10) ─────────────
  describe("a saved FigureDocument is independent of the preference", () => {
    const document = () =>
      createFigureDocument({
        id: "doc",
        name: "Doc",
        datasetId: dataset.id,
        view: cycleView(),
      });

    it("renders uncycled from every non-Stage caller, whatever the preference is", () => {
      // The Figure Page panel / Figure Builder preview / previewExport path.
      // They pass no `autoSeriesStyles`, so they cannot cycle even while the
      // live preference is on — and the document beside them has no uPlot
      // canvas of its own to disagree with.
      expect(lines(buildFigureSpecFromDocument(document(), dataset, "doc"))).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    });

    it("authored with the preference ON, reopened with it OFF, renders the same", () => {
      const authored = document();
      // Authoring does not touch publication.seriesStyles: the cycle is applied
      // at export-build time, never persisted. That is the whole fix — a doc
      // whose stored styles carried a cycled `line` would export dashed on a
      // colleague's machine while their canvas drew solid.
      expect(authored.publication?.seriesStyles).toBeUndefined();
      const onSpec = buildFigureSpecFromDocument(authored, dataset, "doc", { autoSeriesStyles: true });
      const offSpec = buildFigureSpecFromDocument(authored, dataset, "doc", { autoSeriesStyles: false });
      expect(lines(onSpec)).toEqual(["solid", "dashed", "dotted"]);
      expect(lines(offSpec)).toEqual([undefined, undefined, undefined]);
      // Neither render mutated the document.
      expect(authored.publication?.seriesStyles).toBeUndefined();
      // And the default — every caller that is not the live Stage — is OFF.
      expect(buildFigureSpecFromDocument(authored, dataset, "doc")).toEqual(offSpec);
    });

    // `buildStageFigureSpec` gates on the LIVE view, but the document it routes
    // through carries its OWN copy of that view, and only the second gate —
    // inside `buildFigureSpecForView` — sees the view actually being rendered.
    // Driven through `buildFigureSpecFromDocument` so the live gate is bypassed
    // and the inner one is the only thing under test.
    it.each([
      // groupKey/facetKey are BINDINGS on a FigureDocument, not view fields
      // (`figureDocument.ts`'s `FigureViewState` omits them); stackMode is a
      // view field. Both spellings have to reach the gate.
      ["grouped", { groupKey: 0 }, {}],
      ["faceted", { facetKey: 0 }, {}],
      ["stacked", {}, { stackMode: true }],
    ])("refuses the cycle for a %s DOCUMENT view, even when asked for it", (_name, bindings, view) => {
      const doc = createFigureDocument({
        id: "doc3",
        name: "Doc3",
        datasetId: dataset.id,
        view: cycleView(view),
        ...bindings,
      });
      const spec = buildFigureSpecFromDocument(doc, dataset, "doc3", { autoSeriesStyles: true });
      expect(lines(spec)).toEqual([undefined, undefined, undefined]);
    });

    it("an EXACT publication style array stays exact — the cycle never edits it", () => {
      const pinned = createFigureDocument({
        id: "doc2",
        name: "Doc2",
        datasetId: dataset.id,
        view: cycleView(),
        publication: { overrides: null, seriesStyles: [{ color: "#3366cc" }, null, null] },
      });
      const spec = buildFigureSpecFromDocument(pinned, dataset, "doc2", { autoSeriesStyles: true });
      expect(spec.series_styles).toEqual([{ color: "#3366cc" }, null, null]);
    });
  });
});
