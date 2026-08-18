// Red-first unit tests for LIBRARY_WORKBOOK_UX_PLAN PR J slice 1 (separate,
// L0.51) — the pure dependency-closure + preview-plan builder
// store/workbookSeparate.ts's actions delegate to. `computeSeparatePlan`
// reuses `lib/libraryHierarchy.ts`'s `buildLibraryHierarchy` (before/after)
// so the preview can never drift from what a commit actually produces — see
// that function's own doc comment for why.

import { describe, expect, it } from "vitest";

import type { Dataset, FolderNode } from "./types";
import type { WorkbookNode } from "./workbooks";
import type { OriginFigureEntry } from "./originFigures";
import type { FigureDocument } from "./figureDocument";
import type { PageDocument } from "./pageDocument";
import type { ReportEntry } from "./report";
import { closeExclusiveDependents, computeSeparatePlan } from "./workbookSeparate";

function ds(id: string, name: string, extra: Partial<Dataset> = {}): Dataset {
  return {
    id,
    name,
    data: { time: [0], values: [[0]], labels: ["y"], units: [""], metadata: {} },
    ...extra,
  };
}

const FOLDERS: FolderNode[] = [];

describe("closeExclusiveDependents", () => {
  it("returns just the seed when nothing depends on it", () => {
    const datasets = [ds("a", "A")];
    expect(closeExclusiveDependents(datasets, ["a"])).toEqual(new Set(["a"]));
  });

  it("sweeps in a dataset whose corrections background-subtract the seed (bgRef chain)", () => {
    const datasets = [
      ds("a", "A"),
      ds("b", "B", { bgRef: { datasetId: "a", interp: "pchip" }, corrections: {}, raw: { time: [0], values: [[0]], labels: ["y"], units: [""], metadata: {} } }),
    ];
    expect(closeExclusiveDependents(datasets, ["a"])).toEqual(new Set(["a", "b"]));
  });

  it("does NOT sweep in a bgRef consumer missing raw/corrections (not a live edge)", () => {
    const datasets = [ds("a", "A"), ds("b", "B", { bgRef: { datasetId: "a", interp: "pchip" } })];
    expect(closeExclusiveDependents(datasets, ["a"])).toEqual(new Set(["a"]));
  });

  // P2 fix (adversarial review, 2026-08-18): the "does NOT sweep" case above
  // omits BOTH `corrections` and `raw` at once, so it can't tell a broken
  // `d.bgRef && d.corrections && d.raw` predicate (e.g. one that dropped
  // `&& d.raw`) from a correct one — 14/14 tests still passed under that
  // exact mutation during review. These two isolate each half.
  it("does NOT sweep in a bgRef consumer with corrections but NO raw (not a live edge)", () => {
    const datasets = [
      ds("a", "A"),
      ds("b", "B", { bgRef: { datasetId: "a", interp: "pchip" }, corrections: {} }),
    ];
    expect(closeExclusiveDependents(datasets, ["a"])).toEqual(new Set(["a"]));
  });

  it("does NOT sweep in a bgRef consumer with raw but NO corrections (not a live edge)", () => {
    const datasets = [
      ds("a", "A"),
      ds("b", "B", {
        bgRef: { datasetId: "a", interp: "pchip" },
        raw: { time: [0], values: [[0]], labels: ["y"], units: [""], metadata: {} },
      }),
    ];
    expect(closeExclusiveDependents(datasets, ["a"])).toEqual(new Set(["a"]));
  });

  it("sweeps in a derived worksheet chained off the seed", () => {
    const datasets = [ds("a", "A"), ds("b", "B", { derivedFrom: { datasetId: "a", pipeline: "smooth" } })];
    expect(closeExclusiveDependents(datasets, ["a"])).toEqual(new Set(["a", "b"]));
  });

  it("chains transitively (a <- b <- c)", () => {
    const datasets = [
      ds("a", "A"),
      ds("b", "B", { derivedFrom: { datasetId: "a", pipeline: "p" } }),
      ds("c", "C", { derivedFrom: { datasetId: "b", pipeline: "p" } }),
    ];
    expect(closeExclusiveDependents(datasets, ["a"])).toEqual(new Set(["a", "b", "c"]));
  });

  it("does NOT sweep in a dataset with an ADDITIONAL dependency outside the seed set", () => {
    // c depends on BOTH a (moving) and z (not moving) — not exclusive, stays.
    const datasets = [
      ds("a", "A"),
      ds("z", "Z"),
      ds("c", "C", {
        bgRef: { datasetId: "a", interp: "pchip" },
        corrections: {},
        raw: { time: [0], values: [[0]], labels: ["y"], units: [""], metadata: {} },
        derivedFrom: { datasetId: "z", pipeline: "p" },
      }),
    ];
    expect(closeExclusiveDependents(datasets, ["a"])).toEqual(new Set(["a"]));
  });
});

function baseInput(overrides: {
  datasets: Dataset[];
  workbooks?: WorkbookNode[];
  originFigures?: OriginFigureEntry[];
  editableFigures?: FigureDocument[];
  publicationFigures?: never[];
  pages?: PageDocument[];
  reports?: ReportEntry[];
}) {
  return {
    folders: FOLDERS,
    workbooks: overrides.workbooks ?? [],
    datasets: overrides.datasets,
    originFigures: overrides.originFigures ?? [],
    editableFigures: overrides.editableFigures ?? [],
    publicationFigures: [],
    pages: overrides.pages ?? [],
    reports: overrides.reports ?? [],
  };
}

function report(id: string, datasetId: string | null): ReportEntry {
  return { id, name: id, datasetId, report: { title: id, sections: [] } };
}

