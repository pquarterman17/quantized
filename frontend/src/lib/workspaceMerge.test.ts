import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import type { LoadedWorkspace } from "./workspace";
import { mergeWorkspace } from "./workspaceMerge";

// Moved out of workspace.test.ts alongside the RSM_CUTS_PLAN item 13
// extraction (mergeWorkspace -> lib/workspaceMerge.ts) — same tests,
// unchanged, now living beside the module they exercise.

function makeDataset(id: string, name: string): Dataset {
  return {
    id,
    name,
    data: {
      time: [0, 1, 2],
      values: [[10, 100], [20, 200], [30, 300]],
      labels: ["A", "B"],
      units: ["emu", "Oe"],
      metadata: { source: "test" },
    },
  };
}

describe("mergeWorkspace (MAIN_PLAN #16 — Append workspace)", () => {
  // A minimal LoadedWorkspace wrapper — mergeWorkspace only ever reads
  // `.datasets` (see its doc for why every other field is ignored).
  function asLoaded(datasets: Dataset[]): LoadedWorkspace {
    return {
      datasets,
      folders: [],
      workbooks: [],
      activeId: null,
      selectedIds: [],
      expandedFolders: [],
      originFigures: [],
      originFidelity: [],
      smartFolders: [],
      reports: [],
      macroSteps: [],
      recalcMode: "auto",
      figureDocs: [],
      editableFigures: [],
      pages: [],
      migrationWarnings: [],
      plotWindows: [],
      focusedWindowId: null,
      toolWindowLayout: {},
      savedPlotSpecs: [],
      techniqueViewMemory: {},
      savedRois: [],
    };
  }

  let idSeq = 0;
  const genId = () => `merged-${++idSeq}`;
  beforeEach(() => {
    idSeq = 0;
  });

  it("appends with no collisions: ids/names untouched, per-dataset fields ride along", () => {
    const current = [makeDataset("a", "first")];
    const incoming = makeDataset("b", "second");
    incoming.tags = ["MvsH"];
    incoming.notes = "sample notes";
    incoming.formulas = [{ name: "ratio", expr: "A/B" }];

    const result = mergeWorkspace(current, asLoaded([incoming]), genId);

    expect(result.datasets).toHaveLength(2);
    expect(result.datasets[0]).toBe(current[0]); // current is reused, not cloned
    expect(result.datasets[1].id).toBe("b");
    expect(result.datasets[1].name).toBe("second");
    expect(result.datasets[1].tags).toEqual(["MvsH"]);
    expect(result.datasets[1].notes).toBe("sample notes");
    expect(result.datasets[1].formulas).toEqual([{ name: "ratio", expr: "A/B" }]);
    expect(result.remapped).toBe(0);
    expect(result.renamed).toBe(0);
    expect(result.droppedBgRefs).toBe(0);
    expect(result.droppedFolderRefs).toBe(0);
    expect(result.droppedWorkbookRefs).toBe(0);
  });

  it("remaps an incoming dataset id that collides with a CURRENT id (existing dataset untouched)", () => {
    const current = [makeDataset("a", "first")];
    const incoming = makeDataset("a", "duplicate-id");

    const result = mergeWorkspace(current, asLoaded([incoming]), genId);

    expect(result.datasets[0]).toBe(current[0]); // existing "a" is untouched
    expect(result.datasets[1].id).toBe("merged-1"); // incoming "a" got a fresh id
    expect(result.datasets[1].name).toBe("duplicate-id");
    expect(result.remapped).toBe(1);
  });

  it("remaps incoming-vs-incoming id collisions too (a hand-edited/duplicated .dwk)", () => {
    const dup1 = makeDataset("x", "first-x");
    const dup2 = makeDataset("x", "second-x");

    const result = mergeWorkspace([], asLoaded([dup1, dup2]), genId);

    expect(result.datasets[0].id).toBe("x"); // first keeps the original id
    expect(result.datasets[1].id).toBe("merged-1"); // second gets remapped
    expect(result.remapped).toBe(1);
  });

  it("suffixes an incoming NAME collision Origin-style: ' (2)', ' (3)', …", () => {
    const current = [makeDataset("a", "sample")];
    const incoming = [makeDataset("b", "sample"), makeDataset("c", "sample")];

    const result = mergeWorkspace(current, asLoaded(incoming), genId);

    expect(result.datasets.map((d) => d.name)).toEqual(["sample", "sample (2)", "sample (3)"]);
    expect(result.renamed).toBe(2);
  });

  it("remaps a bgRef pointing at ANOTHER incoming dataset, including a forward reference", () => {
    // "data" (index 0) references "bg" (index 1) — a forward reference, the
    // case the two-pass id assignment exists to handle.
    const data = { ...makeDataset("data", "sample"), bgRef: { datasetId: "bg", interp: "pchip" } };
    const bg = makeDataset("bg", "background");

    const result = mergeWorkspace([], asLoaded([data, bg]), genId);

    const dataDs = result.datasets.find((d) => d.name === "sample")!;
    const bgDs = result.datasets.find((d) => d.name === "background")!;
    expect(dataDs.bgRef).toEqual({ datasetId: bgDs.id, interp: "pchip" });
    expect(result.droppedBgRefs).toBe(0);
  });

  it("remaps a bgRef to the target's REMAPPED id when the target's original id collides", () => {
    const current = [makeDataset("bg", "existing background")]; // occupies id "bg"
    const data = { ...makeDataset("data", "sample"), bgRef: { datasetId: "bg", interp: "linear" } };
    const bg = makeDataset("bg", "incoming background"); // collides -> remapped

    const result = mergeWorkspace(current, asLoaded([data, bg]), genId);

    const dataDs = result.datasets.find((d) => d.name === "sample")!;
    const bgDs = result.datasets.find((d) => d.name === "incoming background")!;
    expect(bgDs.id).not.toBe("bg");
    expect(dataDs.bgRef?.datasetId).toBe(bgDs.id);
    expect(result.remapped).toBe(1);
    expect(result.droppedBgRefs).toBe(0);
  });

  it("drops a bgRef targeting an id outside the incoming batch (counted, never crashes)", () => {
    const incoming = {
      ...makeDataset("a", "sample"),
      bgRef: { datasetId: "does-not-exist", interp: "linear" },
    };

    const result = mergeWorkspace([], asLoaded([incoming]), genId);

    expect(result.datasets[0].bgRef).toBeUndefined();
    expect(result.droppedBgRefs).toBe(1);
  });

  it("drops folderId on every incoming dataset — no folder tree is merged in (non-reference fields like order ride along)", () => {
    const incoming = { ...makeDataset("a", "in-folder"), folderId: "f1", order: 3 };

    const result = mergeWorkspace([], asLoaded([incoming]), genId);

    expect(result.datasets[0].folderId).toBeUndefined();
    expect(result.datasets[0].order).toBe(3);
    expect(result.droppedFolderRefs).toBe(1);
    expect(result.droppedWorkbookRefs).toBe(0);
  });

  // LIBRARY_WORKBOOK_UX_PLAN PR A2: real cross-project workbook transfer is
  // PR A4's contract — until then an appended dataset's workbookId is
  // stripped the same way folderId always has been (see workspaceMerge.ts's
  // header for the full reference-field matrix).
  it("strips workbookId on every incoming dataset — no workbook is merged in either (counted, not just folderId)", () => {
    const incoming = [
      { ...makeDataset("a", "in-workbook-1"), workbookId: "w1" },
      { ...makeDataset("b", "in-workbook-2"), workbookId: "w2" },
      makeDataset("c", "workbook-less"), // never had one
    ];

    const result = mergeWorkspace([], asLoaded(incoming), genId);

    expect(result.datasets.every((d) => d.workbookId === undefined)).toBe(true);
    expect(result.droppedWorkbookRefs).toBe(2); // "c" never had one to drop
    // No dangling reference anywhere — the field is simply absent, not
    // pointing at an id that resolves to nothing.
    expect(result.datasets.every((d) => !("workbookId" in d) || d.workbookId === undefined)).toBe(
      true,
    );
  });

  it("appending an empty incoming workspace is a no-op over current", () => {
    const current = [makeDataset("a", "first")];
    const result = mergeWorkspace(current, asLoaded([]), genId);
    expect(result.datasets).toEqual(current);
    expect(result.remapped).toBe(0);
    expect(result.renamed).toBe(0);
  });
});
