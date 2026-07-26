// importPaths (MAIN_PLAN #31): the path entry point that gives a dataset a real
// `source.path`, which is what lets re-import skip the picker.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { importFile, uploadFile } from "../lib/api";
import { usePendingOps } from "./pendingOps";
import { isImportRunning, pathBasename, useImportBatch } from "./importDatasets";
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

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [], folders: [], activeId: null, selectedIds: [] });
  useImportBatch.setState({ running: false });
  usePendingOps.setState({ ops: [] });
  vi.mocked(importFile).mockResolvedValue(payload());
  vi.mocked(uploadFile).mockResolvedValue(payload());
});

/** An AbortError shaped like what `fetch` actually rejects with — used by
 *  the cancel tests below to simulate the in-flight request dying mid-batch. */
function abortError(): Error {
  return Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

describe("pathBasename", () => {
  it("handles POSIX and Windows separators, and UNC", () => {
    // The backslash is built from a char code, not written as a literal: this
    // test was briefly WRONG because a quoting layer ate one, turning
    // "C:\data\scan.dat" into the escape sequences \d and \s — i.e. the string
    // "C:datascan.dat", which has no separator at all and tests nothing.
    const B = String.fromCharCode(92);
    expect(pathBasename("/data/runs/scan.dat")).toBe("scan.dat");
    expect(pathBasename(`C:${B}data${B}scan.dat`)).toBe("scan.dat");
    expect(pathBasename(`${B}${B}server${B}share${B}scan.dat`)).toBe("scan.dat");
  });

  it("handles a trailing separator", () => {
    const B = String.fromCharCode(92);
    expect(pathBasename(`/data/runs${"/"}`)).toBe("runs");
    expect(pathBasename(`C:${B}data${B}`)).toBe("data");
  });

  it("returns the input when there is no separator", () => {
    expect(pathBasename("scan.dat")).toBe("scan.dat");
  });
});

describe("importPaths", () => {
  it("reads through the PATH route, not upload", async () => {
    await useApp.getState().importPaths(["/data/scan.dat"]);
    // P3.4 slice 1: every call now carries the batch's AbortSignal too.
    expect(importFile).toHaveBeenCalledWith("/data/scan.dat", expect.any(AbortSignal));
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("records source.path so re-import needs no picker", async () => {
    await useApp.getState().importPaths(["/data/scan.dat"]);
    const [ds] = useApp.getState().datasets;
    expect(ds.source).toEqual({ kind: "path", path: "/data/scan.dat" });
  });

  it("names the dataset from the basename, not the whole path", async () => {
    await useApp.getState().importPaths(["/very/long/network/path/scan.dat"]);
    expect(useApp.getState().datasets[0].name).toBe("scan.dat");
  });

  it("imports several paths in one batch", async () => {
    await useApp.getState().importPaths(["/a/one.dat", "/b/two.dat"]);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["one.dat", "two.dat"]);
  });

  it("keeps going when one path fails, and reports it", async () => {
    vi.mocked(importFile)
      .mockRejectedValueOnce(new Error("file not found"))
      .mockResolvedValueOnce(payload());
    await useApp.getState().importPaths(["/gone.dat", "/ok.dat"]);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["ok.dat"]);
    expect(useApp.getState().status).toContain("file not found");
  });
});

describe("importFiles still behaves as before", () => {
  it("uploads bytes and records NO source (a browser cannot know a path)", async () => {
    const file = new File(["T,M\n1,2\n"], "browser.csv", { type: "text/csv" });
    await useApp.getState().importFiles([file]);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    const [ds] = useApp.getState().datasets;
    expect(ds.name).toBe("browser.csv");
    expect(ds.source).toBeUndefined();
  });
});

describe("import roles and provenance (MAIN #33)", () => {
  const withLabels = (labels: string[]) => ({
    time: [0, 1],
    values: [labels.map(() => 1), labels.map(() => 2)],
    labels,
    units: labels.map(() => ""),
    metadata: {},
  });

  it("seeds error roles from the parsed column names", () => {
    vi.mocked(importFile).mockResolvedValue(withLabels(["R", "dR"]));
    return useApp
      .getState()
      .importPaths(["/d/refl.dat"])
      .then(() => {
        expect(useApp.getState().datasets[0].errorRoles).toEqual([
          { channel: 1, target: 0, axis: "y", side: "both" },
        ]);
      });
  });

  it("records asymmetric halves separately, not as one symmetric bar", () => {
    vi.mocked(importFile).mockResolvedValue(withLabels(["M", "M_err+", "M_err-"]));
    return useApp
      .getState()
      .importPaths(["/d/asym.dat"])
      .then(() => {
        const roles = useApp.getState().datasets[0].errorRoles ?? [];
        expect(roles.map((r) => r.side).sort()).toEqual(["+", "-"]);
      });
  });

  it("leaves an AMBIGUOUS error name unbound rather than guessing", () => {
    // The plan's "suggested, never silently forced": a leading error column has
    // nothing defensible to bind to.
    vi.mocked(importFile).mockResolvedValue(withLabels(["err", "M"]));
    return useApp
      .getState()
      .importPaths(["/d/amb.dat"])
      .then(() => {
        expect(useApp.getState().datasets[0].errorRoles).toBeUndefined();
      });
  });

  it("adds no role list to an ordinary numeric file", () => {
    vi.mocked(importFile).mockResolvedValue(withLabels(["Temp", "Moment"]));
    return useApp
      .getState()
      .importPaths(["/d/plain.csv"])
      .then(() => {
        expect(useApp.getState().datasets[0].errorRoles).toBeUndefined();
      });
  });

  it("stamps import provenance on the dataset, since the file is never written", () => {
    vi.mocked(importFile).mockResolvedValue(withLabels(["T", "M"]));
    return useApp
      .getState()
      .importPaths(["/d/plain.csv"])
      .then(() => {
        expect(useApp.getState().datasets[0].importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });
  });
});

describe("import busy state (pendingOps, P3.4 slice 1)", () => {
  it("registers a pendingOps op while a single-file import is in flight, then clears it", async () => {
    let resolve!: (v: ReturnType<typeof payload>) => void;
    const pending = new Promise<ReturnType<typeof payload>>((r) => {
      resolve = r;
    });
    vi.mocked(uploadFile).mockReturnValue(pending);
    const file = new File(["T,M\n1,2\n"], "one.csv", { type: "text/csv" });

    const p = useApp.getState().importFiles([file]);
    expect(usePendingOps.getState().ops).toHaveLength(1);
    expect(usePendingOps.getState().ops[0].label).toBe("Importing one.csv…");

    resolve(payload());
    await p;
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("ticks the op's label forward per file in a multi-file batch, without a new op each time", async () => {
    let resolve1!: (v: ReturnType<typeof payload>) => void;
    let resolve2!: (v: ReturnType<typeof payload>) => void;
    vi.mocked(importFile)
      .mockReturnValueOnce(new Promise((r) => (resolve1 = r)))
      .mockReturnValueOnce(new Promise((r) => (resolve2 = r)));

    const p = useApp.getState().importPaths(["/a/one.dat", "/b/two.dat"]);
    const firstId = usePendingOps.getState().ops[0].id;
    expect(usePendingOps.getState().ops[0].label).toBe("Importing 1/2: one.dat…");

    resolve1(payload());
    await vi.waitFor(() => expect(usePendingOps.getState().ops[0].label).toBe("Importing 2/2: two.dat…"));
    // Same op, just relabelled — not a second registration.
    expect(usePendingOps.getState().ops).toHaveLength(1);
    expect(usePendingOps.getState().ops[0].id).toBe(firstId);

    resolve2(payload());
    await p;
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("the registered op carries a cancel callback", async () => {
    let resolve!: (v: ReturnType<typeof payload>) => void;
    vi.mocked(uploadFile).mockReturnValue(new Promise((r) => (resolve = r)));
    const file = new File(["x"], "one.csv");

    const p = useApp.getState().importFiles([file]);
    expect(typeof usePendingOps.getState().ops[0].cancel).toBe("function");

    resolve(payload());
    await p;
  });
});

describe("import cancellation (P3.4 slice 1)", () => {
  it("stops before the next file, keeps already-imported ones, and reports N/M completed", async () => {
    let resolve1!: (v: ReturnType<typeof payload>) => void;
    // The second file's fetch never settles on its own — it "hangs" until
    // cancel rejects it below, exactly like a real aborted fetch would.
    let reject2!: (e: unknown) => void;
    vi.mocked(importFile)
      .mockReturnValueOnce(new Promise((r) => (resolve1 = r)))
      .mockReturnValueOnce(new Promise((_r, rj) => (reject2 = rj)));

    const p = useApp.getState().importPaths(["/a/one.dat", "/b/two.dat", "/c/three.dat"]);
    resolve1(payload());
    await vi.waitFor(() => expect(usePendingOps.getState().ops[0].label).toContain("two.dat"));

    const cancel = usePendingOps.getState().ops[0].cancel!;
    cancel();
    reject2(abortError());
    await p;

    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["one.dat"]);
    expect(importFile).toHaveBeenCalledTimes(2); // never even started three.dat
    expect(useApp.getState().status).toBe("import cancelled — 1/3 completed");
  });

  it("passes an AbortSignal that is actually aborted when cancel() runs", async () => {
    let capturedSignal: AbortSignal | undefined;
    let reject!: (e: unknown) => void;
    vi.mocked(importFile).mockImplementation((_path, signal) => {
      capturedSignal = signal;
      return new Promise((_r, rj) => (reject = rj));
    });

    const p = useApp.getState().importPaths(["/a/one.dat"]);
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal!.aborted).toBe(false);

    usePendingOps.getState().ops[0].cancel!();
    expect(capturedSignal!.aborted).toBe(true);

    reject(abortError()); // what a real aborted fetch actually does
    await p;
    expect(useApp.getState().datasets).toHaveLength(0);
  });

  it("unregisters the op and clears the running guard on cancel", async () => {
    let reject!: (e: unknown) => void;
    vi.mocked(uploadFile).mockReturnValue(new Promise((_r, rj) => (reject = rj)));
    const file = new File(["x"], "one.csv");

    const p = useApp.getState().importFiles([file]);
    expect(isImportRunning()).toBe(true);
    usePendingOps.getState().ops[0].cancel!();
    reject(abortError());
    await p;

    expect(usePendingOps.getState().ops).toHaveLength(0);
    expect(isImportRunning()).toBe(false);
  });
});

describe("double-import guard (P3.4 slice 1, 2026-07-26 audit gap #1)", () => {
  it("a second importFiles call while one is running short-circuits with no fetch attempted", async () => {
    let resolve!: (v: ReturnType<typeof payload>) => void;
    vi.mocked(uploadFile).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const first = new File(["x"], "first.csv");
    const second = new File(["y"], "second.csv");

    const p1 = useApp.getState().importFiles([first]);
    expect(isImportRunning()).toBe(true);

    await useApp.getState().importFiles([second]);
    expect(uploadFile).toHaveBeenCalledTimes(1); // only "first" ever attempted
    expect(useApp.getState().status).toContain("already running");

    resolve(payload());
    await p1;
  });

  it("importPaths is blocked by a running importFiles batch too (one shared guard)", async () => {
    let resolve!: (v: ReturnType<typeof payload>) => void;
    vi.mocked(uploadFile).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const file = new File(["x"], "one.csv");

    const p1 = useApp.getState().importFiles([file]);
    await useApp.getState().importPaths(["/a/two.dat"]);
    expect(importFile).not.toHaveBeenCalled();

    resolve(payload());
    await p1;
  });

  it("the guard clears after successful completion, allowing the next import", async () => {
    await useApp.getState().importFiles([new File(["x"], "a.csv")]);
    expect(isImportRunning()).toBe(false);
    await useApp.getState().importFiles([new File(["y"], "b.csv")]);
    expect(uploadFile).toHaveBeenCalledTimes(2);
  });

  it("the guard clears after every file in the batch errors, allowing the next import", async () => {
    vi.mocked(uploadFile).mockRejectedValueOnce(new Error("bad file"));
    await useApp.getState().importFiles([new File(["x"], "bad.csv")]);
    expect(isImportRunning()).toBe(false);

    vi.mocked(uploadFile).mockResolvedValueOnce(payload());
    await useApp.getState().importFiles([new File(["y"], "ok.csv")]);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["ok.csv"]);
  });

  it("the guard clears after cancellation, allowing an immediate re-import", async () => {
    let reject!: (e: unknown) => void;
    vi.mocked(uploadFile).mockReturnValueOnce(new Promise((_r, rj) => (reject = rj)));
    const p = useApp.getState().importFiles([new File(["x"], "one.csv")]);
    usePendingOps.getState().ops[0].cancel!();
    reject(abortError());
    await p;
    expect(isImportRunning()).toBe(false);

    vi.mocked(uploadFile).mockResolvedValueOnce(payload());
    await useApp.getState().importFiles([new File(["y"], "two.csv")]);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["two.csv"]);
  });
});
