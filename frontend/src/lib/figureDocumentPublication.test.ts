import { describe, expect, it } from "vitest";

import { patchRefLineList } from "../components/workshops/figurebuilder/canonicalRefLines";
import { patchShapeList } from "../components/workshops/figurebuilder/canonicalShapes";
import type { ErrorBinding } from "./errorRoles";
import { figureDocumentToPlotView, updateFigureDocumentFromPlotView } from "./figureDocument";
import { figureDocumentFromLegacyFigureDoc } from "./figureDocumentPublication";
import { buildFigureSpecFromDocument } from "./figureSpec";
import type { FigureDoc } from "./figuredoc";
import type { Dataset, DataStruct } from "./types";

const snapshot: DataStruct = {
  time: [0, 1], values: [[1], [2]], labels: ["signal"], units: ["V"], metadata: {},
};

const dataset: Dataset = {
  id: "d1",
  name: "device.csv",
  data: {
    time: [0, 1, 2],
    values: [[0, 1], [1, 2], [2, 3]],
    labels: ["x", "signal"],
    units: ["", "V"],
    metadata: {},
  },
};

const legacy = (overrides: Partial<FigureDoc> = {}): FigureDoc => ({
  id: "legacy-1",
  name: "Legacy preview",
  datasetId: "d1",
  live: true,
  config: {
    xKey: 0, yKeys: [1], groupCol: 2, xScale: "log", yScale: "linear",
    title: "Legacy title", xLabel: "X", yLabel: "Y", style: "nature", fmt: "svg", dpi: 600,
    overrides: {
      font_name: "Helvetica", font_size: 9, ticks: { dir: "in", len: 5 }, margins: { left: 0.12 },
      annotations: [{ x: 1, y: 2, text: "note" }],
    },
    seriesStyles: [{ color: "#123456", line: "none", marker: true, marker_size: 5 }],
  },
  ...overrides,
});

