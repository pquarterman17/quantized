// COLD-path coverage for bundle headroom slice 10 (`plans/BUNDLE_HEADROOM.md`):
// the import slice (`store/importDatasets.ts`) reached through
// `store/importDatasetsLazy.ts`. `src/architecture.test.ts` holds the STATIC
// half of the guard (SEAMS / DRAGGED_OUT); this spec holds the behavioural
// half, the `store/slice9LazySeams.test.ts` shape:
//   * the deferred module really runs, with the caller's arguments;
//   * a COLD import claims the double-import guard and registers its busy
//     op SYNCHRONOUSLY with the call — before the chunk has even loaded, not
//     only once it has (review finding 1/2) — and a cancel during that load
//     aborts before any upload starts;
//   * once loaded, a LATER import registers its own busy op and guard
//     synchronously with the call, as it did before the seam;
//   * an empty batch (a canceled picker) never fetches it;
//   * a chunk that will not load is REPORTED (status + danger toast), the
//     action settles with `[]` rather than rejecting, and nothing mutates;
//   * the failure is NOT retried by a later gesture — only an explicit reload
//     (`resetImportCoreForTests()` here) gives the next call a fresh attempt
//     (review finding 3: a real browser caches a failed dynamic `import()`
//     of the same chunk URL for the page's lifetime).
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
    // Review finding 1: the FIRST cold call claims the guard on its own
    // tick — a second caller (here; in production, e.g. import-append's own
    // pre-flight check) must see it busy from this point on, not only once
    // the chunk has loaded.
    expect(isImportRunning()).toBe(true);

    // p2 is refused synchronously (the guard is already claimed) — it never
    // even reaches the loader, so it settles well before p1's real chunk
    // load does.
    const p2 = useApp.getState().importFiles([new File(["y"], "second.csv")]);
    expect(await p2).toEqual([]);
    expect(useApp.getState().status).toContain("already running");

    resolve(payload());
    await p1;
    expect(uploadFile).toHaveBeenCalledTimes(1); // "second.csv" never reached it
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["first.csv"]);
  });

  it("a cold import claims the guard and registers its busy op synchronously, before the chunk loads (review finding 1/2)", async () => {
    const p = useApp.getState().importFiles([new File(["x"], "one.csv")]);
    expect(isImportRunning()).toBe(true);
    expect(usePendingOps.getState().ops).toHaveLength(1);
    expect(usePendingOps.getState().ops[0].label).toBe("Loading the importer for 1 file…");
    expect(usePendingOps.getState().ops[0].cancel).toBeInstanceOf(Function);
    // uploadFile hasn't even been reached yet — the chunk itself hasn't loaded.
    expect(uploadFile).not.toHaveBeenCalled();
    await p;
  });

  it("the cold op hands off to the real import — ONE continuous pendingOps entry, never two", async () => {
    let resolve!: (v: ReturnType<typeof payload>) => void;
    vi.mocked(uploadFile).mockReturnValueOnce(new Promise((r) => (resolve = r)));

    const p = useApp.getState().importFiles([new File(["x"], "one.csv")]);
    const opId = usePendingOps.getState().ops[0].id;
    await importCore(); // let the chunk resolve and the real runImport take over

    expect(usePendingOps.getState().ops).toHaveLength(1);
    expect(usePendingOps.getState().ops[0].id).toBe(opId); // SAME entry, relabeled — not a second one
    expect(usePendingOps.getState().ops[0].label).toBe("Importing one.csv…");

    resolve(payload());
    await p;
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("cancelling during the cold chunk load aborts before any upload starts", async () => {
    const p = useApp.getState().importFiles([new File(["x"], "one.csv")]);
    usePendingOps.getState().ops[0].cancel!();

    expect(await p).toEqual([]);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(isImportRunning()).toBe(false);
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("cancelling AFTER the hand-off aborts the real upload (the op's cancel rebinds, it isn't stuck on the chunk-load one)", async () => {
    let reject!: (e: unknown) => void;
    vi.mocked(uploadFile).mockReturnValueOnce(new Promise((_r, rj) => (reject = rj)));

    const p = useApp.getState().importFiles([new File(["x"], "one.csv")]);
    await importCore(); // hand-off complete: the real runImport now owns the op

    // uploadFile's mock above doesn't capture the signal; read it off the call args instead.
    const capturedSignal = vi.mocked(uploadFile).mock.calls.at(-1)?.[1];
    expect(capturedSignal?.aborted).toBe(false);

    usePendingOps.getState().ops[0].cancel!();
    expect(capturedSignal?.aborted).toBe(true);

    reject(new DOMException("aborted", "AbortError"));
    expect(await p).toEqual([]);
    expect(usePendingOps.getState().ops).toHaveLength(0);
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
    expect(usePendingOps.getState().ops).toHaveLength(0);
    expect(useApp.getState().status).toMatch(/^import failed — couldn't load the importer: .* — reload the app to retry$/);
    expect(dangerToasts()).toEqual([
      expect.stringMatching(/^import failed — couldn't load the importer: .* — reload the app to retry \(2 files skipped\)$/),
    ]);
  });

  // Review finding 3: a real browser caches a failed dynamic `import()` of
  // the SAME chunk URL for the page's lifetime — no in-session gesture
  // actually re-fetches it (unlike `vi.resetModules()` in a spec). Without
  // that fix (i.e. the old auto-`inflight = null`-on-failure behavior), this
  // test's second call would have re-invoked the (still-failing) loader a
  // second time — `failOnce` below would read 2, not 1.
  it("a failed load is NOT retried by a later gesture — the loader runs at most once, and the second gesture reuses the same rejection", async () => {
    const failOnce = vi.fn(failLoad);
    vi.doMock("./importDatasets", failOnce);

    expect(await useApp.getState().importFiles([new File(["x"], "one.csv")])).toEqual([]);
    expect(await useApp.getState().importFiles([new File(["y"], "two.csv")])).toEqual([]);

    expect(failOnce).toHaveBeenCalledTimes(1);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("only an explicit reload (resetImportCoreForTests) gives the next import a fresh, successful attempt", async () => {
    vi.doMock("./importDatasets", failLoad);
    expect(await useApp.getState().importPaths(["/data/a.dat"])).toEqual([]);

    vi.doUnmock("./importDatasets");
    vi.resetModules();
    resetImportCoreForTests(); // the explicit stand-in for a real page reload
    expect(await useApp.getState().importPaths(["/data/a.dat"])).toHaveLength(1);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["a.dat"]);
  });
});
