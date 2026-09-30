// The canonical draft's preview request draws masked rows the way the app's
// "Excluded rows" mode does (F4.2c (a)), and keeps its wire dataset ONE object
// across edits that cannot change it, so the preview's dataset-handle cache
// (`lib/api/datasetCache.ts`, keyed on that object) keeps hitting.

import { describe, expect, it } from "vitest";

import { createFigureDocument, type FigureDocument } from "../../../lib/figureDocument";
import { defaultPlotView } from "../../../lib/plotview";
import type { DataStruct, Dataset } from "../../../lib/types";
import { computeCanonicalReadiness } from "./canonicalReadiness";

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[1, 5], [2, 6], [3, 7], [4, 8]],
  labels: ["M", "N"],
  units: ["emu", "emu"],
  metadata: {},
};

function live(excludedRows?: number[]): Dataset {
  return { id: "d1", name: "scan.dat", data: DATA, ...(excludedRows ? { excludedRows } : {}) };
}

function doc(over: { title?: string; yKeys?: number[] } = {}): FigureDocument {
  return createFigureDocument({
    id: "figure-w1", name: "Canonical", datasetId: "d1",
    view: { ...defaultPlotView(), yKeys: over.yKeys ?? [0], plotTitle: over.title ?? "" },
  });
}

const specOf = (document: FigureDocument, dataset: Dataset, mode: "grey" | "hide") => {
  const ready = computeCanonicalReadiness(document, dataset, false, mode);
  if (ready?.state !== "ready") throw new Error(`not ready: ${ready?.state}`);
  return ready.spec;
};

describe("computeCanonicalReadiness — excluded rows", () => {
  it("greys masked rows as companions, or omits them, per the app mode", () => {
    const ds = live([1]);
    const grey = specOf(doc(), ds, "grey");
    expect(grey.dataset.labels).toEqual(["M", "N", "M (excluded)"]);
    expect(grey.dataset.time).toEqual([0, 2, 3, 1]);
    expect(grey.y_keys).toEqual([0, 2]);
    const hide = specOf(doc(), ds, "hide");
    expect(hide.dataset.time).toEqual([0, 2, 3]);
    expect(hide.y_keys).toEqual([0]);
  });

  it("omits when no mode is given (the pre-existing export-omit shape)", () => {
    const ready = computeCanonicalReadiness(doc(), live([1]));
    expect(ready?.state === "ready" && ready.spec.dataset.time).toEqual([0, 2, 3]);
  });

  it("keeps the wire dataset one object across a title edit; rebuilds it on a mode, channel or row-state change", () => {
    const ds = live([1]);
    const first = specOf(doc(), ds, "grey").dataset;
    expect(specOf(doc({ title: "Loop" }), ds, "grey").dataset).toBe(first);
    expect(specOf(doc(), ds, "hide").dataset).not.toBe(first);
    expect(specOf(doc({ yKeys: [0, 1] }), ds, "grey").dataset).not.toBe(first);
    const rowsChanged = { ...ds, excludedRows: [2] };
    expect(specOf(doc(), rowsChanged, "grey").dataset.time).toEqual([0, 1, 3, 2]);
  });

  it("leaves an unmasked dataset as the store's own object, so nothing needs remembering", () => {
    const ds = live();
    expect(specOf(doc(), ds, "grey").dataset).toBe(DATA);
    expect(specOf(doc(), ds, "hide").dataset).toBe(DATA);
  });
});
