import { beforeEach, describe, expect, it } from "vitest";

import type { OriginFigureEntry } from "./originFigures";
import type { FrozenPlotBundle } from "./plotsnapshot";
import { defaultPlotView, type PlotWindow } from "./plotview";
import type { ReportEntry } from "./report";
import type { Dataset, OriginFigure } from "./types";
import {
  mergeWorkspace,
  parseWorkspace,
  serializeWorkspace,
  WORKSPACE_FORMAT,
  type LoadedWorkspace,
} from "./workspace";

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

  it("preserves the full fit-spec recipe + snapshot (audit P1 #3)", () => {
    const ds = makeDataset("a", "fit");
    ds.fitSpec = { model: "Linear", xKey: 0, yKey: 1, params: [2, 0.5], exitFlag: 1 };
    expect(parse(ser([ds]))[0].fitSpec).toEqual({
      model: "Linear",
      xKey: 0,
      yKey: 1,
      params: [2, 0.5],
      exitFlag: 1,
    });
    // A legacy v1 {model} spec still round-trips untouched.
    const legacy = makeDataset("b", "legacy");
    legacy.fitSpec = { model: "Gauss" };
    expect(parse(ser([legacy]))[0].fitSpec).toEqual({ model: "Gauss" });
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
    expect(doc.version).toBe(3); // v3 (gap #5): pipeline + recalc mode + fit specs
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

// Origin-import figures (project-organization plan item 5): a graph imported
// from an .opj/.opju must survive save→reload. Before v2 carried them, a
// reload silently dropped every figure (`useApp.loadWorkspace` reset the slot).
const originFig = (overrides: Partial<OriginFigure> = {}): OriginFigure => ({
  name: "Graph1",
  x_from: 0,
  x_to: 100,
  x_log: false,
  y_from: 1,
  y_to: 1e6,
  y_log: true,
  n_curves: 1,
  annotations: [],
  ...overrides,
});
const figEntry = (over: Partial<OriginFigureEntry> = {}): OriginFigureEntry => ({
  id: "f1",
  stem: "Moke",
  figure: originFig(),
  datasetId: "a",
  siblingIds: ["a", "b"],
  ...over,
});

describe("workspace originFigures persistence", () => {
  it("round-trips figures attached to surviving datasets", () => {
    const datasets = [makeDataset("a", "first"), makeDataset("b", "second")];
    const entry = figEntry();
    const loaded = parseWorkspace(serializeWorkspace({ datasets, originFigures: [entry] }));
    expect(loaded.originFigures).toHaveLength(1);
    expect(loaded.originFigures[0]).toEqual(entry);
    expect(loaded.originFigures[0].figure).toEqual(originFig());
  });

  it("clamps a dangling datasetId to null and prunes dead siblingIds", () => {
    // Figure references dataset "gone", which is not in the library on reload.
    const datasets = [makeDataset("a", "first")];
    const entry = figEntry({ datasetId: "gone", siblingIds: ["a", "gone"] });
    const loaded = parseWorkspace(serializeWorkspace({ datasets, originFigures: [entry] }));
    expect(loaded.originFigures[0].datasetId).toBeNull();
    expect(loaded.originFigures[0].siblingIds).toEqual(["a"]);
  });

  it("keeps a legitimately-unbound (null) figure and defaults missing siblingIds", () => {
    const datasets = [makeDataset("a", "first")];
    const doc = JSON.parse(serializeWorkspace({ datasets }));
    doc.originFigures = [{ id: "f2", stem: "x", figure: originFig(), datasetId: null }];
    const loaded = parseWorkspace(JSON.stringify(doc));
    expect(loaded.originFigures[0].datasetId).toBeNull();
    expect(loaded.originFigures[0].siblingIds).toEqual([]);
  });

  it("drops malformed figure entries", () => {
    const datasets = [makeDataset("a", "first")];
    const doc = JSON.parse(serializeWorkspace({ datasets }));
    doc.originFigures = [
      { id: "ok", stem: "s", figure: {}, datasetId: "a", siblingIds: [] },
      null,
      { id: 5, stem: "s", figure: {} }, // id not a string
      { id: "nofig", stem: "s", datasetId: "a" }, // no figure
      { id: "badfig", stem: "s", figure: "nope", datasetId: null }, // figure not an object
    ];
    const loaded = parseWorkspace(JSON.stringify(doc));
    expect(loaded.originFigures.map((f) => f.id)).toEqual(["ok"]);
  });

  it("defaults to an empty array for a v1 doc (no originFigures field)", () => {
    const datasets = [makeDataset("a", "first")];
    const doc = JSON.parse(serializeWorkspace({ datasets }));
    doc.version = 1;
    delete doc.originFigures;
    delete doc.folders;
    const loaded = parseWorkspace(JSON.stringify(doc));
    expect(loaded.originFigures).toEqual([]);
  });
});

describe("workspace report persistence (#36)", () => {
  const repEntry = (over: Partial<ReportEntry> = {}): ReportEntry => ({
    id: "rep-1",
    name: "Linear fit — first",
    datasetId: "a",
    report: {
      title: "Linear fit — first",
      sections: [
        {
          title: "Fit results",
          blocks: [
            { type: "text", text: "Model: Linear" },
            { type: "params", params: [{ name: "slope", value: 2, error: 0.1 }] },
          ],
        },
      ],
      created: "2026-07-07T00:00:00+00:00",
    },
    ...over,
  });

  it("round-trips a report attached to a surviving dataset", () => {
    const datasets = [makeDataset("a", "first")];
    const loaded = parseWorkspace(serializeWorkspace({ datasets, reports: [repEntry()] }));
    expect(loaded.reports).toHaveLength(1);
    expect(loaded.reports[0]).toEqual(repEntry());
  });

  it("keeps the report but clamps a dangling datasetId to null", () => {
    const datasets = [makeDataset("a", "first")];
    const loaded = parseWorkspace(
      serializeWorkspace({ datasets, reports: [repEntry({ datasetId: "gone" })] }),
    );
    expect(loaded.reports).toHaveLength(1);
    expect(loaded.reports[0].datasetId).toBeNull();
  });

  it("drops malformed report entries (invalid sheet) and defaults absent field", () => {
    const datasets = [makeDataset("a", "first")];
    const doc = JSON.parse(serializeWorkspace({ datasets }));
    expect(doc.reports).toEqual([]); // serialized default
    doc.reports = [
      repEntry(),
      { id: "bad", name: "x", datasetId: null, report: { title: 7, sections: [] } },
      null,
    ];
    const loaded = parseWorkspace(JSON.stringify(doc));
    expect(loaded.reports.map((r) => r.id)).toEqual(["rep-1"]);
    // v1/older docs without a reports key parse to an empty list
    delete doc.reports;
    expect(parseWorkspace(JSON.stringify(doc)).reports).toEqual([]);
  });
});

describe("workspace pending lazy-book reference (ORIGIN_FILE_DECODE_PLAN #38)", () => {
  it("round-trips a pending dataset's BookSource (path-sourced)", () => {
    const ds = makeDataset("a", "lazy book");
    ds.pending = { kind: "path", path: "/data/PNR.opj", bookId: "Book2", rows: 5000, cols: 4 };
    const [restored] = parse(ser([ds]));
    expect(restored.pending).toEqual(ds.pending);
  });

  it("round-trips a pending dataset's BookSource (upload-sourced)", () => {
    const ds = makeDataset("a", "lazy book");
    ds.pending = { kind: "upload", token: "abc123", bookId: "Book2", rows: 5000, cols: 4 };
    const [restored] = parse(ser([ds]));
    expect(restored.pending).toEqual(ds.pending);
  });

  it("omits pending when absent (the normal, fully-resolved case)", () => {
    const [restored] = parse(ser([makeDataset("a", "normal")]));
    expect(restored.pending).toBeUndefined();
    expect(ser([makeDataset("a", "normal")])).not.toContain("pending");
  });

  it("drops a malformed pending ref rather than restoring garbage", () => {
    // Deliberately malformed payloads (missing/wrong-typed fields) — loosely
    // typed (`pending: unknown`) since a real BookSource can't express them.
    const doc = JSON.parse(ser([makeDataset("a", "x")])) as {
      datasets: (Omit<Dataset, "pending"> & { pending?: unknown })[];
    };
    // missing bookId
    doc.datasets[0].pending = { kind: "path", path: "/p.opj", rows: 1, cols: 1 };
    expect(parseWorkspace(JSON.stringify(doc)).datasets[0].pending).toBeUndefined();
    // kind "path" but no path string
    doc.datasets[0].pending = { kind: "path", bookId: "B1", rows: 1, cols: 1 };
    expect(parseWorkspace(JSON.stringify(doc)).datasets[0].pending).toBeUndefined();
    // kind "upload" but no token string
    doc.datasets[0].pending = { kind: "upload", bookId: "B1", rows: 1, cols: 1 };
    expect(parseWorkspace(JSON.stringify(doc)).datasets[0].pending).toBeUndefined();
    // unknown kind
    doc.datasets[0].pending = { kind: "carrier-pigeon", bookId: "B1" };
    expect(parseWorkspace(JSON.stringify(doc)).datasets[0].pending).toBeUndefined();
  });

  it("defaults rows/cols to 0 when a legacy/hand-edited pending omits them", () => {
    const doc = JSON.parse(ser([makeDataset("a", "x")])) as {
      datasets: (Omit<Dataset, "pending"> & { pending?: unknown })[];
    };
    doc.datasets[0].pending = { kind: "path", path: "/p.opj", bookId: "B1" };
    const restored = parseWorkspace(JSON.stringify(doc)).datasets[0].pending;
    expect(restored).toEqual({ kind: "path", path: "/p.opj", bookId: "B1", rows: 0, cols: 0 });
  });
});

describe("workspace source reference (MAIN_PLAN #10, re-import from source)", () => {
  it("round-trips a dataset's source path", () => {
    const ds = makeDataset("a", "x");
    ds.source = { kind: "path", path: "/data/sample.dat" };
    const restored = parse(ser([ds]))[0];
    expect(restored.source).toEqual(ds.source);
  });

  it("omits source when absent (a browser upload never has one)", () => {
    const restored = parse(ser([makeDataset("a", "normal")]))[0];
    expect(restored.source).toBeUndefined();
    const doc = JSON.parse(ser([makeDataset("a", "normal")])) as { datasets: Record<string, unknown>[] };
    expect("source" in doc.datasets[0]).toBe(false);
  });

  it("drops a malformed source rather than restoring garbage", () => {
    const doc = JSON.parse(ser([makeDataset("a", "x")])) as {
      datasets: (Omit<Dataset, "source"> & { source?: unknown })[];
    };
    doc.datasets[0].source = { kind: "upload" }; // wrong kind
    expect(parseWorkspace(JSON.stringify(doc)).datasets[0].source).toBeUndefined();

    doc.datasets[0].source = { kind: "path" }; // missing path
    expect(parseWorkspace(JSON.stringify(doc)).datasets[0].source).toBeUndefined();

    doc.datasets[0].source = { kind: "path", path: "" }; // empty path
    expect(parseWorkspace(JSON.stringify(doc)).datasets[0].source).toBeUndefined();
  });
});

describe("workspace v3 (gap #5): pipeline + recalc mode + fit specs", () => {
  it("round-trips the typed pipeline, recalc mode, and per-dataset fit specs", () => {
    const datasets = [makeDataset("a", "first")];
    (datasets[0] as { fitSpec?: { model: string } }).fitSpec = { model: "Gaussian" };
    const steps = [
      {
        id: "step-1",
        kind: "expression" as const,
        label: "Add column r",
        code: 'qz.addColumn("r", "A * 2")',
        params: { name: "r", expr: "A * 2" },
        enabled: false,
      },
    ];
    const loaded = parseWorkspace(
      serializeWorkspace({ datasets, macroSteps: steps, recalcMode: "manual" }),
    );
    expect(loaded.recalcMode).toBe("manual");
    expect(loaded.macroSteps).toHaveLength(1);
    expect(loaded.macroSteps[0].kind).toBe("expression");
    expect(loaded.macroSteps[0].params).toEqual({ name: "r", expr: "A * 2" });
    expect(loaded.macroSteps[0].enabled).toBe(false);
    expect(loaded.datasets[0].fitSpec).toEqual({ model: "Gaussian" });
  });

  it("v1/v2 docs load with safe defaults (empty pipeline, auto mode)", () => {
    const doc = JSON.parse(serializeWorkspace({ datasets: [makeDataset("a", "x")] }));
    doc.version = 2;
    delete doc.pipeline;
    delete doc.recalcMode;
    const loaded = parseWorkspace(JSON.stringify(doc));
    expect(loaded.macroSteps).toEqual([]);
    expect(loaded.recalcMode).toBe("auto");
  });

  it("drops malformed persisted steps and invalid fit specs", () => {
    const doc = JSON.parse(serializeWorkspace({ datasets: [makeDataset("a", "x")] }));
    doc.pipeline = [{ kind: "alien" }, null, {
      id: "s", kind: "ui", label: "ok", code: "qz.x()", params: {},
    }];
    doc.datasets[0].fitSpec = { model: 7 };
    const loaded = parseWorkspace(JSON.stringify(doc));
    expect(loaded.macroSteps.map((s) => s.label)).toEqual(["ok"]);
    expect(loaded.datasets[0].fitSpec).toBeUndefined();
  });
});

describe("workspace figure documents (#12)", () => {
  it("round-trips docs and clamps a dead dataset ref (frozen keeps its snapshot)", () => {
    const datasets = [makeDataset("a", "first")];
    const config = {
      xKey: null, yKeys: [0], xScale: "linear" as const, yScale: "log" as const, title: "t",
      xLabel: "", yLabel: "", style: "aps", fmt: "pdf", dpi: 300,
      overrides: { font_size: 9 }, seriesStyles: null,
    };
    const docs = [
      { id: "f1", name: "live", datasetId: "a", live: true, config },
      { id: "f2", name: "frozen", datasetId: "gone", live: false, config,
        dataSnapshot: datasets[0].data },
    ];
    const loaded = parseWorkspace(
      serializeWorkspace({ datasets, figureDocs: docs as never }),
    );
    expect(loaded.figureDocs).toHaveLength(2);
    expect(loaded.figureDocs[0].datasetId).toBe("a");
    expect(loaded.figureDocs[1].datasetId).toBeNull();
    expect(loaded.figureDocs[1].dataSnapshot).toEqual(datasets[0].data);
  });
});

describe("workspace smart folders (org #9)", () => {
  it("round-trips saved queries (additive-optional — no version bump)", () => {
    const datasets = [makeDataset("a", "first")];
    const smartFolders = [
      { id: "s1", name: "Loops", query: "tag:mvsh" },
      { id: "s2", name: "QD data", query: "format:qd" },
    ];
    const loaded = parseWorkspace(serializeWorkspace({ datasets, smartFolders }));
    expect(loaded.smartFolders).toEqual(smartFolders);
  });

  it("sanitizes malformed entries on load and defaults to [] for older docs", () => {
    const datasets = [makeDataset("a", "first")];
    const doc = JSON.parse(serializeWorkspace({ datasets })) as Record<string, unknown>;
    doc.smartFolders = [{ id: "ok", name: "Fine", query: "" }, { id: 7, name: "bad" }, "junk"];
    expect(parseWorkspace(JSON.stringify(doc)).smartFolders).toEqual([
      { id: "ok", name: "Fine", query: "" },
    ]);
    delete doc.smartFolders; // a pre-#9 v3 doc
    expect(parseWorkspace(JSON.stringify(doc)).smartFolders).toEqual([]);
  });
});

describe("workspace plot windows (MULTI_PLOT_PLAN item 7 — additive-optional, no version bump)", () => {
  const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
    id: "w1",
    kind: "plot",
    title: "My Graph",
    datasetId: "a",
    geometry: { x: 10, y: 20, w: 480, h: 360 },
    z: 1,
    winState: "normal",
    view: { ...defaultPlotView(), yScale: "log", plotTitle: "restored view" },
    bg: "theme",
    linkGroup: null,
    pinned: false,
    ...over,
  });

  it("round-trips a window layout and the focused window id", () => {
    const datasets = [makeDataset("a", "first")];
    const plotWindows = [win({ id: "w1" }), win({ id: "w2", z: 2 })];
    const loaded = parseWorkspace(serializeWorkspace({ datasets, plotWindows, focusedWindowId: "w2" }));
    expect(loaded.plotWindows).toHaveLength(2);
    expect(loaded.plotWindows[0].title).toBe("My Graph");
    expect(loaded.plotWindows[0].view.yScale).toBe("log");
    expect(loaded.plotWindows[0].view.plotTitle).toBe("restored view");
    expect(loaded.focusedWindowId).toBe("w2");
  });

  it("clamps a window's dangling dataset ref to null (never drops the window itself)", () => {
    const datasets = [makeDataset("a", "first")];
    const loaded = parseWorkspace(
      serializeWorkspace({ datasets, plotWindows: [win({ id: "w1", datasetId: "gone" })], focusedWindowId: "w1" }),
    );
    expect(loaded.plotWindows).toHaveLength(1);
    expect(loaded.plotWindows[0].datasetId).toBeNull();
  });

  it("clamps a focusedWindowId that doesn't match any surviving window to null", () => {
    const datasets = [makeDataset("a", "first")];
    const doc = JSON.parse(
      serializeWorkspace({ datasets, plotWindows: [win({ id: "w1" })], focusedWindowId: "w1" }),
    ) as Record<string, unknown>;
    doc.focusedWindowId = "ghost";
    expect(parseWorkspace(JSON.stringify(doc)).focusedWindowId).toBeNull();
  });

  it("defaults to an empty layout + null focus for a pre-item-7 doc (no plotWindows field)", () => {
    const datasets = [makeDataset("a", "first")];
    const loaded = parseWorkspace(serializeWorkspace({ datasets }));
    expect(loaded.plotWindows).toEqual([]);
    expect(loaded.focusedWindowId).toBeNull();
  });

  it("drops a malformed window entry without throwing", () => {
    const datasets = [makeDataset("a", "first")];
    const doc = JSON.parse(
      serializeWorkspace({ datasets, plotWindows: [win({ id: "w1" })], focusedWindowId: "w1" }),
    ) as Record<string, unknown>;
    doc.plotWindows = [win({ id: "w1" }), { id: "bad" }, null, "nope"];
    expect(parseWorkspace(JSON.stringify(doc)).plotWindows).toHaveLength(1);
  });

  it("round-trips a window's linkGroup and defaults it to null for a pre-item-13 doc (item 13)", () => {
    const datasets = [makeDataset("a", "first")];
    const loaded = parseWorkspace(
      serializeWorkspace({
        datasets,
        plotWindows: [win({ id: "w1", linkGroup: 2 }), win({ id: "w2" })],
        focusedWindowId: "w1",
      }),
    );
    expect(loaded.plotWindows[0].linkGroup).toBe(2);
    expect(loaded.plotWindows[1].linkGroup).toBeNull();

    // A doc saved before item 13 has no linkGroup field at all — loads unlinked.
    const doc = JSON.parse(
      serializeWorkspace({ datasets, plotWindows: [win({ id: "w1" })], focusedWindowId: "w1" }),
    ) as Record<string, unknown>;
    (doc.plotWindows as Record<string, unknown>[]).forEach((w) => delete w.linkGroup);
    expect(parseWorkspace(JSON.stringify(doc)).plotWindows[0].linkGroup).toBeNull();
  });

  it("round-trips a kind:'snapshot' window with its frozen bundle (item 11)", () => {
    const datasets = [makeDataset("a", "first")];
    const snapshot: FrozenPlotBundle = {
      payload: {
        data: [
          [0, 1],
          [10, null],
        ] as FrozenPlotBundle["payload"]["data"],
        series: [{ label: "m", unit: "emu" }],
        xLabel: "t",
        xUnit: "s",
      },
      styleList: [{ color: "#ff0000" }, null],
      labelList: ["moment", null],
      errorBars: [[1, [0.1, null]]],
      plotted: [0],
      colorByColumns: [],
      hidden: [false],
    };
    const plotWindows = [
      win({ id: "w1" }),
      win({ id: "s1", kind: "snapshot", datasetId: null, title: "Snapshot — first", snapshot }),
    ];
    const loaded = parseWorkspace(serializeWorkspace({ datasets, plotWindows, focusedWindowId: "w1" }));
    expect(loaded.plotWindows).toHaveLength(2);
    const s1 = loaded.plotWindows.find((w) => w.id === "s1")!;
    expect(s1.kind).toBe("snapshot");
    expect(s1.snapshot).toEqual(snapshot);
    expect(s1.datasetId).toBeNull();
  });

  it("clamps a focusedWindowId pointing at a snapshot window to null (item 11 — snapshots never hold focus)", () => {
    const datasets = [makeDataset("a", "first")];
    const snapshot: FrozenPlotBundle = {
      payload: {
        data: [[0], [1]] as FrozenPlotBundle["payload"]["data"],
        series: [{ label: "m", unit: "" }],
        xLabel: "x",
        xUnit: "",
      },
      styleList: null,
      labelList: null,
      errorBars: [],
      plotted: [],
      colorByColumns: [],
      hidden: null,
    };
    const plotWindows = [
      win({ id: "w1" }),
      win({ id: "s1", kind: "snapshot", datasetId: null, snapshot }),
    ];
    const loaded = parseWorkspace(serializeWorkspace({ datasets, plotWindows, focusedWindowId: "s1" }));
    expect(loaded.focusedWindowId).toBeNull(); // the store's load path falls back to a plot window
  });

  it("drops a snapshot window whose frozen bundle is missing/malformed — plot siblings survive", () => {
    const datasets = [makeDataset("a", "first")];
    const doc = JSON.parse(
      serializeWorkspace({ datasets, plotWindows: [win({ id: "w1" })], focusedWindowId: "w1" }),
    ) as Record<string, unknown>;
    doc.plotWindows = [win({ id: "w1" }), win({ id: "s1", kind: "snapshot" })]; // no bundle
    expect(parseWorkspace(JSON.stringify(doc)).plotWindows.map((w) => w.id)).toEqual(["w1"]);
  });

  it("round-trips the per-window pin flag; a pre-item-14 doc defaults it to false", () => {
    const datasets = [makeDataset("a", "first")];
    const loaded = parseWorkspace(
      serializeWorkspace({
        datasets,
        plotWindows: [win({ id: "w1", pinned: true }), win({ id: "w2" })],
        focusedWindowId: "w1",
      }),
    );
    expect(loaded.plotWindows.map((w) => w.pinned)).toEqual([true, false]);

    // A doc saved before item 14 has no `pinned` field at all → false.
    const doc = JSON.parse(
      serializeWorkspace({ datasets, plotWindows: [win({ id: "w1" })], focusedWindowId: "w1" }),
    ) as { plotWindows: Record<string, unknown>[] };
    delete doc.plotWindows[0].pinned;
    expect(parseWorkspace(JSON.stringify(doc)).plotWindows[0].pinned).toBe(false);
  });

  it("round-trips worksheet/map document windows with their LIVE dataset binding (item 17)", () => {
    const datasets = [makeDataset("a", "first")];
    const plotWindows = [
      win({ id: "w1" }),
      win({ id: "ws1", kind: "worksheet", title: "first" }),
      win({ id: "m1", kind: "map", title: "first (2)" }),
    ];
    const loaded = parseWorkspace(serializeWorkspace({ datasets, plotWindows, focusedWindowId: "w1" }));
    expect(loaded.plotWindows.map((w) => w.kind)).toEqual(["plot", "worksheet", "map"]);
    // Live documents keep their binding (unlike snapshots) — and a dead ref
    // clamps to null instead of dropping the window (decision #4).
    expect(loaded.plotWindows.map((w) => w.datasetId)).toEqual(["a", "a", "a"]);
    const dead = parseWorkspace(
      serializeWorkspace({
        datasets,
        plotWindows: [win({ id: "w1" }), win({ id: "ws1", kind: "worksheet", datasetId: "gone" })],
        focusedWindowId: "w1",
      }),
    );
    expect(dead.plotWindows[1].datasetId).toBeNull();
  });

  it("clamps a focusedWindowId pointing at a document window to null (item 17 — only plot windows hold focus)", () => {
    const datasets = [makeDataset("a", "first")];
    const plotWindows = [win({ id: "w1" }), win({ id: "ws1", kind: "worksheet" })];
    const loaded = parseWorkspace(serializeWorkspace({ datasets, plotWindows, focusedWindowId: "ws1" }));
    expect(loaded.focusedWindowId).toBeNull(); // the store's load path falls back to a plot window
  });
});

describe("mergeWorkspace (MAIN_PLAN #16 — Append workspace)", () => {
  // A minimal LoadedWorkspace wrapper — mergeWorkspace only ever reads
  // `.datasets` (see its doc for why every other field is ignored).
  function asLoaded(datasets: Dataset[]): LoadedWorkspace {
    return {
      datasets,
      folders: [],
      activeId: null,
      selectedIds: [],
      expandedFolders: [],
      originFigures: [],
      smartFolders: [],
      reports: [],
      macroSteps: [],
      recalcMode: "auto",
      figureDocs: [],
      plotWindows: [],
      focusedWindowId: null,
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
  });

  it("appending an empty incoming workspace is a no-op over current", () => {
    const current = [makeDataset("a", "first")];
    const result = mergeWorkspace(current, asLoaded([]), genId);
    expect(result.datasets).toEqual(current);
    expect(result.remapped).toBe(0);
    expect(result.renamed).toBe(0);
  });
});
