import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { sanitizeReports, type ReportBlock, type ReportEntry } from "./report";
import {
  linkBlockToResult, linkableResults, paramsFromTable, readBlockLink, refreshResultBlock,
  resultLinkState, unlinkedBlock, type LinkContext,
} from "./reportLinks";
import type { DataStruct, Dataset } from "./types";

const data = (cells: number[]): DataStruct => ({
  time: cells.map((_, i) => i), values: cells.map((v) => [v]), labels: ["Y"], units: [""], metadata: {},
});
const dataset = (cells: number[]): Dataset => ({ id: "s", name: "scan", data: data(cells) });
const COLUMNS = ["level", "term", "estimate", "SE", "t", "p"];
const result = (ds: Dataset, slope: number, extra: Partial<AnalysisResult> = {}): AnalysisResult => ({
  version: 1, id: "res", name: "Fit Y by X",
  producer: { id: "fit-y-by-x", label: "Fit Y by X", version: 1 },
  sources: [{ datasetId: ds.id, role: "input" }], outputs: [],
  tables: [
    { title: "Fit", columns: ["N"], rows: [[3]] },
    { title: "Estimates", columns: COLUMNS, rows: [["all", "slope", slope, 0.1, 5, 0.01], ["all", "intercept", 1, 0.2, 2, 0.1]] },
  ],
  warnings: [], createdAt: "2026-11-25T00:00:00Z", sourceFingerprint: analysisDataFingerprint(ds), ...extra,
});
const ctx = (r: AnalysisResult[], ds: Dataset[]): LinkContext => ({ results: r, datasets: ds });
const tableBlock = (): ReportBlock => ({ type: "table", caption: "Estimates", columns: COLUMNS,
  rows: [["all", "slope", 2, 0.1, 5, 0.01], ["all", "intercept", 1, 0.2, 2, 0.1]] });

function linked(_ds: Dataset, r: AnalysisResult): ReportBlock {
  const done = linkBlockToResult(tableBlock(), r, 1);
  if ("error" in done) throw new Error(done.error);
  return done.block;
}

describe("linked report blocks", () => {
  it("a block without a link is a snapshot and refresh never touches it", () => {
    const ds = dataset([1, 2, 3]);
    const block = tableBlock();
    expect(readBlockLink(block)).toBeNull();
    expect(refreshResultBlock(block, ctx([result(ds, 9)], [ds]))).toEqual({ block, changed: false });
  });

  it("is current while the result is current and matches", () => {
    const ds = dataset([1, 2, 3]);
    const r = result(ds, 2);
    const block = linked(ds, r);
    expect(resultLinkState(block, readBlockLink(block) as never, ctx([r], [ds]))).toEqual({ kind: "current" });
  });

  it("goes stale when the source data changes, and refuses to pull old numbers", () => {
    const ds = dataset([1, 2, 3]);
    const r = result(ds, 2);
    const block = linked(ds, r);
    const changed = dataset([1, 2, 4]); // the data changed, the result was not recomputed
    const c = ctx([r], [changed]);
    const state = resultLinkState(block, readBlockLink(block) as never, c);
    expect(state.kind).toBe("stale");
    const out = refreshResultBlock(block, c);
    expect("kept" in out && out.kept).toMatch(/run the analysis again/);
  });

  it("is behind after a recompute, and refresh pulls exactly the new table", () => {
    const ds = dataset([1, 2, 4]);
    const recomputed = result(ds, 3); // new slope, fingerprint of the new data
    const block = linked(dataset([1, 2, 3]), result(dataset([1, 2, 3]), 2));
    const c = ctx([recomputed], [ds]);
    expect(resultLinkState(block, readBlockLink(block) as never, c).kind).toBe("behind");
    const out = refreshResultBlock(block, c);
    if (!("changed" in out)) throw new Error("expected a refresh");
    expect(out.changed).toBe(true);
    expect(out.block).toMatchObject({ type: "table", caption: "Estimates", link: { kind: "result", id: "res" } });
    expect((out.block as { rows: unknown[][] }).rows[0][2]).toBe(3);
    expect(resultLinkState(out.block, readBlockLink(out.block) as never, c)).toEqual({ kind: "current" });
  });

  it("a deleted source shows missing and keeps the last snapshot", () => {
    const ds = dataset([1, 2, 3]);
    const block = linked(ds, result(ds, 2));
    const c = ctx([], [ds]);
    expect(resultLinkState(block, readBlockLink(block) as never, c).kind).toBe("missing");
    const out = refreshResultBlock(block, c);
    expect("kept" in out).toBe(true);
    expect((block as { rows: unknown[][] }).rows[0][2]).toBe(2); // untouched
  });

  it("finds a table by title when the table order changed", () => {
    const ds = dataset([1]);
    const block = linked(ds, result(ds, 2));
    const reordered = result(ds, 2);
    reordered.tables = [reordered.tables![1], reordered.tables![0]];
    expect(resultLinkState(block, readBlockLink(block) as never, ctx([reordered], [ds]))).toEqual({ kind: "current" });
  });

  it("links a parameter block from an estimate table, refusing other tables", () => {
    const ds = dataset([1, 2, 3]);
    const r = result(ds, 2);
    expect(paramsFromTable(r.tables![1])).toEqual([
      { name: "slope", value: 2, error: 0.1 }, { name: "intercept", value: 1, error: 0.2 },
    ]);
    const params: ReportBlock = { type: "params", caption: "P", params: [{ name: "slope", value: 1 }] };
    expect("block" in linkBlockToResult(params, r, 1)).toBe(true);
    expect(linkBlockToResult(params, r, 0)).toEqual({ error: expect.stringMatching(/cannot be a parameter block/) });
  });

  it("unlinking restores a plain snapshot and malformed links read as none", () => {
    const ds = dataset([1]);
    const block = linked(ds, result(ds, 2));
    expect("link" in unlinkedBlock(block)).toBe(false);
    for (const link of [{ kind: "result", id: "x", table: -1 }, { kind: "result", table: 0 }, { kind: "figure", id: "f", pulled: "k" }, "x"]) {
      expect(readBlockLink({ ...tableBlock(), link } as unknown as ReportBlock)).toBeNull();
    }
    expect(linkableResults([result(ds, 1), { ...result(ds, 1), outputs: [{ datasetId: "o", role: "linked-worksheet" }] }])).toHaveLength(1);
  });
});

describe("link persistence", () => {
  const entry = (block: ReportBlock): ReportEntry => ({
    id: "rep", name: "R", datasetId: null,
    report: { title: "R", sections: [{ title: "S", blocks: [block] }] },
  });

  it("round-trips the link by id through save and load", () => {
    const ds = dataset([1]);
    const saved = JSON.parse(JSON.stringify([entry(linked(ds, result(ds, 2)))])) as unknown;
    const [loaded] = sanitizeReports(saved, new Set());
    expect(readBlockLink(loaded.report.sections[0].blocks[0])).toEqual(
      { kind: "result", id: "res", table: 1, title: "Estimates", name: "Fit Y by X" });
  });

  it("loads an old report (no links) unchanged, as snapshots", () => {
    const old = entry(tableBlock());
    const [loaded] = sanitizeReports(JSON.parse(JSON.stringify([old])) as unknown, new Set());
    expect(loaded.report).toEqual(old.report);
    expect(readBlockLink(loaded.report.sections[0].blocks[0])).toBeNull();
  });
});
