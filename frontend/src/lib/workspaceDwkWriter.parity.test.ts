// The `.dwk` that `qz convert --to dwk` writes (io/workspace_dwk.py) opens in
// the app (origin gap audit 4, G2). `__fixtures__/convertedWorkspace.dwk` is
// that writer's committed output — tests/test_cli_convert.py fails when the
// writer and the file disagree — and this parses it with the app's own reader.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseWorkspace } from "./workspace";

const TEXT = readFileSync(join(__dirname, "__fixtures__", "convertedWorkspace.dwk"), "utf8");
const VIEWPORT = { width: 1600, height: 1000 };

describe("a .dwk written by qz convert", () => {
  const ws = parseWorkspace(TEXT, VIEWPORT);

  it("loads every sheet with its data", () => {
    expect(ws.datasets.map((d) => d.name)).toEqual(["loops:Loop1", "loops:Loop1@2", "loops:Scan2"]);
    expect(ws.datasets[0].data.time).toEqual([1, 2, 3, 4]);
    expect(ws.datasets[0].data.labels).toEqual(["Moment", "Error"]);
    expect(ws.migrationWarnings).toEqual([]);
  });

  it("decodes the non-finite and negative-zero cells", () => {
    const v = ws.datasets[1].data.values;
    expect(Number.isNaN(v[0][0])).toBe(true);
    expect(Object.is(v[0][1], -0)).toBe(true);
    expect(v[1][0]).toBe(Infinity);
    expect(v[2][0]).toBe(-Infinity);
  });

  it("keeps the Origin folders and groups the sheets of one book into one workbook", () => {
    const byId = new Map(ws.folders.map((f) => [f.id, f]));
    const path = (id: string | undefined): string[] => {
      const out: string[] = [];
      for (let f = id ? byId.get(id) : undefined; f; f = f.parentId ? byId.get(f.parentId) : undefined) out.unshift(f.name);
      return out;
    };
    const loop = ws.workbooks.find((w) => ws.datasets[0].workbookId === w.id);
    expect(loop).toBeDefined();
    expect(ws.datasets[1].workbookId).toBe(loop!.id);
    expect(ws.datasets[2].workbookId).not.toBe(loop!.id);
    expect(path(loop!.folderId ?? ws.datasets[0].folderId)).toEqual(["loops", "Samples", "30 nm"]);
    const scan = ws.workbooks.find((w) => w.id === ws.datasets[2].workbookId);
    expect(path(scan!.folderId ?? ws.datasets[2].folderId)).toEqual(["loops"]);
  });
});
