import { beforeEach, describe, expect, it } from "vitest";

import { captureRecipe, type PlotRecipe } from "../lib/plotRecipe";
import { defaultPlotView } from "../lib/plotview";
import { resolvedRecipeView } from "../lib/plotRecipeView";
import type { Dataset } from "../lib/types";
import {
  batchSeedDatasetIds,
  buildBatchFigureArtifacts,
  commitBatchFigureArtifacts,
  preflightBatchFigure,
} from "./batchFigureBuild";
import { useApp } from "./useApp";

function dataset(
  id: string,
  labels = ["2theta", "Intensity", "Ierr"],
  technique = "xrd.powder",
): Dataset {
  return {
    id,
    name: `${id}.xy`,
    data: {
      time: [0, 1],
      values: labels.map((_, column) => [column + 1, column + 2]),
      labels,
      units: labels.map(() => ""),
      metadata: { technique },
    },
  };
}

function recipe(): PlotRecipe {
  return captureRecipe(
    dataset("source"),
    { ...defaultPlotView(), xKey: 0, yKeys: [1], errKeys: { 1: 2 } },
    null,
    { id: "recipe-1", name: "Publication XRD", appVersion: "test" },
  );
}

describe("batchSeedDatasetIds", () => {
  const datasets = [
    { ...dataset("a"), workbookId: "w1", folderId: "child" },
    { ...dataset("b"), workbookId: "w1", folderId: "child" },
    { ...dataset("c"), workbookId: "w2", folderId: "other" },
  ];
  const folders = [
    { id: "root", name: "Root", parentId: null, order: 0 },
    { id: "child", name: "Child", parentId: "root", order: 0 },
    { id: "other", name: "Other", parentId: null, order: 1 },
  ];
  const workbooks = [
    { id: "w1", name: "Book 1", folderId: "child" },
    { id: "w2", name: "Book 2", folderId: "other" },
  ];

  it("prefers an explicit worksheet multi-selection", () => {
    expect(
      batchSeedDatasetIds({
        datasets,
        folders,
        workbooks,
        selectedIds: ["c", "gone"],
        activeId: "a",
        librarySelection: { kind: "folder", id: "root" },
      }),
    ).toEqual(["c"]);
  });

  it("expands a selected workbook or a whole selected folder subtree", () => {
    expect(
      batchSeedDatasetIds({
        datasets,
        folders,
        workbooks,
        selectedIds: [],
        activeId: null,
        librarySelection: { kind: "workbook", id: "w1" },
      }),
    ).toEqual(["a", "b"]);
    expect(
      batchSeedDatasetIds({
        datasets,
        folders,
        workbooks,
        selectedIds: [],
        activeId: null,
        librarySelection: { kind: "folder", id: "root" },
      }),
    ).toEqual(["a", "b"]);
  });
});
describe("Batch Figure Builder preflight", () => {
  it("distinguishes a clean match, an explicit partial match, and a hard refusal", () => {
    const saved = recipe();
    expect(
      preflightBatchFigure(saved, dataset("ok"), { datasets: [] }).status,
    ).toBe("ready");

    const partial = preflightBatchFigure(
      saved,
      dataset("partial", ["2theta", "Intensity"]),
      { datasets: [] },
    );
    expect(partial.status).toBe("partial");
    expect(partial.unmatched.join(" ")).toContain("Ierr");

    const refused = preflightBatchFigure(
      saved,
      dataset("wrong", undefined, "magnetometry.mvsh"),
      { datasets: [] },
    );
    expect(refused.status).toBe("blocked");
    expect(refused.summary).toContain("not magnetometry.mvsh");
  });

  it("blocks a technically partial resolution that would render a blank plot", () => {
    const row = preflightBatchFigure(
      recipe(),
      dataset("blank", ["2theta", "Other"]),
      { datasets: [] },
    );
    expect(row.status).toBe("blocked");
    expect(row.summary).toContain("blank plot");
  });

  it("never silently skips a recipe's recorded data transformation", () => {
    const saved = {
      ...recipe(),
      transform: { name: "Normalize", revision: 2 },
    };
    const row = preflightBatchFigure(saved, dataset("target"), {
      datasets: [],
    });
    expect(row.status).toBe("blocked");
    expect(row.summary).toContain("transform the datasets first");
  });
});
describe("batch recipe view projection", () => {
  it("stays apply-equivalent to the ordinary one-figure Plot Recipe path", async () => {
    const saved = {
      ...recipe(),
      visual: {
        ...recipe().visual,
        refLines: [{ id: "saved", axis: "x" as const, value: 1 }],
      },
    };
    const row = preflightBatchFigure(saved, dataset("target"), {
      datasets: [],
    });
    if (!row.resolved) throw new Error("expected resolved recipe");
    const batchView = resolvedRecipeView(
      row.resolved.mapping,
      row.resolved.visual,
      () => "batch-line",
    );
    const { viewFromResolved } = await import("./plotRecipeApply");
    const ordinaryView = viewFromResolved(
      row.resolved.mapping,
      row.resolved.visual,
    );
    expect({
      ...batchView,
      refLines: batchView.refLines.map((line) => ({ ...line, id: "fresh" })),
    }).toEqual({
      ...ordinaryView,
      refLines: ordinaryView.refLines.map((line) => ({ ...line, id: "fresh" })),
    });
  });
});

