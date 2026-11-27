// "Import as sheets" and "Import & append" share Import data…'s picker: the
// native desktop dialog (picked PATHS, remembered folder) when a shell exists,
// the browser picker with IMPORT_ACCEPT otherwise. They used to call
// `openFilePicker` directly, so a desktop user got a different dialog and a
// different format filter depending on which Import command they chose.

import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "./fileCommands";
import { importFile, uploadFile } from "../lib/api";
import { IMPORT_ACCEPT, openFilePicker } from "../lib/openFilePicker";
import type { DataStruct, Dataset } from "../lib/types";
import { useImportBatch } from "../store/importBatch";
import { usePendingOps } from "../store/pendingOps";
import { useApp } from "../store/useApp";

vi.mock("../lib/openFilePicker", async (orig) => ({
  ...(await orig<typeof import("../lib/openFilePicker")>()),
  openFilePicker: vi.fn(),
}));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  importFile: vi.fn(),
  uploadFile: vi.fn(),
}));

const data = (t: number[]): DataStruct => ({ time: t, values: t.map((v) => [v]), labels: ["m"], units: ["emu"], metadata: {} });
const ds = (id: string, name: string, workbookId: string): Dataset => ({ id, name, workbookId, data: data([0]) });
const run = (id: string) => buildFileCommands(useApp.getState).find((c) => c.id === id)!.run();

function setShell(paths: string[]): void {
  (globalThis as { pywebview?: unknown }).pywebview = { api: { pick_files: async () => ({ paths }) } };
}

beforeEach(() => {
  vi.mocked(openFilePicker).mockReset();
  vi.mocked(importFile).mockReset();
  vi.mocked(uploadFile).mockReset();
  usePendingOps.setState({ ops: [] });
  useImportBatch.setState({ running: false });
  useApp.setState({ datasets: [], workbooks: [], activeId: null, history: [], future: [], status: "idle" });
});
afterEach(() => {
  delete (globalThis as { pywebview?: unknown }).pywebview;
});

describe("Import as sheets", () => {
  it("on desktop imports the natively picked paths (no browser picker) into one workbook", async () => {
    setShell(["/d/a.csv", "/d/b.csv"]);
    const importPaths = vi.fn(async (_paths: string[], _opts?: unknown) => {
      useApp.setState((s) => ({
        datasets: [...s.datasets, ds("a", "a.csv", "wb-a"), ds("b", "b.csv", "wb-b")],
        workbooks: [{ id: "wb-a", name: "a.csv" }, { id: "wb-b", name: "b.csv" }],
      }));
      return ["a", "b"];
    });
    useApp.setState({ importPaths: importPaths as never });
    run("import-sheets");
    await waitFor(() => expect(useApp.getState().workbooks.map((w) => w.name)).toEqual(["a"]));
    expect(openFilePicker).not.toHaveBeenCalled();
    expect(importPaths.mock.calls[0][0]).toEqual(["/d/a.csv", "/d/b.csv"]);
    expect(importPaths.mock.calls[0][1]).toMatchObject({ suppressFolderOffer: true });
    expect(useApp.getState().datasets.every((d) => d.workbookId === useApp.getState().workbooks[0].id)).toBe(true);
  });

  it("in a browser opens the shared picker with the import accept filter", () => {
    run("import-sheets");
    expect(vi.mocked(openFilePicker).mock.calls[0][1]).toBe(IMPORT_ACCEPT);
  });
});

describe("Import & append", () => {
  it("on desktop appends the natively picked paths into ONE dataset", async () => {
    setShell(["/d/a.dat", "/d/b.dat"]);
    vi.mocked(importFile).mockImplementation(async (p: string) => (p.endsWith("a.dat") ? data([1, 2]) : data([3, 4])));
    run("import-append");
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(1));
    expect(openFilePicker).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
    expect(useApp.getState().datasets[0].data.time).toEqual([1, 2, 3, 4]);
    expect(useApp.getState().datasets[0].name).toBe("a.dat +1 more (appended)");
    expect(useImportBatch.getState().running).toBe(false);
  });

  it("on desktop a cancelled dialog imports nothing and opens no browser picker", async () => {
    setShell([]);
    run("import-append");
    await new Promise((r) => setTimeout(r, 20));
    expect(openFilePicker).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toEqual([]);
  });

  it("in a browser opens the shared picker with the import accept filter", () => {
    run("import-append");
    expect(vi.mocked(openFilePicker).mock.calls[0][1]).toBe(IMPORT_ACCEPT);
  });
});
