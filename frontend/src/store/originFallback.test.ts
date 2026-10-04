import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Dataset, OriginFigure } from "../lib/types";
import { loadOriginApplyLibs } from "./originApplyLibs";
import { commitOriginSourceMapping } from "./originFallback";
import { useApp } from "./useApp";

const book: Dataset = {
  id: "d1",
  name: "Project:Book1",
  data: {
    time: [1, 2], values: [[10], [20]], labels: ["signal"], units: [""],
    metadata: { origin_book: "Book1", x_column_name: "A", origin_column_names: ["B"] },
  },
};
const figure: OriginFigure = {
  name: "Graph1", x_from: 0, x_to: 2, x_log: false,
  y_from: 0, y_to: 20, y_log: false, n_curves: 1, annotations: [],
  curves: [{ book: "Book1", x: "A", y: "B", style: "line" }],
};


// The Origin-apply half of the figure library is a lazy chunk (bundle
// headroom slice 1). Load it once up front so the specs below exercise the
// WARM path — `applyOriginFigure` synchronous, exactly as it behaves for
// every apply after a session's first. The cold path (deferred first apply,
// latest-request-wins, chunk-load failure) has its own dedicated coverage in
// store/originApplyLibs.test.ts; without this warm-up the cold path would
// leak into these specs as an order-dependent failure of whichever apply
// test happens to run first.
beforeAll(async () => {
  await loadOriginApplyLibs();
});

beforeEach(() => {
  useApp.setState({
    datasets: [book], activeId: null, worksheetId: null,
    originFigures: [{ id: "f1", stem: "Project", figure, datasetId: "d1", siblingIds: ["d1"] }],
    originWorksheetSeed: null, graphBuilderSeed: null, graphBuilderOpen: false,
    stageTab: "plot",
  });
});