describe("legacy Publication Preview -> FigureDocument adapter", () => {
  it("converts a live document losslessly without mutating its legacy source", () => {
    const source = legacy();
    const before = structuredClone(source);
    const document = figureDocumentFromLegacyFigureDoc(source);

    expect(document).toMatchObject({
      version: 2, id: "legacy-1", name: "Legacy preview",
      bindings: { datasetId: "d1", xKey: 0, yKeys: [1], groupKey: 2 },
      data: { mode: "live" },
      plot: { view: { xScale: "log", plotTitle: "Legacy title", xAxisLabel: "X", yAxisLabel: "Y" } },
      output: { stylePreset: "nature", format: "svg", dpi: 600 },
      publication: { overrides: source.config.overrides, seriesStyles: source.config.seriesStyles },
    });
    document.publication!.overrides!.margins!.left = 0.8;
    expect(source).toEqual(before);
  });

  // #51 phase 3: the Graph Builder's error wells ride FigureConfig.errors,
  // independent of Dataset.errorRoles (the wells may not be committed yet).
  it("threads config.errors into bindings.errors", () => {
    const errors: ErrorBinding[] = [{ channel: 3, target: 1, axis: "y", side: "both" }];
    const source = legacy({ config: { ...legacy().config, errors } });
    const document = figureDocumentFromLegacyFigureDoc(source);
    expect(document.bindings.errors).toEqual(errors);
  });

  it("falls back to the legacy errKeys default when config.errors is absent (unchanged)", () => {
    const document = figureDocumentFromLegacyFigureDoc(legacy());
    expect(document.bindings.errors).toEqual([]);
  });

  it("retains frozen data and rejects an invalid frozen legacy source clearly", () => {
    const frozen = figureDocumentFromLegacyFigureDoc(legacy({ live: false, datasetId: "stale-id", dataSnapshot: snapshot }));
    expect(frozen.data).toEqual({ mode: "frozen", snapshot });
    expect(frozen.bindings.datasetId).toBeNull();
    expect(() => figureDocumentFromLegacyFigureDoc(legacy({ live: false, dataSnapshot: undefined })))
      .toThrow('frozen legacy FigureDoc "legacy-1" has no data snapshot');
  });

  // F2.1i: config.overrides.shapes/.ref_lines used to copy RAW into
  // publication.overrides -- still rendered (publication wins the export
  // merge) but invisible/un-editable in the Shapes (F2.3c) and
  // Reference-lines (F2.3d) panels, which read plot.view directly. Promotion
  // now decomposes them into the view and strips them from the override bag.
  describe("decomposing promoted shapes/ref_lines into the view", () => {
    const decoratedLegacy = (): FigureDoc => ({
      id: "legacy-decor",
      name: "Decorated legacy preview",
      datasetId: "d1",
      live: true,
      config: {
        xKey: 0, yKeys: [1], xScale: "linear", yScale: "linear",
        title: "T", xLabel: "X", yLabel: "Y", style: "default", fmt: "pdf", dpi: 300,
        overrides: {
          font_size: 9,
          shapes: [
            { kind: "line", x1: 0, y1: 0, x2: 1, y2: 1, stroke: "#f00" },
            { kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#00f" },
          ],
          ref_lines: [
            { axis: "x", value: 5 },
            { axis: "y", value: -2 },
          ],
          // region_shades has no view editor anywhere yet -- must stay raw.
          region_shades: [{ x1: 0, x2: 1, y1: 0, y2: 1, fill: "#336699" }],
        },
        seriesStyles: [{ color: "#123456", line: "none", marker: true, marker_size: 5 }],
      },
    });

    it("mints deterministic view ids and carries every wire field across", () => {
      const document = figureDocumentFromLegacyFigureDoc(decoratedLegacy());
      expect(document.plot.view.shapes).toEqual([
        { id: "legacyshape-legacy-decor-0", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1, stroke: "#f00" },
        { id: "legacyshape-legacy-decor-1", kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#00f" },
      ]);
      expect(document.plot.view.refLines).toEqual([
        { id: "legacyref-legacy-decor-0", axis: "x", value: 5 },
        { id: "legacyref-legacy-decor-1", axis: "y", value: -2 },
      ]);
    });

    it("strips shapes/ref_lines from publication.overrides but leaves every other field -- including region_shades -- raw", () => {
      const document = figureDocumentFromLegacyFigureDoc(decoratedLegacy());
      expect(document.publication?.overrides).toEqual({
        font_size: 9,
        region_shades: [{ x1: 0, x2: 1, y1: 0, y2: 1, fill: "#336699" }],
      });
    });

    it("mints the SAME ids re-promoting the SAME legacy doc, so a second open never collides with the first", () => {
      const first = figureDocumentFromLegacyFigureDoc(decoratedLegacy());
      const second = figureDocumentFromLegacyFigureDoc(decoratedLegacy());
      expect(second.plot.view.shapes).toEqual(first.plot.view.shapes);
      expect(second.plot.view.refLines).toEqual(first.plot.view.refLines);
    });

    it("renders the shape and reference line exactly once, matching the pre-promotion wire values", () => {
      const document = figureDocumentFromLegacyFigureDoc(decoratedLegacy());
      const spec = buildFigureSpecFromDocument(document, dataset, "decorated");
      expect(spec.overrides?.shapes).toEqual([
        { kind: "line", x1: 0, y1: 0, x2: 1, y2: 1, stroke: "#f00" },
        { kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#00f" },
      ]);
      expect(spec.overrides?.ref_lines).toEqual([
        { axis: "x", value: 5 },
        { axis: "y", value: -2 },
      ]);
      // region_shades still renders too -- it was never double-counted, only
      // ever carried in publication.overrides.
      expect(spec.overrides?.region_shades).toEqual([{ x1: 0, x2: 1, y1: 0, y2: 1, fill: "#336699" }]);
    });

    it("edits a decomposed shape and reference line through the SAME patch path the Shapes/Reference-lines panels use, and the edit round-trips", () => {
      const document = figureDocumentFromLegacyFigureDoc(decoratedLegacy());
      const view = figureDocumentToPlotView(document);
      const editedShapes = patchShapeList(view.shapes, "legacyshape-legacy-decor-0", { stroke: "#0f0" });
      const editedRefLines = patchRefLineList(view.refLines, "legacyref-legacy-decor-0", { value: 42 });
      const edited = updateFigureDocumentFromPlotView(document, {
        view: { ...view, shapes: editedShapes, refLines: editedRefLines },
      });

      expect(edited.plot.view.shapes[0]).toMatchObject({ id: "legacyshape-legacy-decor-0", stroke: "#0f0" });
      expect(edited.plot.view.refLines[0]).toMatchObject({ id: "legacyref-legacy-decor-0", value: 42 });
      // The edit landed in the view, not a resurrected override entry.
      expect(edited.publication?.overrides).not.toHaveProperty("shapes");
      expect(edited.publication?.overrides).not.toHaveProperty("ref_lines");
      const spec = buildFigureSpecFromDocument(edited, dataset, "edited");
      expect(spec.overrides?.shapes?.[0]).toMatchObject({ stroke: "#0f0" });
      expect(spec.overrides?.ref_lines?.[0]).toMatchObject({ value: 42 });
    });

    // seriesStyles investigated (F2.1i) and deliberately left as an exact,
    // un-decomposed array -- see figureDocumentPublication.ts's own doc for
    // why (a scatter-mark entry's `line: "none"` has no valid `SeriesStyle`
    // counterpart). It still renders (publication.seriesStyles wins the
    // export merge) but the Series (F2.3b) panel -- which reads
    // plot.view.seriesStyles, a channel-keyed record -- starts empty. That
    // gap pre-dates this change and is not introduced by it.
    it("leaves seriesStyles a raw exact array and does not populate plot.view.seriesStyles", () => {
      const source = decoratedLegacy();
      const document = figureDocumentFromLegacyFigureDoc(source);
      expect(document.publication?.seriesStyles).toEqual(source.config.seriesStyles);
      expect(document.plot.view.seriesStyles).toEqual({});
    });
  });
});
