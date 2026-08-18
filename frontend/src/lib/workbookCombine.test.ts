// Red-first unit tests for LIBRARY_WORKBOOK_UX_PLAN PR J slice 1 (combine) —
// the pure planning helpers store/workbookCombine.ts's action delegates to.

import { describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import {
  dedupeWorksheetNames,
  resolveCombineTargets,
  suggestCombinedWorkbookName,
} from "./workbookCombine";

function ds(id: string, name: string, workbookId?: string): Dataset {
  const d: Dataset = { id, name, data: { time: [0], values: [[0]], labels: ["y"], units: [""], metadata: {} } };
  if (workbookId) d.workbookId = workbookId;
  return d;
}

describe("resolveCombineTargets", () => {
  it("expands a selected whole workbook to every one of its member worksheets", () => {
    const datasets = [ds("s1", "sheet1", "wb1"), ds("s2", "sheet2", "wb1"), ds("s3", "sheet3", "wb2")];
    const ids = resolveCombineTargets({ workbookIds: ["wb1"], worksheetIds: [] }, datasets);
    expect(ids).toEqual(["s1", "s2"]);
  });

  it("includes an individually selected worksheet not covered by a selected workbook", () => {
    const datasets = [ds("s1", "sheet1", "wb1"), ds("s3", "sheet3", "wb2")];
    const ids = resolveCombineTargets({ workbookIds: ["wb1"], worksheetIds: ["s3"] }, datasets);
    expect(ids).toEqual(["s1", "s3"]);
  });

  it("never lists a dataset twice when a whole-workbook selection and an individual pick overlap", () => {
    const datasets = [ds("s1", "sheet1", "wb1"), ds("s2", "sheet2", "wb1")];
    const ids = resolveCombineTargets({ workbookIds: ["wb1"], worksheetIds: ["s1"] }, datasets);
    expect(ids).toEqual(["s1", "s2"]);
  });

  it("drops a worksheet id that names no live dataset", () => {
    const datasets = [ds("s1", "sheet1")];
    const ids = resolveCombineTargets({ workbookIds: [], worksheetIds: ["s1", "ghost"] }, datasets);
    expect(ids).toEqual(["s1"]);
  });

  it("returns an empty list for an empty selection", () => {
    expect(resolveCombineTargets({ workbookIds: [], worksheetIds: [] }, [ds("s1", "a")])).toEqual([]);
  });
});

describe("suggestCombinedWorkbookName", () => {
  it("suggests the shared filename prefix when one is clear", () => {
    expect(suggestCombinedWorkbookName(["run1_field.dat", "run1_temp.dat", "run1_vsm.dat"])).toBe("run1_");
  });

  it("returns undefined when there is no meaningful shared prefix", () => {
    expect(suggestCombinedWorkbookName(["alpha.dat", "beta.dat"])).toBeUndefined();
  });

  it("returns undefined for a single source (nothing to suggest a shared prefix FROM)", () => {
    expect(suggestCombinedWorkbookName(["only.dat"])).toBeUndefined();
  });

  it("returns undefined when the shared prefix is trivially short (<3 chars)", () => {
    expect(suggestCombinedWorkbookName(["a1.dat", "a2.dat"])).toBeUndefined();
  });
});

describe("dedupeWorksheetNames", () => {
  it("leaves distinct names untouched", () => {
    expect(dedupeWorksheetNames(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("suffixes a repeated name visibly, never dropping/overwriting the earlier one (L0.34)", () => {
    expect(dedupeWorksheetNames(["data.dat", "data.dat"])).toEqual(["data.dat", "data.dat (2)"]);
  });

  it("chains suffixes for three-way collisions", () => {
    expect(dedupeWorksheetNames(["x", "x", "x"])).toEqual(["x", "x (2)", "x (3)"]);
  });

  it("does not let a fresh name collide with an already-minted suffix", () => {
    expect(dedupeWorksheetNames(["x", "x (2)", "x"])).toEqual(["x", "x (2)", "x (3)"]);
  });
});
