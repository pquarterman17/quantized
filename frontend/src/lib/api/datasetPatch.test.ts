// Cell-patch uploads (./datasetPatch + ./datasetCache's `noteCellEdit`): a
// cell-edited child of a dataset the server holds is sent as the parent's
// handle plus the changed cells, and falls back to a full upload whenever a
// patch cannot reproduce it.

import { describe, expect, it, vi } from "vitest";

import { HttpError } from "./http";
import { noteCellEdit, postJSONDatasetAware } from "./datasetCache";
import type { RawFetchJSON } from "./datasetCache";
import { cellPatches, MAX_PATCH_FRACTION, type CellPatch } from "./datasetPatch";
import type { DataStruct } from "../types";

const grid = (rows: number, cols = 3): DataStruct => ({
  time: Array.from({ length: rows }, (_, i) => i),
  values: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => r * 10 + c)),
  labels: Array.from({ length: cols }, (_, c) => `c${c}`),
  units: Array.from({ length: cols }, () => ""),
  metadata: { source: "x" },
});

/** What setCellValue does: one new row array, every other row shared. */
function edit(ds: DataStruct, row: number, col: number, value: number): DataStruct {
  if (col < 0) {
    const time = ds.time.slice();
    time[row] = value;
    return { ...ds, time };
  }
  const values = ds.values.slice();
  values[row] = values[row].slice();
  values[row][col] = value;
  return { ...ds, values };
}

/** Apply patches to a WIRE copy (what the server decodes), as the server does. */
function applyOnWire(base: DataStruct, patches: CellPatch[]): unknown {
  const wire = JSON.parse(JSON.stringify(base)) as { time: unknown[]; values: unknown[][] };
  for (const p of JSON.parse(JSON.stringify(patches)) as { row: number; col: number; value: unknown }[]) {
    if (p.col < 0) wire.time[p.row] = p.value;
    else wire.values[p.row][p.col] = p.value;
  }
  return wire;
}

const wire = (ds: DataStruct): unknown => JSON.parse(JSON.stringify(ds));

describe("cellPatches", () => {
  it("lists exactly the changed cells, and the patched wire copy equals a full upload (NaN, Inf, -0)", () => {
    const base = grid(40);
    base.values[3][1] = Number.NaN;
    let child = edit(base, 0, 0, 1.5);
    child = edit(child, 3, 1, 7); // NaN -> number
    child = edit(child, 5, 2, Number.NaN); // number -> NaN (null)
    child = edit(child, 6, 0, -0); // -0 goes out as 0, the same as a full upload
    child = edit(child, 7, 1, Number.POSITIVE_INFINITY);
    child = edit(child, 2, -1, 99); // time column
    const patches = cellPatches(base, child)!;
    expect(patches).toEqual([
      { row: 2, col: -1, value: 99 },
      { row: 0, col: 0, value: 1.5 },
      { row: 3, col: 1, value: 7 },
      { row: 5, col: 2, value: Number.NaN },
      { row: 6, col: 0, value: -0 },
      { row: 7, col: 1, value: Number.POSITIVE_INFINITY },
    ]);
    expect(JSON.stringify(patches.map((p) => p.value))).toBe("[99,1.5,7,null,0,null]");
    expect(applyOnWire(base, patches)).toEqual(wire(child));
  });

  it("covers formula-column changes a recompute made outside the edited row", () => {
    const base = grid(40);
    const child = { ...base, values: base.values.map((r) => [r[0], r[1], r[2] + 1]) }; // every row rebuilt
    child.values[0] = [...child.values[0]];
    child.values[0][0] = -5;
    expect(cellPatches(base, child)).toBeNull(); // 41 changed cells > 5% of 160
    const small = grid(1000);
    small.values[500][1] = Number.NaN; // an unchanged NaN in a copied row is not a change
    const recomputed = { ...small, values: small.values.map((r) => r.slice()) };
    recomputed.values[10][0] = 1;
    recomputed.values[11][2] = 2; // the formula column one row down
    const patches = cellPatches(small, recomputed)!;
    expect(patches).toEqual([
      { row: 10, col: 0, value: 1 },
      { row: 11, col: 2, value: 2 },
    ]);
    expect(applyOnWire(small, patches)).toEqual(wire(recomputed));
  });

  it("accepts rebuilt-but-equal labels, units and metadata", () => {
    const base = grid(40);
    const child = { ...edit(base, 1, 1, 0.5), labels: [...base.labels], metadata: { ...base.metadata } };
    expect(cellPatches(base, child)).toHaveLength(1);
  });

  it("refuses when a non-grid field changed", () => {
    const base = grid(40);
    expect(cellPatches(base, { ...edit(base, 1, 1, 0.5), labels: ["a", "b", "z"] })).toBeNull();
    expect(cellPatches(base, { ...edit(base, 1, 1, 0.5), metadata: { source: "y" } })).toBeNull();
    expect(cellPatches(base, { ...edit(base, 1, 1, 0.5), cat_levels: { 0: ["a"] } })).toBeNull();
  });

  it("refuses when the shape changed", () => {
    const base = grid(40);
    expect(cellPatches(base, { ...base, time: [...base.time, 40], values: [...base.values, [0, 0, 0]] })).toBeNull();
    const wider = { ...base, values: base.values.slice() };
    wider.values[4] = [...wider.values[4], 1];
    expect(cellPatches(base, wider)).toBeNull();
  });

  it(`refuses more than ${MAX_PATCH_FRACTION * 100}% of the cells`, () => {
    const base = grid(100); // 400 cells incl. time -> 20 patches allowed
    let child = base;
    for (let r = 0; r < 20; r++) child = edit(child, r, 0, -1);
    expect(cellPatches(base, child)).toHaveLength(20);
    expect(cellPatches(base, edit(child, 20, 0, -1))).toBeNull();
  });
});

