import { describe, expect, it } from "vitest";

import type { OriginFidelityEntry } from "../lib/originFidelity";
import { pruneOriginFidelityRefs, pruneOriginFigureRefs } from "./originImport";

const entry: OriginFidelityEntry = {
  id: "f1",
  stem: "Moke",
  siblingIds: ["d1", "d2"],
  manifest: {
    version: 1,
    container: "opj",
    status: "best_effort",
    graph_records_total: 1,
    graph_records_actionable: 1,
    graph_records_filtered: 0,
    omissions: ["graphic_objects"],
    filtered_figures: [],
  },
};

describe("Origin fidelity dataset-reference pruning", () => {
  it("retains the project while any imported sibling survives", () => {
    expect(pruneOriginFidelityRefs([entry], new Set(["d1"]))).toEqual([
      { ...entry, siblingIds: ["d2"] },
    ]);
  });

  it("drops the project artifact after its last imported dataset is removed", () => {
    expect(pruneOriginFidelityRefs([entry], new Set(["d1", "d2"]))).toEqual([]);
  });
});

describe("Origin source-mapping pruning", () => {
  it("drops only mappings to removed datasets and preserves the original object when nothing changes", () => {
    const figure = {
      id: "fig", stem: "Moke", datasetId: "d1", siblingIds: ["d1", "d2"],
      figure: {} as never, sourceOverrides: { Missing: "d2" },
    };
    expect(pruneOriginFigureRefs([figure], new Set())[0]).toBe(figure);
    expect(pruneOriginFigureRefs([figure], new Set(["d2"]))[0]).toMatchObject({
      datasetId: "d1", sourceOverrides: undefined,
    });
  });
});
