import { describe, expect, it } from "vitest";

import type { OriginFidelityEntry } from "../lib/originFidelity";
import { pruneOriginFidelityRefs } from "./originImport";

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
