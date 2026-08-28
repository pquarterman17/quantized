import { describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import { defaultPlotView, type PlotWindow } from "./plotview";
import { sanitizeDocumentBackedPlotWindows } from "./windowDocumentPersistence";

const window = (over: Partial<PlotWindow> = {}): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "Legacy",
  datasetId: "d1",
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z: 0,
  winState: "normal",
  view: { ...defaultPlotView(), plotTitle: "legacy title", errKeys: { 1: 2 } },
  bg: "theme",
  linkGroup: null,
  pinned: false,
  ...over,
});

describe("document-backed plot-window persistence", () => {
  it("promotes a legacy PlotView-only window deterministically", () => {
    const [restored] = sanitizeDocumentBackedPlotWindows([window()], new Set(["d1"]));

    expect(restored.document).toMatchObject({
      id: "figure-w1",
      name: "Legacy",
      bindings: { datasetId: "d1", errors: [{ target: 1, channel: 2, axis: "y", side: "both" }] },
      plot: { view: { plotTitle: "legacy title" } },
    });
  });

  it("P1.5: a legacy PlotView-only window's own groupKey survives the migration to a document", () => {
    // RED before this fix: migrateLegacyWindow's createFigureDocument call
    // never threaded `view.groupKey` through -- a P1.5 grouped window with
    // no `document` yet (any window saved before this field existed, or a
    // fresh window this same session set groupKey on but hasn't otherwise
    // touched) silently lost its group binding on the very next promotion.
    const [restored] = sanitizeDocumentBackedPlotWindows(
      [window({ view: { ...defaultPlotView(), groupKey: 2 } })],
      new Set(["d1"]),
    );
    expect(restored.document?.bindings.groupKey).toBe(2);
    expect(restored.view.groupKey).toBe(2);
  });

  // F6 (SILENT_STATE_CORRUPTION_PLAN): migrateLegacyWindow threads groupKey
  // (P1.5, above) but not facetKey, which joined the same bindings-owned
  // class in F4.4 -- a faceted grid silently collapses to one panel on
  // whichever legacy-promotion path this function serves.
  it("F6: a legacy PlotView-only window's own facetKey survives the migration (future-version path)", () => {
    const future = {
      ...createFigureDocument({ id: "future", name: "Future", datasetId: "d1", view: defaultPlotView() }),
      version: 3,
    };
    const [restored] = sanitizeDocumentBackedPlotWindows(
      [{ ...window({ view: { ...defaultPlotView(), groupKey: 2, facetKey: 4 } }), document: future }],
      new Set(["d1"]),
    );
    expect(restored.document?.bindings.groupKey).toBe(2);
    expect(restored.document?.bindings.facetKey).toBe(4);
    expect(restored.view.facetKey).toBe(4);
  });

  it("F6: a window whose document fails validation keeps its facetKey the same way", () => {
    const [restored] = sanitizeDocumentBackedPlotWindows(
      [
        {
          ...window({ view: { ...defaultPlotView(), groupKey: 2, facetKey: 4 } }),
          document: { not: "a figure document" },
        },
      ],
      new Set(["d1"]),
    );
    expect(restored.document?.bindings.groupKey).toBe(2);
    expect(restored.document?.bindings.facetKey).toBe(4);
    expect(restored.view.facetKey).toBe(4);
  });

  it("treats a valid document as authoritative over stale compatibility fields", () => {
    const document = createFigureDocument({
      id: "figure-stable",
      name: "Canonical",
      datasetId: "d1",
      view: { ...defaultPlotView(), plotTitle: "canonical title" },
    });
    const [restored] = sanitizeDocumentBackedPlotWindows([
      window({ title: "stale", datasetId: null, view: defaultPlotView(), document }),
    ], new Set(["d1"]));

    expect(restored.title).toBe("Canonical");
    expect(restored.datasetId).toBe("d1");
    expect(restored.view.plotTitle).toBe("canonical title");
    expect(restored.document).toEqual(document);
  });

  it("clamps missing dataset bindings without discarding the document", () => {
    const document = createFigureDocument({
      id: "figure-missing",
      name: "Disconnected",
      datasetId: "network-dataset",
      view: defaultPlotView(),
    });
    const [restored] = sanitizeDocumentBackedPlotWindows([window({ document })], new Set());

    expect(restored.datasetId).toBeNull();
    expect(restored.document?.bindings.datasetId).toBeNull();
    expect(restored.document?.id).toBe("figure-missing");
  });

  it("isolates a future document version and promotes only that window's legacy projection", () => {
    const future = {
      ...createFigureDocument({
        id: "future",
        name: "Future",
        datasetId: "d1",
        view: defaultPlotView(),
      }),
      version: 3,
    };

    const warnings: string[] = [];
    const restored = sanitizeDocumentBackedPlotWindows([
      { ...window(), document: future },
      window({ id: "w2", title: "Valid", document: createFigureDocument({
        id: "valid", name: "Valid", datasetId: "d1", view: defaultPlotView(),
      }) }),
    ], new Set(["d1"]), warnings);

    expect(restored.map((entry) => entry.document?.id)).toEqual(["figure-w1", "valid"]);
    expect(restored[0].view.plotTitle).toBe("legacy title");
    expect(warnings).toEqual([
      'plot window "w1" uses unsupported FigureDocument version 3; restored its legacy PlotView projection',
    ]);
  });

  it("repairs duplicate document identities deterministically", () => {
    const document = createFigureDocument({
      id: "duplicate",
      name: "Plot",
      datasetId: "d1",
      view: defaultPlotView(),
    });
    const restored = sanitizeDocumentBackedPlotWindows([
      window({ id: "w1", document }),
      window({ id: "w2", document }),
    ], new Set(["d1"]));

    expect(restored.map((candidate) => candidate.document?.id)).toEqual(["duplicate", "figure-w2"]);
  });

  // Item 2 (data loss): windowDocuments.ts's createPlotWindowDocument (the
  // sibling FigureDocument constructor used for duplicate/create) forwards
  // `publication: previous?.publication` -- this repair path minted its
  // createFigureDocument call without it, so a document carrying export
  // overrides or exact per-channel seriesStyles silently lost them on
  // reopening a workspace with two windows sharing one document id.
  it("keeps publication (export overrides + seriesStyles) through the duplicate-id repair, on BOTH windows", () => {
    const document = {
      ...createFigureDocument({
        id: "duplicate",
        name: "Plot",
        datasetId: "d1",
        view: defaultPlotView(),
      }),
      publication: { overrides: { grid: false }, seriesStyles: null },
    };
    const restored = sanitizeDocumentBackedPlotWindows([
      window({ id: "w1", document }),
      window({ id: "w2", document }),
    ], new Set(["d1"]));

    expect(restored.map((candidate) => candidate.document?.id)).toEqual(["duplicate", "figure-w2"]);
    expect(restored[0].document?.publication).toEqual({ overrides: { grid: false }, seriesStyles: null });
    expect(restored[1].document?.publication).toEqual({ overrides: { grid: false }, seriesStyles: null });
  });
});