describe("computeSeparatePlan", () => {
  it("plans a bare worksheet with nothing dependent: just the worksheet moves", () => {
    const wb: WorkbookNode = { id: "wb1", name: "Source" };
    const datasets = [ds("a", "A", { workbookId: "wb1" }), ds("b", "B", { workbookId: "wb1" })];
    const plan = computeSeparatePlan(baseInput({ datasets, workbooks: [wb] }), ["a"], "new-wb");

    expect(plan.movingDatasetIds).toEqual(["a"]);
    expect(plan.newWorkbookFolderId).toBeUndefined();
    const worksheetItem = plan.items.find((i) => i.kind === "worksheet" && i.name === "A");
    expect(worksheetItem?.action).toBe("move");
    expect(plan.warnings).toEqual([]);
  });

  it("moves a report that depends ONLY on the separated worksheet", () => {
    const datasets = [ds("a", "A", { workbookId: "wb1" })];
    const reports = [report("r1", "a")];
    const plan = computeSeparatePlan(baseInput({ datasets, reports }), ["a"], "new-wb");
    const item = plan.items.find((i) => i.kind === "report");
    expect(item?.action).toBe("move");
  });

  it("keeps a report depending on a worksheet OUTSIDE the moving set at the original location", () => {
    const datasets = [ds("a", "A", { workbookId: "wb1" }), ds("z", "Z", { workbookId: "wb1" })];
    // A report referencing a worksheet NOT being separated never overlaps the
    // moving set — it should not even surface as a candidate item.
    const reports = [report("r1", "z")];
    const plan = computeSeparatePlan(baseInput({ datasets, reports }), ["a"], "new-wb");
    expect(plan.items.some((i) => i.kind === "report")).toBe(false);
  });

  it("a report depending on the separated worksheet's derived (exclusively-moving) sibling still moves", () => {
    const datasets = [
      ds("a", "A", { workbookId: "wb1" }),
      ds("b", "B", { workbookId: "wb1", derivedFrom: { datasetId: "a", pipeline: "p" } }),
    ];
    const reports = [report("r1", "b")];
    const plan = computeSeparatePlan(baseInput({ datasets, reports }), ["a"], "new-wb");
    expect(plan.movingDatasetIds.sort()).toEqual(["a", "b"]);
    const item = plan.items.find((i) => i.kind === "report");
    expect(item?.action).toBe("move");
    const sheetItem = plan.items.find((i) => i.kind === "worksheet" && i.name === "B");
    expect(sheetItem?.action).toBe("move");
    expect(sheetItem?.reason).not.toBe("selected for separation"); // it was swept in, not selected
  });

  it("a page spanning the separated worksheet AND one staying behind stays at the shared location", () => {
    const wb: WorkbookNode = { id: "wb1", name: "Source" };
    const datasets = [ds("a", "A", { workbookId: "wb1" }), ds("z", "Z", { workbookId: "wb1" })];
    const figA: FigureDocument = {
      schema: "quantized.figure", version: 2, id: "figA", name: "figA",
      bindings: { datasetId: "a", xKey: null, yKeys: null, y2Keys: null, groupKey: null, facetKey: null, errors: [] },
      data: { mode: "live" },
      plot: { mark: "line", view: {} as never, axisBreaks: { x: [], y: [], y2: [] } },
      output: { format: "pdf", stylePreset: "default", dpi: 300, transparent: false, filename: null },
    };
    const figZ: FigureDocument = { ...figA, id: "figZ", name: "figZ", bindings: { ...figA.bindings, datasetId: "z" } };
    const page: PageDocument = {
      schema: "quantized.page" as never, version: 1 as never, id: "p1", name: "Page 1",
      rows: 1, cols: 2,
      panels: [{ figureId: "figA" }, { figureId: "figZ" }] as never,
      output: {} as never, layout: {} as never,
      createdAt: "2026-01-01T00:00:00Z", modifiedAt: "2026-01-01T00:00:00Z",
    };
    const plan = computeSeparatePlan(
      baseInput({ datasets, workbooks: [wb], editableFigures: [figA, figZ], pages: [page] }),
      ["a"],
      "new-wb",
    );
    const pageItem = plan.items.find((i) => i.kind === "page");
    expect(pageItem?.action).toBe("stay");
    expect(pageItem?.reason).toMatch(/also depends/);
    // The single-source figure bound only to "a" still moves on its own.
    const figItem = plan.items.find((i) => i.kind === "editable-figure" && i.name === "figA");
    expect(figItem?.action).toBe("move");
  });

  it("suggests the new workbook's folder as the SOURCE workbook's folder", () => {
    const wb: WorkbookNode = { id: "wb1", name: "Source", folderId: "f1" };
    const datasets = [ds("a", "A", { workbookId: "wb1" })];
    const plan = computeSeparatePlan(baseInput({ datasets, workbooks: [wb] }), ["a"], "new-wb");
    expect(plan.newWorkbookFolderId).toBe("f1");
  });

  it("warns and drops a requested worksheet id that no longer exists, but still plans the rest", () => {
    const datasets = [ds("a", "A", { workbookId: "wb1" })];
    const plan = computeSeparatePlan(baseInput({ datasets }), ["a", "ghost"], "new-wb");
    expect(plan.movingDatasetIds).toEqual(["a"]);
    expect(plan.warnings.some((w) => w.includes("ghost"))).toBe(true);
  });

  it("empty/fully-invalid selection plans nothing and warns", () => {
    const plan = computeSeparatePlan(baseInput({ datasets: [] }), ["ghost"], "new-wb");
    expect(plan.movingDatasetIds).toEqual([]);
    expect(plan.items).toEqual([]);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });
});