describe("Origin figure fallbacks", () => {
  it("opens the exact workbook and hands its bound columns to the worksheet", async () => {
    await useApp.getState().openOriginFigureSource("f1");
    expect(useApp.getState()).toMatchObject({
      worksheetId: "d1",
      stageTab: "worksheet",
      originWorksheetSeed: { datasetId: "d1", columns: [-1, 0] },
    });
  });

  it("uses raw letters against a workbook only when the manual picker authorizes it", async () => {
    useApp.setState({
      originFigures: [{
        id: "manual", stem: "Project", datasetId: null, siblingIds: ["d1"],
        figure: { ...figure, curves: [{ book: "MissingBook", x: "A", y: "B" }] },
      }],
    });
    await useApp.getState().openOriginFigureSource("manual", "d1", { manual: true });
    expect(useApp.getState().originWorksheetSeed).toEqual({ datasetId: "d1", columns: [-1, 0] });
  });

  it("lets an unresolved graph seed Graph Builder from an explicitly chosen compatible workbook", async () => {
    useApp.setState({
      originFigures: [{
        id: "manual", stem: "Project", datasetId: null, siblingIds: ["d1"],
        figure: { ...figure, curves: [{ book: "MissingBook", x: "A", y: "B", style: "line" }] },
      }],
    });

    await useApp.getState().remakeOriginFigure("manual", "d1");

    expect(useApp.getState()).toMatchObject({
      activeId: "d1",
      graphBuilderOpen: true,
      graphBuilderSeed: {
        version: 1,
        zones: {
          x: null,
          y: [{ datasetId: "d1", channel: 0 }],
          group: null,
          facet: null,
          yErr: [],
          xErr: null,
        },
        mark: "line",
      },
    });
  });

  it("commits a previewed source mapping atomically and applies the mapped figure", async () => {
    useApp.setState({
      originFigures: [{
        id: "mapped", stem: "Project", datasetId: null, siblingIds: ["d1"],
        figure: { ...figure, curves: [{ book: "MissingBook", x: "A", y: "B", style: "line" }] },
      }],
      history: [], future: [],
    });

    await expect(commitOriginSourceMapping(useApp.setState, useApp.getState, "MissingBook", "d1", ["mapped"])).resolves.toBe(true);
    expect(useApp.getState().originFigures[0]).toMatchObject({
      datasetId: null, sourceOverrides: { MissingBook: "d1" },
    });
    expect(useApp.getState().history.at(-1)?.label).toBe("resolve Origin source");

    useApp.getState().undo();
    expect(useApp.getState().originFigures[0].datasetId).toBeNull();
    expect(useApp.getState().originFigures[0].sourceOverrides).toBeUndefined();
    useApp.getState().redo();
    expect(useApp.getState().originFigures[0].sourceOverrides).toEqual({ MissingBook: "d1" });

    useApp.getState().applyOriginFigure("mapped");
    expect(useApp.getState()).toMatchObject({ activeId: "d1", yKeys: [0], stageTab: "plot" });
  });

  it("does not apply a persisted mapping after its target loses Origin provenance", () => {
    const ordinary = { ...book, data: { ...book.data, metadata: {} } };
    useApp.setState({
      datasets: [ordinary],
      activeId: null,
      originFigures: [{
        id: "stale-mapping", stem: "Project", datasetId: null, siblingIds: ["d1"],
        sourceOverrides: { MissingBook: "d1" },
        figure: { ...figure, curves: [{ book: "MissingBook", x: "A", y: "B" }] },
      }],
      history: [], future: [],
    });

    useApp.getState().applyOriginFigure("stale-mapping");

    expect(useApp.getState().activeId).toBeNull();
    expect(useApp.getState().history).toEqual([]);
  });

  it("does not apply or create history after a mapped worksheet loses a required column", () => {
    useApp.setState({
      activeId: null,
      originFigures: [{
        id: "stale-columns", stem: "Project", datasetId: null, siblingIds: ["d1"],
        sourceOverrides: { MissingBook: "d1" },
        figure: { ...figure, curves: [{ book: "MissingBook", x: "A", y: "Gone" }] },
      }],
      history: [], future: [],
    });

    useApp.getState().applyOriginFigure("stale-columns");

    expect(useApp.getState().activeId).toBeNull();
    expect(useApp.getState().history).toEqual([]);
  });

  it("revalidates bulk scope and leaves state untouched when one requested layer is incompatible", async () => {
    useApp.setState({
      originFigures: [
        { id: "good", stem: "Project", datasetId: null, siblingIds: ["d1"], figure: { ...figure, curves: [{ book: "MissingBook", x: "A", y: "B" }] } },
        { id: "bad", stem: "Project", datasetId: null, siblingIds: ["d1"], figure: { ...figure, curves: [{ book: "MissingBook", x: "A", y: "Z" }] } },
      ],
      history: [], future: [],
    });
    const before = useApp.getState().originFigures;
    await expect(commitOriginSourceMapping(useApp.setState, useApp.getState, "MissingBook", "d1", ["good", "bad"])).resolves.toBe(false);
    expect(useApp.getState().originFigures).toBe(before);
    expect(useApp.getState().history).toEqual([]);
  });

  it("refuses a stale preview when another matching layer entered the import scope", async () => {
    useApp.setState({
      originFigures: [
        { id: "previewed", stem: "Project", datasetId: null, siblingIds: ["d1"], figure: { ...figure, curves: [{ book: "MissingBook", x: "A", y: "B" }] } },
        { id: "added-later", stem: "Project", datasetId: null, siblingIds: ["d1"], figure: { ...figure, curves: [{ book: "MissingBook", x: "A", y: "B" }] } },
      ],
      history: [], future: [],
    });
    const before = useApp.getState().originFigures;

    await expect(commitOriginSourceMapping(useApp.setState, useApp.getState, "MissingBook", "d1", ["previewed"])).resolves.toBe(false);

    expect(useApp.getState().originFigures).toBe(before);
    expect(useApp.getState().history).toEqual([]);
  });

  it("refuses manual recovery from a workbook outside the same Origin import", async () => {
    useApp.setState({
      datasets: [book, { ...book, id: "foreign", name: "foreign" }],
      originFigures: [{
        id: "manual", stem: "Project", datasetId: null, siblingIds: ["d1"],
        figure: { ...figure, curves: [{ book: "MissingBook", x: "A", y: "B", style: "line" }] },
      }],
    });

    await expect(useApp.getState().openOriginFigureSource("manual", "foreign", { manual: true })).resolves.toBe(false);
    expect(useApp.getState().originWorksheetSeed).toBeNull();
  });

  it("seeds Graph Builder with the exact decoded X/Y binding", async () => {
    await useApp.getState().remakeOriginFigure("f1");
    expect(useApp.getState().graphBuilderOpen).toBe(true);
    expect(useApp.getState().graphBuilderSeed).toEqual({
      version: 1,
      zones: {
        x: null,
        y: [{ datasetId: "d1", channel: 0 }],
        group: null,
        facet: null,
        yErr: [],
        xErr: null,
      },
      mark: "line",
    });
  });

  it("materializes and seeds the existing provenance-stamped overlay for cross-book curves", async () => {
    const book2: Dataset = {
      ...book,
      id: "d2",
      name: "Project:Book2",
      data: { ...book.data, metadata: { ...book.data.metadata, origin_book: "Book2" } },
    };
    const cross: OriginFigure = {
      ...figure,
      n_curves: 2,
      curves: [
        { book: "Book1", x: "A", y: "B", style: "line" },
        { book: "Book2", x: "A", y: "B", style: "line" },
      ],
    };
    useApp.setState({
      datasets: [book, book2],
      originFigures: [{ id: "cross", stem: "Project", figure: cross, datasetId: "d1", siblingIds: ["d1", "d2"] }],
    });
    await useApp.getState().remakeOriginFigure("cross");
    const state = useApp.getState();
    const overlay = state.datasets.find((ds) => ds.data.metadata?.origin_overlay_source === "cross");
    expect(overlay).toBeDefined();
    expect(overlay!.data.metadata.origin_overlay_version).toBe(2);
    expect(state.graphBuilderSeed?.zones.y).toEqual([
      { datasetId: overlay!.id, channel: 0 },
      { datasetId: overlay!.id, channel: 1 },
    ]);
    expect(state.datasets.filter((ds) => ds.data.metadata?.origin_overlay_source === "cross")).toHaveLength(1);
  });

  it("reuses one overlay when different layers of the same graph window are applied", () => {
    const book2: Dataset = {
      ...book,
      id: "d2",
      name: "Project:Book2",
      data: { ...book.data, metadata: { ...book.data.metadata, origin_book: "Book2" } },
    };
    const cross: OriginFigure = {
      ...figure,
      n_curves: 2,
      curves: [
        { book: "Book1", x: "A", y: "B", style: "line" },
        { book: "Book2", x: "A", y: "B", style: "line" },
      ],
    };
    useApp.setState({
      datasets: [book, book2],
      originFigures: [
        { id: "layer-1", stem: "Project", figure: { ...cross, layer: 1 }, datasetId: "d1", siblingIds: ["d1", "d2"] },
        { id: "layer-2", stem: "Project", figure: { ...cross, layer: 2 }, datasetId: "d1", siblingIds: ["d1", "d2"] },
      ],
    });

    useApp.getState().applyOriginFigure("layer-2");
    useApp.getState().applyOriginFigure("layer-1");

    const overlays = useApp.getState().datasets.filter((ds) => ds.data.metadata?.origin_overlay);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].data.metadata.origin_overlay_source).toBe("layer-1");
  });

  it("seeds a one-book multi-X remake from its segmented overlay", async () => {
    const multiX: Dataset = {
      id: "mx", name: "Moke:Book2",
      data: {
        time: [10, 20],
        values: [[1, 30, 3, 50, 5], [2, 40, 4, 60, 6]],
        labels: ["B", "E", "H", "I", "L"],
        units: ["", "Oe", "", "Oe", ""],
        metadata: {
          origin_book: "Book2", x_column_name: "A",
          origin_column_names: ["B", "E", "H", "I", "L"],
        },
      },
    };
    const multiFigure: OriginFigure = {
      ...figure, name: "Graph3", n_curves: 3,
      curves: [
        { book: "Book2", x: "A", y: "B", style: "line_symbol" },
        { book: "Book2", x: "E", y: "H", style: "line_symbol" },
        { book: "Book2", x: "I", y: "L", style: "line_symbol" },
      ],
    };
    useApp.setState({
      datasets: [multiX],
      originFigures: [{
        id: "multi-x", stem: "Moke", figure: multiFigure,
        datasetId: "mx", siblingIds: ["mx"],
      }],
    });

    await useApp.getState().remakeOriginFigure("multi-x");

    const state = useApp.getState();
    const overlay = state.datasets.find(
      (ds) => ds.data.metadata?.origin_overlay_source === "multi-x",
    );
    expect(overlay).toBeDefined();
    expect(overlay!.data.metadata.origin_overlay_version).toBe(2);
    expect(overlay!.data.time).toEqual([10, 20, 30, 40, 50, 60]);
    expect(state.graphBuilderSeed).toEqual({
      version: 1,
      zones: {
        x: null,
        y: [0, 1, 2].map((channel) => ({ datasetId: overlay!.id, channel })),
        group: null,
        facet: null,
        yErr: [],
        xErr: null,
      },
      mark: "line",
    });
  });

  it("finds a layer family's canonical overlay when remaking a later multi-X layer", async () => {
    const multiX: Dataset = {
      id: "mx-family", name: "Moke:Book2",
      data: {
        time: [10, 20],
        values: [[1, 30, 3, 50, 5], [2, 40, 4, 60, 6]],
        labels: ["B", "E", "H", "I", "L"], units: ["", "Oe", "", "Oe", ""],
        metadata: { origin_book: "Book2", x_column_name: "A", origin_column_names: ["B", "E", "H", "I", "L"] },
      },
    };
    const layer1 = { ...figure, name: "Graph family", layer: 1 };
    const layer2: OriginFigure = {
      ...figure, name: "Graph family", layer: 2, n_curves: 3,
      curves: [
        { book: "Book2", x: "A", y: "B", style: "line_symbol" },
        { book: "Book2", x: "E", y: "H", style: "line_symbol" },
        { book: "Book2", x: "I", y: "L", style: "line_symbol" },
      ],
    };
    useApp.setState({
      datasets: [multiX],
      originFigures: [
        { id: "family-l1", stem: "Moke", figure: layer1, datasetId: "mx-family", siblingIds: ["mx-family"] },
        { id: "family-l2", stem: "Moke", figure: layer2, datasetId: "mx-family", siblingIds: ["mx-family"] },
      ],
    });

    await useApp.getState().remakeOriginFigure("family-l2");

    const state = useApp.getState();
    const overlay = state.datasets.find((ds) => ds.data.metadata?.origin_overlay_source === "family-l1");
    expect(overlay).toBeDefined();
    expect(state.graphBuilderSeed?.zones.y).toEqual(
      [0, 1, 2].map((channel) => ({ datasetId: overlay!.id, channel })),
    );
  });

  it("does not reuse a multi-X sibling's overlay when remaking a single-X layer", async () => {
    const multiX: Dataset = {
      id: "mx-mixed", name: "Moke:Book2",
      data: {
        time: [10, 20],
        values: [[1, 30, 3, 50, 5], [2, 40, 4, 60, 6]],
        labels: ["B", "E", "H", "I", "L"], units: ["", "Oe", "", "Oe", ""],
        metadata: { origin_book: "Book2", x_column_name: "A", origin_column_names: ["B", "E", "H", "I", "L"] },
      },
    };
    const multiLayer: OriginFigure = {
      ...figure, name: "Mixed family", layer: 1, n_curves: 2,
      curves: [
        { book: "Book2", x: "E", y: "H", style: "line" },
        { book: "Book2", x: "I", y: "L", style: "line" },
      ],
    };
    const singleLayer: OriginFigure = {
      ...figure, name: "Mixed family", layer: 2,
      curves: [{ book: "Book2", x: "A", y: "B", style: "line" }],
    };
    useApp.setState({
      datasets: [multiX],
      originFigures: [
        { id: "mixed-l1", stem: "Moke", figure: multiLayer, datasetId: "mx-mixed", siblingIds: ["mx-mixed"] },
        { id: "mixed-l2", stem: "Moke", figure: singleLayer, datasetId: "mx-mixed", siblingIds: ["mx-mixed"] },
      ],
    });
    useApp.getState().applyOriginFigure("mixed-l1");
    const overlay = useApp.getState().datasets.find(
      (ds) => ds.data.metadata?.origin_overlay_source === "mixed-l1",
    );
    expect(overlay?.data.metadata.origin_overlay_entry).toBe("mixed-l1");

    await useApp.getState().remakeOriginFigure("mixed-l2");

    expect(useApp.getState().graphBuilderSeed?.zones).toMatchObject({
      x: null,
      y: [{ datasetId: "mx-mixed", channel: 0 }],
    });
    expect(useApp.getState().datasets.find((ds) => ds.id === overlay?.id)?.data.metadata.origin_overlay_entry)
      .toBe("mixed-l1");
  });
});
