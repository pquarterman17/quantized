// Characterization tests for the IMPORT-APPEND domain (audit P4.1, the
// ELEVENTH store/useApp.ts domain): `importFilesAppended` (gap #47) — upload
// every file, review the by-position append (P2.5), land ONE dataset, and on
// any failure degrade to `importFiles(files, { bypassGuard: true })`.
//
// What each spec pins: the exact toast text + kind, the status line, the
// single "add dataset" undo step, the typed macro step, one recent per file,
// where the upload loop stops, and the fallback's call shape. The fallback's
// own importFiles is stubbed on the store so these specs pin THIS action's
// contract, not the N-dataset import (useApp.test.ts covers that end to end).
// The review is the REAL lib/transformRun `reviewedAppend` (a module mock of
// it does not reach the store's lazy import — transformRun imports useApp
// back); only the confirm prompt a unit mismatch raises is stubbed.
//
// Written and run GREEN against the pre-extraction useApp.ts; it imports the
// store only through `./useApp`, so nothing here may change when the domain
// moves out.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadFile } from "../lib/api";
import type { DataStruct } from "../lib/types";
import { askConfirm } from "./confirmDialog";
import { useToasts } from "./toasts";
import type { AppState } from "./useApp";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), uploadFile: vi.fn() }));
vi.mock("./confirmDialog", async (orig) => ({ ...(await orig<typeof import("./confirmDialog")>()), askConfirm: vi.fn() }));

const file = (name: string, size = 7) => new File(["x".repeat(size)], name);
const ds = (t: number[], unit = "emu"): DataStruct => ({
  time: t,
  values: t.map((v) => [v]),
  labels: ["m"],
  units: [unit],
  metadata: {},
});
const wide = (): DataStruct => ({ time: [9], values: [[9, 9]], labels: ["m", "T"], units: ["emu", "K"], metadata: {} });
const lastToast = () => useToasts.getState().toasts.at(-1);
const uploadedNames = () => vi.mocked(uploadFile).mock.calls.map(([f]) => (f as File).name);

type Snap = Record<string, unknown>;
const snapshot = (): Snap => ({ ...(useApp.getState() as unknown as Snap) });
function changedSince(before: Snap): string[] {
  const after = useApp.getState() as unknown as Snap;
  return Object.keys(after)
    .filter((k) => after[k] !== before[k])
    .sort();
}

let importFiles: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // clear, not reset: a reset of a hoisted vi.mock fn breaks a later
  // mockImplementation under this toolchain (useApp.test.ts's note).
  vi.mocked(uploadFile).mockClear();
  vi.mocked(askConfirm).mockClear();
  useToasts.setState({ toasts: [] });
  importFiles = vi.fn(async () => {});
  useApp.setState({
    datasets: [],
    history: [],
    future: [],
    recent: [],
    macroRecording: true,
    pipelineRunning: false,
    macroSteps: [],
    status: "idle",
    importFiles: importFiles as unknown as AppState["importFiles"],
  });
});

describe("importFilesAppended: fewer than two files", () => {
  it.each([[[]], [["a.dat"]]])("%j: one danger toast, NO store write, no upload", async (names) => {
    const before = snapshot();
    await useApp.getState().importFilesAppended(names.map((n) => file(n)));
    expect(changedSince(before)).toEqual([]);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(importFiles).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({ msg: "append needs ≥2 files — use Import data… for one", kind: "danger" }),
    ]);
  });
});

describe("importFilesAppended: the clean append", () => {
  it("uploads in order, lands ONE merged dataset with the full side-effect set", async () => {
    vi.mocked(uploadFile).mockImplementation(async (f: File) => (f.name === "day1.dat" ? ds([1, 2]) : ds([3])));

    await useApp.getState().importFilesAppended([file("day1.dat", 3), file("day2.dat", 5)]);

    expect(uploadedNames()).toEqual(["day1.dat", "day2.dat"]);
    expect(askConfirm).not.toHaveBeenCalled(); // same units: the review is silent
    const s = useApp.getState();
    expect(s.datasets).toHaveLength(1);
    expect(s.datasets[0].name).toBe("day1.dat +1 more (appended)");
    expect(s.datasets[0].data.time).toEqual([1, 2, 3]);
    expect(s.datasets[0].data.metadata.merged_from).toBe("day1.dat + day2.dat");
    expect(s.datasets[0].id).toMatch(/^ds-/);
    expect(s.activeId).toBe(s.datasets[0].id);
    expect(s.history.map((h) => h.label)).toEqual(["add dataset"]);
    expect(s.recent.map((r) => [r.name, r.size])).toEqual([
      ["day2.dat", 5],
      ["day1.dat", 3],
    ]);
    expect(s.macroSteps).toHaveLength(1);
    expect(s.macroSteps[0]).toMatchObject({
      kind: "import",
      label: "Import (append) 2 files",
      code: 'qz.importAppended(["day1.dat", "day2.dat"])',
      params: { names: ["day1.dat", "day2.dat"] },
    });
    expect(s.status).toBe("appended 2 files → 3 rows");
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({ msg: "appended 2 files → 3 rows", kind: "ok" }),
    ]);
    expect(importFiles).not.toHaveBeenCalled();
  });

  it("names a three-file append after the first file (+2 more)", async () => {
    vi.mocked(uploadFile).mockImplementation(async () => ds([1]));
    await useApp.getState().importFilesAppended([file("a.dat"), file("b.dat"), file("c.dat")]);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["a.dat +2 more (appended)"]);
  });

  it("an accepted unit-mismatch review still appends", async () => {
    vi.mocked(uploadFile).mockImplementation(async (f: File) => (f.name === "a.dat" ? ds([1]) : ds([2], "A m^2")));
    vi.mocked(askConfirm).mockResolvedValue(true);
    await useApp.getState().importFilesAppended([file("a.dat"), file("b.dat")]);
    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(importFiles).not.toHaveBeenCalled();
  });

  it("a ONE-book Origin result still appends (only >1 books refuses)", async () => {
    vi.mocked(uploadFile).mockImplementation(async () => ({ ...ds([1]), books: [ds([1])] }));
    await useApp.getState().importFilesAppended([file("a.dat"), file("b.dat")]);
    expect(importFiles).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toHaveLength(1);
  });
});