describe("buildBatchFigureArtifacts", () => {
  it("creates independently editable figures, dedupes names, and lays out a referenced page", () => {
    const saved = recipe();
    const rows = ["a", "b", "c"].map((id) =>
      preflightBatchFigure(saved, dataset(id), { datasets: [] }),
    );
    let figureId = 0;
    const built = buildBatchFigureArtifacts({
      recipe: saved,
      rows,
      includedDatasetIds: new Set(["a", "b", "c"]),
      existingFigureNames: ["a.xy — Publication XRD"],
      existingPageNames: ["Summary"],
      namePattern: "{dataset} — {recipe}",
      createPage: true,
      pageName: "Summary",
      columns: "auto",
      nextFigureId: () => `figure-${++figureId}`,
      nextPageId: () => "page-1",
    });

    expect(built.figures.map((figure) => figure.name)).toEqual([
      "a.xy — Publication XRD (2)",
      "b.xy — Publication XRD",
      "c.xy — Publication XRD",
    ]);
    expect(built.figures.map((figure) => figure.bindings.datasetId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(built.figures[0].bindings.errors).toHaveLength(1);
    expect(built.pages[0]).toMatchObject({
      id: "page-1",
      name: "Summary (2)",
      rows: 2,
      cols: 2,
    });
    expect(built.pages[0].panels.map((panel) => panel.figureId)).toEqual([
      "figure-1",
      "figure-2",
      "figure-3",
      null,
    ]);
  });

  it("never creates a blocked or unselected row and can omit the page", () => {
    const saved = recipe();
    const ready = preflightBatchFigure(saved, dataset("ready"), {
      datasets: [],
    });
    const blocked = preflightBatchFigure(
      saved,
      dataset("blocked", undefined, "generic"),
      { datasets: [] },
    );
    const built = buildBatchFigureArtifacts({
      recipe: saved,
      rows: [ready, blocked],
      includedDatasetIds: new Set(["blocked"]),
      existingFigureNames: [],
      existingPageNames: [],
      namePattern: "{dataset}",
      createPage: false,
      pageName: "",
      columns: "auto",
      nextFigureId: () => "unexpected",
      nextPageId: () => "unexpected",
    });
    expect(built).toEqual({ figures: [], pages: [] });
  });

  it("splits batches larger than the supported 4 by 4 grid without losing figures", () => {
    const saved = recipe();
    const rows = Array.from({ length: 18 }, (_, index) =>
      preflightBatchFigure(saved, dataset(`dataset-${index + 1}`), { datasets: [] }),
    );
    let figureId = 0;
    let pageId = 0;
    const built = buildBatchFigureArtifacts({
      recipe: saved,
      rows,
      includedDatasetIds: new Set(rows.map((row) => row.datasetId)),
      existingFigureNames: [],
      existingPageNames: ["Summary — 1 of 2"],
      namePattern: "{dataset}",
      createPage: true,
      pageName: "Summary",
      columns: "auto",
      nextFigureId: () => `figure-${++figureId}`,
      nextPageId: () => `page-${++pageId}`,
    });

    expect(built.pages).toHaveLength(2);
    expect(built.pages.map((page) => [page.rows, page.cols])).toEqual([[4, 4], [1, 2]]);
    expect(built.pages.map((page) => page.name)).toEqual([
      "Summary — 1 of 2 (2)",
      "Summary — 2 of 2",
    ]);
    expect(built.pages.flatMap((page) => page.panels.map((panel) => panel.figureId).filter(Boolean))).toEqual(
      built.figures.map((figure) => figure.id),
    );
  });
});

describe("commitBatchFigureArtifacts", () => {
  beforeEach(() => {
    useApp.setState({
      editableFigures: [],
      pages: [],
      pageDocSeed: null,
      figurePageOpen: false,
      librarySelection: null,
      selectedIds: ["old-selection"],
      history: [],
      future: [],
    });
  });

  function artifacts() {
    const saved = recipe();
    const row = preflightBatchFigure(saved, dataset("a"), { datasets: [] });
    return buildBatchFigureArtifacts({
      recipe: saved,
      rows: [row],
      includedDatasetIds: new Set(["a"]),
      existingFigureNames: [],
      existingPageNames: [],
      namePattern: "{dataset}",
      createPage: true,
      pageName: "Batch page",
      columns: "auto",
      nextFigureId: () => "figure-1",
      nextPageId: () => "page-1",
    });
  }

  it("commits figures and page as one undoable edit and opens the new page", () => {
    expect(commitBatchFigureArtifacts(artifacts())).toEqual({
      pageOpened: true,
    });
    const state = useApp.getState();
    expect(state.editableFigures).toHaveLength(1);
    expect(state.pages).toHaveLength(1);
    expect(state.pageDocSeed?.id).toBe("page-1");
    expect(state.librarySelection).toEqual({ kind: "page", id: "page-1" });
    expect(state.history.map((entry) => entry.label)).toEqual([
      "build 1 figure",
    ]);
    state.undo();
    expect(useApp.getState().editableFigures).toEqual([]);
    expect(useApp.getState().pages).toEqual([]);
  });

  it("never replaces a Figure Page session that is already open", () => {
    useApp.setState({
      figurePageOpen: true,
      pageDocSeed: null,
      librarySelection: { kind: "workbook", id: "w1" },
    });
    expect(commitBatchFigureArtifacts(artifacts())).toEqual({
      pageOpened: false,
    });
    const state = useApp.getState();
    expect(state.pages.map((page) => page.id)).toEqual(["page-1"]);
    expect(state.pageDocSeed).toBeNull();
    expect(state.librarySelection).toEqual({ kind: "workbook", id: "w1" });
  });

  it("commits every split page while opening only the first one", () => {
    const built = artifacts();
    const secondPage = {
      ...structuredClone(built.pages[0]),
      id: "page-2",
      name: "Batch page — 2 of 2",
    };

    expect(commitBatchFigureArtifacts({ ...built, pages: [...built.pages, secondPage] })).toEqual({
      pageOpened: true,
    });
    const state = useApp.getState();
    expect(state.pages.map((page) => page.id)).toEqual(["page-1", "page-2"]);
    expect(state.pageDocSeed?.id).toBe("page-1");
  });
});
