import { describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import { parseWorkspace, serializeWorkspace, WORKSPACE_FORMAT } from "./workspace";

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

// The dataset round-trip tests only care about the dataset payload; wrap/unwrap
// the v2 WorkspaceState shape so those assertions stay focused.
const ser = (datasets: Dataset[]) => serializeWorkspace({ datasets });
const parse = (text: string) => parseWorkspace(text).datasets;

describe("serializeWorkspace / parseWorkspace round-trip", () => {
  it("restores datasets identically", () => {
    const datasets = [makeDataset("a", "first"), makeDataset("b", "second")];
    const restored = parse(ser(datasets));
    expect(restored).toHaveLength(2);
    expect(restored[0].id).toBe("a");
    expect(restored[0].name).toBe("first");
    expect(restored[0].data).toEqual(datasets[0].data);
    expect(restored[1].data).toEqual(datasets[1].data);
  });

  it("preserves raw, corrections, and bgRef when present", () => {
    const ds = makeDataset("a", "corrected");
    ds.raw = makeDataset("a", "raw").data;
    ds.corrections = { xOff: 1.5, smoothEnabled: true, smoothWindow: 5 };
    ds.bgRef = { datasetId: "b", interp: "pchip" };
    const [restored] = parse(ser([ds]));
    expect(restored.raw).toEqual(ds.raw);
    expect(restored.corrections).toEqual(ds.corrections);
    expect(restored.bgRef).toEqual(ds.bgRef);
  });

  it("omits optional fields that were absent", () => {
    const [restored] = parse(ser([makeDataset("a", "bare")]));
    expect(restored.raw).toBeUndefined();
    expect(restored.corrections).toBeUndefined();
    expect(restored.bgRef).toBeUndefined();
    expect(restored.notes).toBeUndefined();
  });

  it("preserves dataset tags (and drops an empty tag list)", () => {
    const ds = makeDataset("a", "tagged");
    ds.tags = ["MvsH", "sample-A"];
    const [restored] = parse(ser([ds]));
    expect(restored.tags).toEqual(["MvsH", "sample-A"]);
    const bare = makeDataset("b", "bare");
    bare.tags = [];
    expect(parse(ser([bare]))[0].tags).toBeUndefined();
  });

  it("preserves a dataset group (and omits a blank one)", () => {
    const ds = makeDataset("a", "grouped");
    ds.group = "Cooldown 1";
    expect(parse(ser([ds]))[0].group).toBe("Cooldown 1");
    const bare = makeDataset("b", "bare");
    bare.group = "   ";
    expect(parse(ser([bare]))[0].group).toBeUndefined();
  });

  it("preserves folderId + order when the folder exists (and omits absent ones)", () => {
    const ds = { ...makeDataset("a", "in-folder"), folderId: "f1", order: 3 };
    const ws = parseWorkspace(
      serializeWorkspace({
        datasets: [ds],
        folders: [{ id: "f1", name: "F", parentId: null, order: 0 }],
      }),
    );
    expect(ws.datasets[0].folderId).toBe("f1");
    expect(ws.datasets[0].order).toBe(3);
    const [bare] = parse(ser([makeDataset("b", "root")]));
    expect(bare.folderId).toBeUndefined();
    expect(bare.order).toBeUndefined();
  });

  it("preserves dataset notes", () => {
    const ds = makeDataset("a", "noted");
    ds.notes = "5 K M-vs-H, second cooldown";
    const [restored] = parse(ser([ds]));
    expect(restored.notes).toBe(ds.notes);
  });

  it("preserves per-dataset column roles (filtering invalid entries)", () => {
    const ds = makeDataset("a", "roled");
    ds.channelRoles = { 0: "ignore", 1: "label" };
    const [restored] = parse(ser([ds]));
    expect(restored.channelRoles).toEqual({ 0: "ignore", 1: "label" });
    const doc = JSON.parse(ser([ds]));
    doc.datasets[0].channelRoles = { 0: "ignore", 2: "bogus" };
    expect(parse(JSON.stringify(doc))[0].channelRoles).toEqual({ 0: "ignore" });
  });

  it("preserves computed-column formulas (and drops malformed entries)", () => {
    const ds = makeDataset("a", "computed");
    ds.formulas = [{ name: "S", expr: "A + B" }];
    const [restored] = parse(ser([ds]));
    expect(restored.formulas).toEqual([{ name: "S", expr: "A + B" }]);
    const doc = JSON.parse(ser([ds]));
    doc.datasets[0].formulas = [{ name: "ok", expr: "A" }, { name: 5 }];
    expect(parse(JSON.stringify(doc))[0].formulas).toEqual([{ name: "ok", expr: "A" }]);
  });

  it("preserves excluded rows (#50) and clamps out-of-range indices on load", () => {
    const ds = makeDataset("a", "with-exclusions");
    ds.excludedRows = [0, 2];
    const [restored] = parse(ser([ds]));
    expect(restored.excludedRows).toEqual([0, 2]);
    const bare = makeDataset("b", "bare");
    bare.excludedRows = [];
    expect(parse(ser([bare]))[0].excludedRows).toBeUndefined();
    const doc = JSON.parse(ser([ds]));
    doc.datasets[0].excludedRows = [1, 99, -1];
    expect(parse(JSON.stringify(doc))[0].excludedRows).toEqual([1]);
  });

  it("preserves a data filter (#53) and drops predicates with a bad column on load", () => {
    const ds = makeDataset("a", "filtered");
    ds.filter = [
      { col: 1, kind: "range", min: 100, max: 300 },
      { col: 0, kind: "set", values: [10, 30] },
    ];
    const [restored] = parse(ser([ds]));
    expect(restored.filter).toEqual(ds.filter);
    const doc = JSON.parse(ser([ds]));
    doc.datasets[0].filter = [{ col: 9, kind: "range", min: 1 }];
    expect(parse(JSON.stringify(doc))[0].filter).toBeUndefined();
  });

  it("writes the format tag and version", () => {
    const doc = JSON.parse(ser([makeDataset("a", "x")]));
    expect(doc.format).toBe(WORKSPACE_FORMAT);
    expect(doc.version).toBe(2);
    expect(typeof doc.savedAt).toBe("string");
  });
});

describe("workspace v2 folder tree", () => {
  it("round-trips the folder tree, active/selection, and expansion", () => {
    const a = { ...makeDataset("a", "in-f1"), folderId: "f1", order: 0 };
    const b = makeDataset("b", "root");
    const ws = parseWorkspace(
      serializeWorkspace({
        datasets: [a, b],
        folders: [
          { id: "f1", name: "XRD", parentId: null, order: 0 },
          { id: "f1a", name: "2024", parentId: "f1", order: 0 },
        ],
        activeId: "b",
        selectedIds: ["a", "b"],
        expandedFolders: ["f1"],
      }),
    );
    expect(ws.folders.map((f) => f.id)).toEqual(["f1", "f1a"]);
    expect(ws.datasets.find((d) => d.id === "a")!.folderId).toBe("f1");
    expect(ws.activeId).toBe("b");
    expect(ws.selectedIds).toEqual(["a", "b"]);
    expect(ws.expandedFolders).toEqual(["f1"]);
  });

  it("prunes a dataset whose folderId points at a missing folder (→ root)", () => {
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 2,
      datasets: [{ ...makeDataset("a", "x"), folderId: "ghost" }],
      folders: [],
    };
    const ws = parseWorkspace(JSON.stringify(doc));
    expect(ws.datasets[0].folderId).toBeUndefined();
  });

  it("reparents a folder whose parent is missing to the root", () => {
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 2,
      datasets: [],
      folders: [{ id: "f2", name: "orphan", parentId: "gone", order: 0 }],
    };
    const ws = parseWorkspace(JSON.stringify(doc));
    expect(ws.folders[0].parentId).toBe(null);
  });

  it("clamps a stale activeId / selection to live dataset ids", () => {
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 2,
      datasets: [makeDataset("a", "x")],
      folders: [],
      activeId: "gone",
      selectedIds: ["a", "gone"],
    };
    const ws = parseWorkspace(JSON.stringify(doc));
    expect(ws.activeId).toBe("a"); // fell back to the first dataset
    expect(ws.selectedIds).toEqual(["a"]);
  });
});

