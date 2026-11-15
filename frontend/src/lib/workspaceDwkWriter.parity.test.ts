// `qz convert --to dwk` gives the Library an in-app import gives (gap audit 4
// lane E review, M2). Both fixtures come from ONE synthetic Origin project
// (tests/test_convert_dwk_parity.py, which fails when either is stale):
//   __fixtures__/originImportPayload.json — the import route's response for it;
//   __fixtures__/convertedWorkspace.dwk   — what io/workspace_dwk.py writes.
// The payload goes through the app's REAL import (the store's `importPaths`,
// with only the HTTP call mocked); the .dwk through the app's own reader. The
// two Libraries must agree on everything an import decides.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { importFile } from "./api";
import type { DataStruct, Dataset, FolderNode } from "./types";
import type { WorkbookNode } from "./workbooks";
import { parseWorkspace } from "./workspace";
import { useApp } from "../store/useApp";

vi.mock("./api", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  importFile: vi.fn(),
}));

const read = (name: string): string => readFileSync(join(__dirname, "__fixtures__", name), "utf8");
const PAYLOAD = JSON.parse(read("originImportPayload.json")) as DataStruct;
const DWK = parseWorkspace(read("convertedWorkspace.dwk"), { width: 1600, height: 1000 });

/** A Library reduced to what an import decides, ids replaced by names. */
function shape(datasets: Dataset[], folders: FolderNode[], workbooks: WorkbookNode[], activeId: string | null) {
  const folderPath = (id: string | undefined): string[] => {
    const out: string[] = [];
    for (let f = folders.find((x) => x.id === id); f; f = folders.find((x) => x.id === f!.parentId)) out.unshift(f.name);
    return out;
  };
  const wbName = (id: string | undefined) => workbooks.find((w) => w.id === id)?.name ?? null;
  return {
    active: datasets.find((d) => d.id === activeId)?.name ?? null,
    datasets: datasets.map((d) => ({
      name: d.name,
      time: d.data.time,
      values: d.data.values,
      labels: d.data.labels,
      units: d.data.units,
      metadata: d.data.metadata,
      errorRoles: d.errorRoles,
      source: d.source,
      folder: folderPath(d.folderId),
      workbook: wbName(d.workbookId),
    })),
    workbooks: workbooks.map((w) => ({ name: w.name, folder: folderPath(w.folderId), originBook: w.originBook })),
  };
}

beforeEach(() => {
  useApp.setState({
    datasets: [], folders: [], workbooks: [], activeId: null, selectedIds: [],
    expandedFolders: [], expandedWorkbookIds: [], originFigures: [], originFidelity: [],
    history: [], future: [],
  });
  vi.mocked(importFile).mockResolvedValue(structuredClone(PAYLOAD));
});

describe("a .dwk written by qz convert", () => {
  it("is the Library an in-app import of the same project gives", async () => {
    await useApp.getState().importPaths(["/fixture/loops.opj"]);
    const st = useApp.getState();
    const app = shape(st.datasets, st.folders, st.workbooks, st.activeId);
    const converted = shape(DWK.datasets, DWK.folders, DWK.workbooks, DWK.activeId);
    expect(converted).toEqual(app);
    // ... and the parts that are not per-dataset: the fidelity manifest.
    expect(DWK.originFidelity.map((f) => f.manifest)).toEqual(st.originFidelity.map((f) => f.manifest));
    expect(DWK.originFidelity[0].siblingIds).toHaveLength(st.originFidelity[0].siblingIds.length);
    expect(DWK.originFigures).toHaveLength(st.originFigures.length);
    expect(DWK.migrationWarnings).toEqual([]);
  });

  it("carries what the app decides from the file: long names, error roles, the primary", () => {
    const names = DWK.datasets.map((d) => d.name);
    expect(names).toEqual(["loops:Loop1 — 30 nm µ", "loops:Loop1@2 — 30 nm µ (sheet 2)", "loops:Scan2"]);
    expect(DWK.datasets.find((d) => d.id === DWK.activeId)?.name).toBe("loops:Scan2");
    expect(DWK.datasets[0].errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    expect(DWK.datasets[0].source).toEqual({ kind: "path", path: "/fixture/loops.opj" });
    expect(DWK.datasets[0].importedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
