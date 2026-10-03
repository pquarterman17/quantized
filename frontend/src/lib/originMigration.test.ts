import { describe, expect, it } from "vitest";

import type { OriginFidelityEntry } from "./originFidelity";
import type { OriginFigureEntry } from "./originFigures";
import { buildOriginMigrationProjects } from "./originMigration";
import type { Dataset, OriginFigure } from "./types";

function dataset(id: string, book: string, pending = false): Dataset {
  return {
    id,
    name: book,
    data: {
      time: [1, 2],
      values: [[3], [4]],
      labels: ["Y"],
      units: [""],
      metadata: { origin_book: book, origin_column_names: ["B"] },
    },
    ...(pending ? { pending: { kind: "path", path: "x.opj", bookId: book, rows: 2, cols: 1 } } : {}),
  } as Dataset;
}

function figure(overrides: Partial<OriginFigure> = {}): OriginFigure {
  return {
    name: "Graph1",
    x_from: 0,
    x_to: 2,
    x_log: false,
    y_from: 0,
    y_to: 5,
    y_log: false,
    n_curves: 1,
    annotations: [],
    curves: [{ book: "Book1", x: "", y: "B" }],
    fidelity: { status: "exact", recovered: [], omissions: [] },
    ...overrides,
  };
}

function entry(id: string, dsId: string | null, value = figure()): OriginFigureEntry {
  return { id, stem: "project", siblingIds: ["d1"], datasetId: dsId, figure: value };
}

function fidelity(siblingIds = ["d1"]): OriginFidelityEntry {
  return {
    id: "f1",
    stem: "project",
    siblingIds,
    manifest: {
      version: 1,
      container: "opj",
      status: "best_effort",
      graph_records_total: 2,
      graph_records_actionable: 2,
      graph_records_filtered: 0,
      omissions: [],
      filtered_figures: [],
    },
  };
}

describe("buildOriginMigrationProjects", () => {
  it("groups layers as one graph and reports exact decoded bindings as recovered", () => {
    const figures = [
      entry("g1", "d1", figure({ layer: 1 })),
      entry("g2", "d1", figure({ layer: 2 })),
    ];
    const [project] = buildOriginMigrationProjects([fidelity()], figures, [dataset("d1", "Book1", true)]);

    expect(project.bookCount).toBe(1);
    expect(project.pendingBookCount).toBe(1);
    expect(project.graphs).toHaveLength(1);
    expect(project.graphs[0]).toMatchObject({ layers: 2, state: "recovered", canOpen: true });
  });

  it("puts missing books first and preserves the actionable reason", () => {
    const [project] = buildOriginMigrationProjects(
      [fidelity()],
      [entry("g1", null, figure({ curves: [{ book: "Missing", x: "A", y: "B" }] }))],
      [dataset("d1", "Book1")],
    );

    expect(project.needsReview).toBe(1);
    expect(project.graphs[0]).toMatchObject({ state: "needs_review", canOpen: false });
    expect(project.graphs[0].unresolved).toEqual([
      { book: "Missing", x: "A", y: "B", reason: "book_not_imported" },
    ]);
    expect(project.issueGroups).toEqual([{
      id: "Missing\u0000book_not_imported",
      book: "Missing",
      reason: "book_not_imported",
      graphIds: [project.graphs[0].id],
      bindingCount: 1,
    }]);
  });

  it("distinguishes a heuristic graph from an empty graph record", () => {
    const [project] = buildOriginMigrationProjects(
      [fidelity()],
      [
        entry("heuristic", "d1", figure({ name: "Heuristic", curves: undefined })),
        entry("empty", "d1", figure({ name: "Empty", n_curves: 0, curves: [] })),
      ],
      [dataset("d1", "Book1")],
    );

    expect(project.graphs.find((graph) => graph.label === "Heuristic")?.state).toBe("approximate");
    expect(project.graphs.find((graph) => graph.label === "Empty")).toMatchObject({
      state: "needs_review",
      canOpen: false,
      detail: "No plotted curves were decoded from this graph record.",
    });
  });

  it("never mixes same-named books or graphs from separate imports", () => {
    const other = { ...entry("other", "d2"), siblingIds: ["d2"] };
    const projects = buildOriginMigrationProjects(
      [fidelity(["d1"]), { ...fidelity(["d2"]), id: "f2" }],
      [entry("first", "d1"), other],
      [dataset("d1", "Book1"), dataset("d2", "Book1")],
    );

    expect(projects.map((project) => project.graphs.map((graph) => graph.entry.id))).toEqual([
      ["first"],
      ["other"],
    ]);
  });

  it("uses a resolved sibling layer for graph actions when layer one is unresolved", () => {
    const figures = [
      entry("layer-1", null, figure({ layer: 1 })),
      entry("layer-2", "d1", figure({ layer: 2 })),
    ];
    const [project] = buildOriginMigrationProjects([fidelity()], figures, [dataset("d1", "Book1")]);

    expect(project.graphs[0]).toMatchObject({ layers: 2, canOpen: true });
    expect(project.graphs[0].entry.id).toBe("layer-2");
  });

  it("removes any numeric layer suffix from the grouped graph label", () => {
    const figures = [
      entry("layer-3", "d1", figure({ layer: 3 })),
      entry("layer-4", "d1", figure({ layer: 4 })),
    ];
    const [project] = buildOriginMigrationProjects([fidelity()], figures, [dataset("d1", "Book1")]);
    expect(project.graphs[0].label).toBe("Graph1");
  });

  it("does not count internal filtered records as reference-only graph windows", () => {
    const f = fidelity();
    f.manifest.filtered_figures = [{ index: 9, name: "SYSTEM", layer: null, reason: "internal" }];
    const [project] = buildOriginMigrationProjects([f], [], [dataset("d1", "Book1")]);
    expect(project.referenceOnly).toBe(0);
  });
});