describe("parseWorkspace validation + v1 migration", () => {
  it("rejects non-JSON", () => {
    expect(() => parseWorkspace("not json {{{")).toThrow(/bad JSON/);
  });

  it("rejects a JSON document with the wrong format tag", () => {
    expect(() =>
      parseWorkspace(JSON.stringify({ format: "something-else", version: 1, datasets: [] })),
    ).toThrow(/not a quantized workspace/);
  });

  it("rejects an unsupported version", () => {
    expect(() =>
      parseWorkspace(JSON.stringify({ format: WORKSPACE_FORMAT, version: 99, datasets: [] })),
    ).toThrow(/unsupported workspace version/);
  });

  it("rejects when datasets is missing", () => {
    expect(() => parseWorkspace(JSON.stringify({ format: WORKSPACE_FORMAT, version: 1 }))).toThrow(
      /no datasets/,
    );
  });

  it("rejects a dataset with an invalid data structure", () => {
    const bad = {
      format: WORKSPACE_FORMAT,
      version: 1,
      datasets: [{ id: "a", name: "broken", data: { time: "nope", values: [], labels: [], units: [] } }],
    };
    expect(() => parseWorkspace(JSON.stringify(bad))).toThrow(/invalid data structure/);
  });

  it("migrates a v1 document (datasets only) to an empty folder tree", () => {
    const v1 = {
      format: WORKSPACE_FORMAT,
      version: 1,
      datasets: [makeDataset("a", "legacy"), makeDataset("b", "legacy2")],
    };
    const ws = parseWorkspace(JSON.stringify(v1));
    expect(ws.datasets.map((d) => d.id)).toEqual(["a", "b"]);
    expect(ws.folders).toEqual([]);
    expect(ws.activeId).toBe("a"); // first dataset active by default
    expect(ws.expandedFolders).toEqual([]);
  });

  it("accepts an empty workspace", () => {
    const ws = parseWorkspace(JSON.stringify({ format: WORKSPACE_FORMAT, version: 2, datasets: [] }));
    expect(ws.datasets).toEqual([]);
    expect(ws.activeId).toBe(null);
  });
});

describe("workspace channel modeling types", () => {
  it("preserves per-dataset type overrides (filtering invalid entries)", () => {
    const ds = makeDataset("a", "typed");
    ds.channelTypes = { 0: "nominal", 1: "ordinal" };
    const [restored] = parse(ser([ds]));
    expect(restored.channelTypes).toEqual({ 0: "nominal", 1: "ordinal" });
    const doc = JSON.parse(ser([ds]));
    doc.datasets[0].channelTypes = { 0: "continuous", 2: "bogus" };
    expect(parse(JSON.stringify(doc))[0].channelTypes).toEqual({ 0: "continuous" });
  });
});
