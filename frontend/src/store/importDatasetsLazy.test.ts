// COLD-path coverage for bundle headroom slice 10 (`plans/BUNDLE_HEADROOM.md`):
// the import slice (`store/importDatasets.ts`) reached through
// `store/importDatasetsLazy.ts`. `src/architecture.test.ts` holds the STATIC
// half of the guard (SEAMS / DRAGGED_OUT); this spec holds the behavioural
// half, the `store/slice9LazySeams.test.ts` shape:
//   * the deferred module really runs, with the caller's arguments;
//   * once loaded, an import registers its busy op and guard synchronously
//     with the call, as it did before the seam;
//   * an empty batch (a canceled picker) never fetches it;
//   * a chunk that will not load is REPORTED (status + danger toast), the
//     action settles with `[]` rather than rejecting, and nothing mutates;
//   * the failure is not cached: the next gesture refetches.
//
// `vi.doMock` (not the hoisted `vi.mock`) is what makes the failure path
// reachable: the loader resolves its module at CALL time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { importFile, uploadFile } from "../lib/api";
import { isImportRunning, useImportBatch } from "./importBatch";
import { importCore, resetImportCoreForTests } from "./importDatasetsLazy";
import { usePendingOps } from "./pendingOps";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  importFile: vi.fn(),
  uploadFile: vi.fn(),
}));

const payload = () => ({
  time: [0, 1, 2],
  values: [[10], [20], [30]],
  labels: ["M"],
  units: ["emu"],
  metadata: {},
});

const failLoad = () => {
  throw new Error("network error");
};

function dangerToasts(): string[] {
  return useToasts
    .getState()
    .toasts.filter((t) => t.kind === "danger")
    .map((t) => t.msg);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetImportCoreForTests();
  useApp.setState({ datasets: [], folders: [], activeId: null, selectedIds: [], status: "" });
  useImportBatch.setState({ running: false });
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
  vi.mocked(uploadFile).mockResolvedValue(payload());
  vi.mocked(importFile).mockResolvedValue(payload());
});

describe("the import-slice seam (store/importDatasetsLazy.ts)", () => {
  it("a cold importFiles loads the real slice and imports with the caller's files", async () => {
    const ids = await useApp.getState().importFiles([new File(["x"], "one.csv")]);
    expect(ids).toHaveLength(1);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["one.csv"]);
  });

  it("a cold importPaths forwards its paths and options", async () => {
    const ids = await useApp.getState().importPaths(["/data/two.dat"], { presentOutcome: false });
    expect(ids).toHaveLength(1);
    expect(importFile).toHaveBeenCalledWith("/data/two.dat", expect.any(AbortSignal));
    expect(useApp.getState().datasets[0].source?.path).toBe("/data/two.dat");
    expect(useApp.getState().status).toBe("imported 1 file");
    // presentOutcome: false reached the real action: no "imported 1 file" toast.
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it("once loaded, an import is busy and guarded synchronously with its call", async () => {
    await importCore();
    let resolve!: (v: ReturnType<typeof payload>) => void;
    vi.mocked(uploadFile).mockReturnValueOnce(new Promise((r) => (resolve = r)));

    const p = useApp.getState().importFiles([new File(["x"], "one.csv")]);
    expect(isImportRunning()).toBe(true);
    expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["Importing one.csv…"]);

    resolve(payload());
    await p;
    expect(isImportRunning()).toBe(false);
  });

  it("two imports started during the cold load still cannot both run", async () => {
    let resolve!: (v: ReturnType<typeof payload>) => void;
    vi.mocked(uploadFile).mockReturnValueOnce(new Promise((r) => (resolve = r)));

    const p1 = useApp.getState().importFiles([new File(["x"], "first.csv")]);
    const p2 = useApp.getState().importFiles([new File(["y"], "second.csv")]);
    // Both calls are genuinely cold: neither has registered anything yet.
    expect(isImportRunning()).toBe(false);
    expect(await p2).toEqual([]);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(useApp.getState().status).toContain("already running");

    resolve(payload());
    await p1;
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["first.csv"]);
  });
});

// Kept after the describe above on purpose: `vi.resetModules()` gives the next
// load FRESH instances of the stores the real slice writes (toasts, pendingOps,
// the guard), which the assertions above read through this file's own static
// imports. Only the failure path needs the reset.
describe("the import-slice seam when its chunk will not load", () => {
  afterEach(() => {
    vi.doUnmock("./importDatasets");
    vi.resetModules();
    resetImportCoreForTests();
  });

  it("an empty batch never fetches the importer", async () => {
    vi.doMock("./importDatasets", failLoad);
    expect(await useApp.getState().importFiles([])).toEqual([]);
    expect(await useApp.getState().importPaths([])).toEqual([]);
    // Had either call tried to load, the doMock above would have reported it.
    expect(dangerToasts()).toEqual([]);
    expect(useApp.getState().status).toBe("");
  });

  it("settles with [] and reports it, touching nothing", async () => {
    vi.doMock("./importDatasets", failLoad);
    const ids = await useApp.getState().importFiles([new File(["x"], "one.csv"), new File(["y"], "two.csv")]);

    expect(ids).toEqual([]);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toEqual([]);
    expect(isImportRunning()).toBe(false);
    expect(useApp.getState().status).toMatch(/^import failed — couldn't load the importer: /);
    expect(dangerToasts()).toEqual([
      expect.stringMatching(/^import failed — couldn't load the importer: .* — nothing was imported \(2 files skipped\)$/),
    ]);
  });

  it("does not cache a failed load — the next import refetches and succeeds", async () => {
    vi.doMock("./importDatasets", failLoad);
    expect(await useApp.getState().importPaths(["/data/a.dat"])).toEqual([]);

    vi.doUnmock("./importDatasets");
    vi.resetModules();
    expect(await useApp.getState().importPaths(["/data/a.dat"])).toHaveLength(1);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["a.dat"]);
  });
});