describe("importFilesAppended: every degrade path falls back to importFiles(files, { bypassGuard: true })", () => {
  it("a declined review: info toast, no dataset, status left at the progress line", async () => {
    vi.mocked(uploadFile).mockImplementation(async (f: File) => (f.name === "a.dat" ? ds([1]) : ds([2], "A m^2")));
    vi.mocked(askConfirm).mockResolvedValue(false);
    const files = [file("a.dat"), file("b.dat")];

    await useApp.getState().importFilesAppended(files);

    expect(importFiles).toHaveBeenCalledTimes(1);
    expect(importFiles).toHaveBeenCalledWith(files, { bypassGuard: true });
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({
        msg: "append cancelled at the unit/name review — importing separately instead",
        kind: "info",
      }),
    ]);
    const s = useApp.getState();
    expect(s.datasets).toEqual([]);
    expect(s.history).toEqual([]);
    expect(s.recent).toEqual([]);
    expect(s.macroSteps).toEqual([]);
    expect(s.status).toBe("importing 2 files to append…");
  });

  it("a column-count mismatch: danger toast carrying the merge error", async () => {
    vi.mocked(uploadFile).mockImplementation(async (f: File) => (f.name === "a.dat" ? ds([1]) : wide()));
    await useApp.getState().importFilesAppended([file("a.dat"), file("b.dat")]);
    expect(lastToast()).toMatchObject({
      msg: "merge: column-count mismatch (a.dat has 1, b.dat has 2) — importing separately instead",
      kind: "danger",
    });
    expect(importFiles).toHaveBeenCalledTimes(1);
  });

  it("a non-Error rejection from the review gets the mismatch wording", async () => {
    vi.mocked(uploadFile).mockImplementation(async (f: File) => (f.name === "a.dat" ? ds([1]) : ds([2], "A m^2")));
    vi.mocked(askConfirm).mockRejectedValue("nope");
    await useApp.getState().importFilesAppended([file("a.dat"), file("b.dat")]);
    expect(lastToast()).toMatchObject({
      msg: "append failed (column-count mismatch) — importing separately instead",
      kind: "danger",
    });
    expect(importFiles).toHaveBeenCalledTimes(1);
  });

  it("a multi-workbook Origin file stops the upload loop at that file", async () => {
    vi.mocked(uploadFile).mockImplementation(async (f: File) =>
      f.name === "Proj.opj" ? { ...ds([1]), books: [ds([1]), ds([2])] } : ds([1]),
    );
    const files = [file("a.dat"), file("Proj.opj"), file("c.dat")];

    await useApp.getState().importFilesAppended(files);

    expect(uploadedNames()).toEqual(["a.dat", "Proj.opj"]);
    expect(lastToast()).toMatchObject({
      msg: "Proj.opj is a multi-workbook Origin project — can't append — importing separately instead",
      kind: "danger",
    });
    expect(importFiles).toHaveBeenCalledWith(files, { bypassGuard: true });
    expect(useApp.getState().datasets).toEqual([]);
  });

  it("an upload failure stops the loop and names the file; a non-Error says 'error'", async () => {
    vi.mocked(uploadFile).mockImplementation(async (f: File) => {
      if (f.name === "bad.zzz") throw new Error("unknown format");
      return ds([1]);
    });

    await useApp.getState().importFilesAppended([file("bad.zzz"), file("good.dat")]);
    expect(uploadedNames()).toEqual(["bad.zzz"]);
    expect(lastToast()).toMatchObject({ msg: "bad.zzz: unknown format — importing separately instead", kind: "danger" });

    vi.mocked(uploadFile).mockResolvedValueOnce(ds([1])).mockRejectedValueOnce(42); // good.dat, then weird.zzz
    await useApp.getState().importFilesAppended([file("good.dat"), file("weird.zzz")]);
    expect(lastToast()).toMatchObject({ msg: "weird.zzz: error — importing separately instead", kind: "danger" });
    expect(importFiles).toHaveBeenCalledTimes(2);
    expect(useApp.getState().datasets).toEqual([]);
  });
});
