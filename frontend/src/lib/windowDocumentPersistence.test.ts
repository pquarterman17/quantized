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
      version: 2,
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
      'plot window "w1" uses unsupported FigureDocument version 2; restored its legacy PlotView projection',
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
});
