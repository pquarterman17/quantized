import { describe, expect, it } from "vitest";

import type { FigureDocument } from "./figureDocument";
import type { QuickPlotTemplate } from "./quickPlotTemplates";
import type { ReportEntry } from "./report";
import type { Dataset } from "./types";
import type { WorkbookNode } from "./workbooks";
import {
  buildTransferPackage,
  MAX_TRANSFER_PACKAGE_CHARS,
  parseTransferPackage,
  pasteTransferPackage,
  WORKBOOK_TRANSFER_FORMAT,
  WORKBOOK_TRANSFER_VERSION,
  type TransferExistingIds,
  type TransferIdGenerators,
  type TransferSourceState,
  type WorkbookTransferPackage,
} from "./workbookTransfer";

function ds(id: string, name: string, over: Partial<Dataset> = {}): Dataset {
  return {
    id,
    name,
    data: { time: [0, 1], values: [[1, 2]], labels: ["A"], units: [""], metadata: {} },
    ...over,
  };
}

function wb(id: string, name: string, over: Partial<WorkbookNode> = {}): WorkbookNode {
  return { id, name, ...over };
}

function figure(id: string, datasetId: string | null): FigureDocument {
  return {
    version: 2,
    id,
    name: "fig",
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    bindings: {
      datasetId,
      xKey: null,
      yKeys: null,
      y2Keys: null,
      groupKey: null,
      facetKey: null,
      errors: [],
    },
    view: {
      kind: "plot",
      xAuto: true,
      yAuto: true,
      xLog: false,
      yLog: false,
      overlays: {},
      style: {},
      annotations: [],
      shapes: [],
      legend: { visible: true, position: "auto" },
    },
    data: { mode: "live" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function report(id: string, datasetId: string | null): ReportEntry {
  return { id, name: "report", datasetId, report: { text: "x", sections: [] } } as unknown as ReportEntry;
}

function template(id: string, workbookId: string): QuickPlotTemplate {
  return {
    id,
    name: "tpl",
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    scope: { kind: "workbook", workbookId },
    technique: "generic",
    signature: { channels: [] },
    mapping: { xKey: null, yKeys: [], errorBindings: [], ignoredKeys: [] },
    style: "line",
    labels: {},
  };
}

function makeState(over: Partial<TransferSourceState> = {}): TransferSourceState {
  return {
    workbooks: [wb("wb-1", "Book 1")],
    datasets: [ds("ds-1", "Sheet 1", { workbookId: "wb-1" })],
    editableFigures: [],
    reports: [],
    quickPlotTemplates: [],
    ...over,
  };
}

describe("buildTransferPackage", () => {
  it("refuses when the workbook does not exist", () => {
    const result = buildTransferPackage("missing", makeState());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not found/);
  });

  it("refuses an empty (memberless) workbook", () => {
    const state = makeState({ workbooks: [wb("wb-1", "Book 1")], datasets: [] });
    const result = buildTransferPackage("wb-1", state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no worksheets/);
  });

  it("refuses a workbook with a pending (not-yet-loaded) worksheet", () => {
    const state = makeState({
      datasets: [ds("ds-1", "Sheet 1", { workbookId: "wb-1", pending: { kind: "upload", token: "t", bookId: "b", rows: 0, cols: 0 } })],
    });
    const result = buildTransferPackage("wb-1", state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not fully loaded/);
  });

  it("includes only worksheets, figures, reports, and templates that belong to the workbook", () => {
    const state = makeState({
      workbooks: [wb("wb-1", "Book 1"), wb("wb-2", "Book 2")],
      datasets: [
        ds("ds-1", "Sheet 1", { workbookId: "wb-1" }),
        ds("ds-2", "Sheet 2", { workbookId: "wb-2" }),
      ],
      editableFigures: [figure("fig-1", "ds-1"), figure("fig-2", "ds-2")],
      reports: [report("rep-1", "ds-1"), report("rep-2", "ds-2")],
      quickPlotTemplates: [template("qpt-1", "wb-1"), template("qpt-2", "wb-2")],
    });
    const result = buildTransferPackage("wb-1", state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pkg.datasets.map((d) => d.id)).toEqual(["ds-1"]);
    expect(result.pkg.editableFigures.map((f) => f.id)).toEqual(["fig-1"]);
    expect(result.pkg.reports.map((r) => r.id)).toEqual(["rep-1"]);
    expect(result.pkg.quickPlotTemplates.map((t) => t.id)).toEqual(["qpt-1"]);
    expect(result.pkg.format).toBe(WORKBOOK_TRANSFER_FORMAT);
    expect(result.pkg.version).toBe(WORKBOOK_TRANSFER_VERSION);
  });

  it("refuses a package over the size bound, naming the size", () => {
    const bigLabel = "x".repeat(MAX_TRANSFER_PACKAGE_CHARS);
    const state = makeState({
      datasets: [ds("ds-1", bigLabel, { workbookId: "wb-1" })],
    });
    const result = buildTransferPackage("wb-1", state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/too large/);
      expect(result.reason).toMatch(/MB/);
    }
  });
});

describe("parseTransferPackage", () => {
  it("round-trips a package built by buildTransferPackage", () => {
    const built = buildTransferPackage("wb-1", makeState());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const parsed = parseTransferPackage(built.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.pkg.workbook.id).toBe("wb-1");
    expect(parsed.pkg.datasets.map((d) => d.id)).toEqual(["ds-1"]);
  });

  it("rejects non-JSON text", () => {
    const result = parseTransferPackage("not json at all");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/does not contain/);
  });

  it("rejects plain text/other JSON that isn't a workbook package", () => {
    const result = parseTransferPackage(JSON.stringify({ hello: "world" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/does not contain a Quantized workbook/);
  });

  it("rejects a package with an unsupported version", () => {
    const built = buildTransferPackage("wb-1", makeState());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const bumped = JSON.stringify({ ...built.pkg, version: 999 });
    const result = parseTransferPackage(bumped);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unsupported workbook transfer version/);
  });

  it("rejects an oversize payload before even parsing JSON", () => {
    const result = parseTransferPackage("x".repeat(MAX_TRANSFER_PACKAGE_CHARS + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/too large/);
  });

  it("rejects a structurally invalid dataset (bad DataStruct) with a reason, never throwing", () => {
    const built = buildTransferPackage("wb-1", makeState());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const broken = {
      ...built.pkg,
      datasets: [{ id: "ds-1", name: "bad", workbookId: "wb-1", data: { time: "not-an-array" } }],
    };
    expect(() => parseTransferPackage(JSON.stringify(broken))).not.toThrow();
    const result = parseTransferPackage(JSON.stringify(broken));
    expect(result.ok).toBe(false);
  });
});

// ── fresh-id rewrite core: the completeness argument ──────────────────────

function generators(prefix: string): TransferIdGenerators {
  const counters: Record<string, number> = {};
  const next = (kind: string) => () => `${prefix}-${kind}-${++counters[kind]!}`;
  counters.ds = 0;
  counters.wb = 0;
  counters.fig = 0;
  counters.rep = 0;
  counters.qpt = 0;
  return {
    dataset: next("ds"),
    workbook: next("wb"),
    figure: next("fig"),
    report: next("rep"),
    template: next("qpt"),
  };
}

function emptyExisting(over: Partial<TransferExistingIds> = {}): TransferExistingIds {
  return {
    datasetIds: new Set(),
    datasetNames: new Set(),
    workbookIds: new Set(),
    figureIds: new Set(),
    reportIds: new Set(),
    templateIds: new Set(),
    ...over,
  };
}

describe("pasteTransferPackage — fresh-id rewrite core", () => {
  function fullPackage(): WorkbookTransferPackage {
    return {
      format: WORKBOOK_TRANSFER_FORMAT,
      version: WORKBOOK_TRANSFER_VERSION,
      createdAt: "2026-01-01T00:00:00.000Z",
      workbook: wb("wb-1", "Book 1", { folderId: "fld-src", order: 3 }),
      datasets: [
        ds("ds-1", "Sheet 1", { workbookId: "wb-1", folderId: "fld-src" }),
        ds("ds-2", "Sheet 2", {
          workbookId: "wb-1",
          folderId: "fld-src",
          bgRef: { datasetId: "ds-1", interp: "linear" },
          derivedFrom: { datasetId: "ds-1", pipeline: "corr" },
          versionOf: "ds-1",
        }),
      ],
      editableFigures: [figure("fig-1", "ds-1")],
      reports: [report("rep-1", "ds-2")],
      quickPlotTemplates: [template("qpt-1", "wb-1")],
    };
  }

  it("mints a fresh workbook id, never the source id", () => {
    const result = pasteTransferPackage(fullPackage(), emptyExisting(), generators("g"), undefined);
    expect(result.workbook.id).not.toBe("wb-1");
    expect(result.workbook.id).toMatch(/^g-wb-/);
  });

  it("mints a fresh id for every dataset, unconditionally (even with zero collision risk)", () => {
    const result = pasteTransferPackage(fullPackage(), emptyExisting(), generators("g"), undefined);
    const ids = result.datasets.map((d) => d.id);
    expect(ids).not.toContain("ds-1");
    expect(ids).not.toContain("ds-2");
    expect(new Set(ids).size).toBe(ids.length); // no internal collision either
  });

  it("assigns zero ids that collide with the destination's existing ids (every namespace)", () => {
    const existing = emptyExisting({
      workbookIds: new Set(["g-wb-1"]),
      datasetIds: new Set(["g-ds-1"]),
      figureIds: new Set(["g-fig-1"]),
      reportIds: new Set(["g-rep-1"]),
      templateIds: new Set(["g-qpt-1"]),
    });
    const result = pasteTransferPackage(fullPackage(), existing, generators("g"), undefined);
    expect(existing.workbookIds.has(result.workbook.id)).toBe(false);
    for (const d of result.datasets) expect(existing.datasetIds.has(d.id)).toBe(false);
    for (const f of result.editableFigures) expect(existing.figureIds.has(f.id)).toBe(false);
    for (const r of result.reports) expect(existing.reportIds.has(r.id)).toBe(false);
    for (const t of result.quickPlotTemplates) expect(existing.templateIds.has(t.id)).toBe(false);
  });

  it("rewrites every internal edge to land INSIDE the pasted set: bgRef, derivedFrom, versionOf", () => {
    const result = pasteTransferPackage(fullPackage(), emptyExisting(), generators("g"), undefined);
    const pastedIds = new Set(result.datasets.map((d) => d.id));
    const sheet2 = result.datasets.find((d) => d.name === "Sheet 2")!;
    expect(sheet2.bgRef).toBeDefined();
    expect(pastedIds.has(sheet2.bgRef!.datasetId)).toBe(true);
    expect(sheet2.bgRef!.datasetId).not.toBe("ds-1"); // rewritten, not aliased
    expect(sheet2.derivedFrom).toBeDefined();
    expect(pastedIds.has(sheet2.derivedFrom!.datasetId)).toBe(true);
    expect(sheet2.versionOf).toBeDefined();
    expect(pastedIds.has(sheet2.versionOf!)).toBe(true);
    expect(result.droppedExternalRefs).toBe(0);
  });

  it("rewrites figure/report datasetId and template scope.workbookId to land INSIDE the pasted set", () => {
    const result = pasteTransferPackage(fullPackage(), emptyExisting(), generators("g"), undefined);
    const pastedIds = new Set(result.datasets.map((d) => d.id));
    expect(result.editableFigures).toHaveLength(1);
    expect(pastedIds.has(result.editableFigures[0].bindings.datasetId!)).toBe(true);
    expect(result.reports).toHaveLength(1);
    expect(pastedIds.has(result.reports[0].datasetId!)).toBe(true);
    expect(result.quickPlotTemplates).toHaveLength(1);
    expect(result.quickPlotTemplates[0].scope).toEqual({ kind: "workbook", workbookId: result.workbook.id });
  });

  it("drops (never aliases) an internal ref that points OUTSIDE the pasted set", () => {
    const pkg = fullPackage();
    // Simulate a hand-edited/corrupt package: ds-2's bgRef points at an id
    // that is NOT one of this package's own datasets.
    pkg.datasets[1] = { ...pkg.datasets[1], bgRef: { datasetId: "ds-outside", interp: "linear" } };
    const result = pasteTransferPackage(pkg, emptyExisting(), generators("g"), undefined);
    const sheet2 = result.datasets.find((d) => d.name === "Sheet 2")!;
    expect(sheet2.bgRef).toBeUndefined();
    expect(result.droppedExternalRefs).toBeGreaterThan(0);
  });

  it("drops folderId/order and lands at targetFolderId (destination decides placement)", () => {
    const result = pasteTransferPackage(fullPackage(), emptyExisting(), generators("g"), "fld-dest");
    expect(result.workbook.folderId).toBe("fld-dest");
    expect(result.workbook.order).toBeUndefined();
    for (const d of result.datasets) expect(d.folderId).toBe("fld-dest");
  });

  it("lands at the Library root when no targetFolderId is given", () => {
    const result = pasteTransferPackage(fullPackage(), emptyExisting(), generators("g"), undefined);
    expect(result.workbook.folderId).toBeUndefined();
    for (const d of result.datasets) expect(d.folderId).toBeUndefined();
  });

  it("dedupes a worksheet name that collides with an existing destination dataset name", () => {
    const existing = emptyExisting({ datasetNames: new Set(["Sheet 1"]) });
    const result = pasteTransferPackage(fullPackage(), existing, generators("g"), undefined);
    const names = result.datasets.map((d) => d.name);
    expect(names).toContain("Sheet 1 (2)");
  });

  it("every dataset's workbookId points at the SAME freshly minted workbook id", () => {
    const result = pasteTransferPackage(fullPackage(), emptyExisting(), generators("g"), undefined);
    for (const d of result.datasets) expect(d.workbookId).toBe(result.workbook.id);
  });
});
