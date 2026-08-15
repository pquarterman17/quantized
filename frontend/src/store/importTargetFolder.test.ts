// LIBRARY_WORKBOOK_UX_PLAN L0.46 — unit coverage for the pure/near-pure
// helpers extracted out of importDatasets.ts. Integration coverage (actually
// wired into an import batch) lives in importDatasets.test.ts.

import { describe, expect, it } from "vitest";

import { batchFolderOffer, createFolderForBatch, longestCommonPrefix, resolveImportTargetFolderId } from "./importTargetFolder";
import type { Dataset, FolderNode } from "../lib/types";
import type { WorkbookNode } from "../lib/workbooks";
import { useApp } from "./useApp";

const ds = (id: string, name: string, workbookId?: string): Dataset => ({
  id,
  name,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
  ...(workbookId ? { workbookId } : {}),
});

describe("resolveImportTargetFolderId", () => {
  it("returns undefined when nothing is selected", () => {
    useApp.setState({ librarySelection: null, workbooks: [] });
    expect(resolveImportTargetFolderId(useApp.getState)).toBeUndefined();
  });

  it("returns the selected folder's own id", () => {
    useApp.setState({ librarySelection: { kind: "folder", id: "f1" } });
    expect(resolveImportTargetFolderId(useApp.getState)).toBe("f1");
  });

  it("returns the selected workbook's folderId", () => {
    useApp.setState({
      workbooks: [{ id: "w1", name: "W", folderId: "f2" }],
      librarySelection: { kind: "workbook", id: "w1" },
    });
    expect(resolveImportTargetFolderId(useApp.getState)).toBe("f2");
  });

  it("returns undefined for a root-level selected workbook", () => {
    useApp.setState({
      workbooks: [{ id: "w1", name: "W" }],
      librarySelection: { kind: "workbook", id: "w1" },
    });
    expect(resolveImportTargetFolderId(useApp.getState)).toBeUndefined();
  });

  it("returns undefined for a selected workbook that no longer exists", () => {
    useApp.setState({ workbooks: [], librarySelection: { kind: "workbook", id: "gone" } });
    expect(resolveImportTargetFolderId(useApp.getState)).toBeUndefined();
  });
});

describe("longestCommonPrefix", () => {
  it("finds the shared prefix and trims a trailing separator", () => {
    expect(longestCommonPrefix(["scan_1", "scan_2"])).toBe("scan");
  });

  it("does not trim a trailing digit — only separators", () => {
    expect(longestCommonPrefix(["scan001", "scan002"])).toBe("scan00");
  });

  it("returns empty for no shared prefix", () => {
    expect(longestCommonPrefix(["alpha", "beta"])).toBe("");
  });

  it("returns the single string, trimmed, for a length-1 list", () => {
    expect(longestCommonPrefix(["solo_"])).toBe("solo");
  });

  it("returns empty for an empty list", () => {
    expect(longestCommonPrefix([])).toBe("");
  });

  it("handles a 3-way batch, trimming to the common part", () => {
    expect(longestCommonPrefix(["run_a", "run_b", "run_c"])).toBe("run");
  });
});

describe("batchFolderOffer", () => {
  it("qualifies a >=2 file batch with a shared prefix", () => {
    useApp.setState({ datasets: [ds("d1", "scan_1.dat"), ds("d2", "scan_2.dat")] });
    const offer = batchFolderOffer(useApp.getState, ["d1", "d2"], 2);
    expect(offer).toEqual({ prefix: "scan", ids: ["d1", "d2"] });
  });

  it("qualifies a 3-file batch too, not just exactly 2", () => {
    useApp.setState({
      datasets: [ds("d1", "scan_1.dat"), ds("d2", "scan_2.dat"), ds("d3", "scan_3.dat")],
    });
    const offer = batchFolderOffer(useApp.getState, ["d1", "d2", "d3"], 3);
    expect(offer).toEqual({ prefix: "scan", ids: ["d1", "d2", "d3"] });
  });

  it("does not qualify a single file", () => {
    useApp.setState({ datasets: [ds("d1", "scan_1.dat")] });
    expect(batchFolderOffer(useApp.getState, ["d1"], 1)).toBeNull();
  });

  it("does not qualify when the prefix is under 3 chars", () => {
    useApp.setState({ datasets: [ds("d1", "a1.dat"), ds("d2", "a2.dat")] });
    expect(batchFolderOffer(useApp.getState, ["d1", "d2"], 2)).toBeNull();
  });

  it("does not qualify when a created id no longer resolves to a live dataset (deleted mid-import)", () => {
    useApp.setState({ datasets: [ds("d1", "scan_1.dat")] }); // only 1 of 2 ids resolves
    expect(batchFolderOffer(useApp.getState, ["d1", "d2"], 2)).toBeNull();
  });

  // P2 review fix: the reviewer's exact negative case. A single Origin
  // project FILE fanning out to several books creates several DATASETS
  // whose names all share the SAME `${stem}:` prefix by construction — the
  // OLD guard (`datasets.length !== createdIds.length`) only caught a
  // dataset deleted mid-import, never this. `fileCount` (1, not 3) is what
  // actually distinguishes it from a real 3-plain-file batch below.
  it("does not qualify a single Origin file's book fan-out, even though the book names share a prefix", () => {
    useApp.setState({
      datasets: [ds("d1", "Moke:Book1"), ds("d2", "Moke:Book2"), ds("d3", "Moke:Book3")],
    });
    expect(batchFolderOffer(useApp.getState, ["d1", "d2", "d3"], 1)).toBeNull();
  });

  it("ignores extension when comparing stems", () => {
    useApp.setState({ datasets: [ds("d1", "run_a.xye"), ds("d2", "run_b.dat")] });
    expect(batchFolderOffer(useApp.getState, ["d1", "d2"], 2)?.prefix).toBe("run");
  });
});

describe("createFolderForBatch", () => {
  it("creates the folder under the target and moves member workbooks into it", () => {
    useApp.setState({
      folders: [],
      workbooks: [{ id: "w1", name: "W1" }, { id: "w2", name: "W2" }],
      datasets: [ds("d1", "a", "w1"), ds("d2", "b", "w2")],
    });
    createFolderForBatch(useApp.getState, "Batch", ["d1", "d2"], undefined);
    const s = useApp.getState();
    expect(s.folders).toHaveLength(1);
    const folder = s.folders[0];
    expect(folder.name).toBe("Batch");
    expect(folder.parentId).toBeNull();
    expect(s.workbooks.every((w) => w.folderId === folder.id)).toBe(true);
    expect(s.datasets.every((d) => d.folderId === folder.id)).toBe(true);
  });

  it("nests the new folder under the given target", () => {
    useApp.setState({
      folders: [{ id: "parent", name: "Parent", parentId: null, order: 0 } as FolderNode],
      workbooks: [{ id: "w1", name: "W1" } as WorkbookNode],
      datasets: [ds("d1", "a", "w1")],
    });
    createFolderForBatch(useApp.getState, "Batch", ["d1"], "parent");
    const newFolder = useApp.getState().folders.find((f) => f.id !== "parent")!;
    expect(newFolder.parentId).toBe("parent");
  });

  it("only moves workbooks that actually have members in the batch", () => {
    useApp.setState({
      folders: [],
      workbooks: [{ id: "w1", name: "W1" }, { id: "unrelated", name: "U" }],
      datasets: [ds("d1", "a", "w1")],
    });
    createFolderForBatch(useApp.getState, "Batch", ["d1"], undefined);
    const s = useApp.getState();
    expect(s.workbooks.find((w) => w.id === "unrelated")?.folderId).toBeUndefined();
  });
});