type Call = { path: string; body: Record<string, unknown> };

/** A fake server: remembers what it was sent and answers per path. */
function server(patchAnswer: (body: Record<string, unknown>) => unknown = () => ({ dataset_handle: "hC" })) {
  const calls: Call[] = [];
  const rawFetch = vi.fn(async (path: string, body: unknown) => {
    const b = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    calls.push({ path, body: b });
    if (path === "/api/datasets/patch") {
      const answer = patchAnswer(b);
      if (answer instanceof Error) throw answer;
      return { value: answer, handle: null };
    }
    return { value: { ok: true }, handle: b.dataset_handle ?? (calls.length === 1 ? "hP" : "hFull") };
  }) as unknown as RawFetchJSON;
  const plot = (dataset: DataStruct) => postJSONDatasetAware("/api/plot/series", { dataset }, undefined, rawFetch);
  return { calls, plot };
}

const sentFull = (c: Call) => c.path === "/api/plot/series" && c.body.dataset !== undefined;

describe("postJSONDatasetAware with a cell-edited child", () => {
  it("sends the parent handle plus patches, then plots by the returned handle", async () => {
    const { calls, plot } = server();
    const parent = grid(100);
    await plot(parent);
    const child = edit(parent, 3, 2, Number.NaN);
    noteCellEdit(parent, child);
    await plot(child);

    expect(calls.map((c) => c.path)).toEqual(["/api/plot/series", "/api/datasets/patch", "/api/plot/series"]);
    expect(calls[1].body).toEqual({ dataset_handle: "hP", patches: [{ row: 3, col: 2, value: null }] });
    expect(calls[2].body).toEqual({ dataset_handle: "hC" });

    await plot(child); // the child's handle is remembered like any other
    expect(calls[3].body).toEqual({ dataset_handle: "hC" });
  });

  it("patches from the last dataset the server saw across a burst of unsent edits", async () => {
    const { calls, plot } = server();
    const parent = grid(100);
    await plot(parent);
    const mid = edit(parent, 1, 0, 5);
    noteCellEdit(parent, mid);
    const child = edit(mid, 2, 1, 6);
    noteCellEdit(mid, child);
    await plot(child);
    expect(calls[1].body).toEqual({
      dataset_handle: "hP",
      patches: [
        { row: 1, col: 0, value: 5 },
        { row: 2, col: 1, value: 6 },
      ],
    });
  });

  it("falls back to a full upload when the parent was never sent (stale parent)", async () => {
    const { calls, plot } = server();
    const parent = grid(100);
    const child = edit(parent, 3, 2, 1);
    noteCellEdit(parent, child);
    await plot(child);
    expect(calls).toHaveLength(1);
    expect(sentFull(calls[0])).toBe(true);
  });

  it("falls back to a full upload when too many cells changed", async () => {
    const { calls, plot } = server();
    const parent = grid(10);
    await plot(parent);
    const child = { ...parent, values: parent.values.map((r) => r.map((v) => v + 1)) };
    noteCellEdit(parent, child);
    await plot(child);
    expect(calls.map((c) => c.path)).toEqual(["/api/plot/series", "/api/plot/series"]);
    expect(sentFull(calls[1])).toBe(true);
  });

  it("falls back to a full upload when the shape changed", async () => {
    const { calls, plot } = server();
    const parent = grid(100);
    await plot(parent);
    const child = { ...parent, time: [...parent.time, 100], values: [...parent.values, [1, 2, 3]] };
    noteCellEdit(parent, child);
    await plot(child);
    expect(calls).toHaveLength(2);
    expect(sentFull(calls[1])).toBe(true);
  });

  it("falls back to a full upload on a 409 (parent evicted) and forgets the parent's handle", async () => {
    const { calls, plot } = server(() => new HttpError(409, "unknown_dataset_handle"));
    const parent = grid(100);
    await plot(parent);
    const child = edit(parent, 3, 2, 1);
    noteCellEdit(parent, child);
    await plot(child);
    expect(calls.map((c) => c.path)).toEqual(["/api/plot/series", "/api/datasets/patch", "/api/plot/series"]);
    expect(sentFull(calls[2])).toBe(true);

    await plot(parent); // the evicted handle is not reused
    expect(sentFull(calls[3])).toBe(true);
  });

  it("falls back to a full upload when the patched dataset is too large to cache", async () => {
    const { calls, plot } = server(() => ({ dataset_handle: null }));
    const parent = grid(100);
    await plot(parent);
    const child = edit(parent, 3, 2, 1);
    noteCellEdit(parent, child);
    await plot(child);
    expect(calls).toHaveLength(3);
    expect(sentFull(calls[2])).toBe(true);
  });

  it("shares one patch among concurrent callers", async () => {
    const { calls, plot } = server();
    const parent = grid(100);
    await plot(parent);
    const child = edit(parent, 3, 2, 1);
    noteCellEdit(parent, child);
    await Promise.all([plot(child), plot(child), plot(child)]);
    expect(calls.filter((c) => c.path === "/api/datasets/patch")).toHaveLength(1);
    expect(calls.filter(sentFull)).toHaveLength(1); // only the parent's own first upload
  });

  it("waits for the parent's in-flight upload instead of sending the child in full", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const calls: Call[] = [];
    const rawFetch = vi.fn(async (path: string, body: unknown) => {
      const b = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
      calls.push({ path, body: b });
      if (path === "/api/datasets/patch") return { value: { dataset_handle: "hC" }, handle: null };
      if (b.dataset !== undefined) await gate;
      return { value: { ok: true }, handle: (b.dataset_handle as string | undefined) ?? "hP" };
    }) as unknown as RawFetchJSON;
    const parent = grid(100);
    const first = postJSONDatasetAware("/api/plot/series", { dataset: parent }, undefined, rawFetch);
    const child = edit(parent, 3, 2, 1);
    noteCellEdit(parent, child);
    const second = postJSONDatasetAware("/api/plot/series", { dataset: child }, undefined, rawFetch);
    release();
    await Promise.all([first, second]);
    expect(calls.map((c) => c.path)).toEqual(["/api/plot/series", "/api/datasets/patch", "/api/plot/series"]);
  });
});
