// Tests for L0.33 (LIBRARY_WORKBOOK_UX_PLAN PR M) — transactional multi-
// source reimport. Mirrors store/reimport.test.ts's mocking conventions
// exactly (same `../lib/api`/`./toasts`/`../lib/desktopBridge` mocks) so the
// two files can be read side by side.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi, importFile } from "../lib/api";
import { hasDesktopShell, pathState } from "../lib/desktopBridge";
import type { DataStruct, Dataset } from "../lib/types";
import { toast } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({
  applyCorrections: vi.fn(),
  uploadFile: vi.fn(),
  fetchBookData: vi.fn(),
  importFile: vi.fn(),
  guessImportSettings: vi.fn(),
  parseImportText: vi.fn(),
}));

vi.mock("./toasts", () => ({ toast: vi.fn() }));
vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../lib/desktopBridge", () => ({
  hasDesktopShell: vi.fn(() => false),
  pathState: vi.fn(async () => "unknown"),
}));

const raw: DataStruct = {
  time: [1, 2, 3],
  values: [[10], [20], [30]],
  labels: ["m"],
  units: ["emu"],
  metadata: {},
};

const fresh: DataStruct = {
  time: [1, 2, 3],
  values: [[11], [21], [31]],
  labels: ["m"],
  units: ["emu"],
  metadata: {},
};

function ds(id: string, path: string, over: Partial<Dataset> = {}): Dataset {
  return {
    id,
    name: `${id}.dat`,
    data: raw,
    source: { kind: "path", path },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasDesktopShell).mockReturnValue(false);
  vi.mocked(pathState).mockResolvedValue("unknown");
  useApp.setState({
    datasets: [],
    activeId: null,
    selectedIds: [],
    worksheetId: null,
    originFigures: [],
    reports: [],
    figureDocs: [],
    editableFigures: [],
    plotWindows: [],
    history: [],
    future: [],
    status: "",
    groupKey: null,
    reimportAllRows: null,
    reimportAllBusy: false,
  });
});

describe("stageReimportAll — zero mutation during staging", () => {
  it("makes NO change to datasets/history while staging, regardless of outcome", async () => {
    vi.mocked(importFile).mockResolvedValueOnce(fresh).mockRejectedValueOnce(new Error("boom"));
    const before = [ds("d1", "/a"), ds("d2", "/b")];
    useApp.setState({ datasets: before });

    await useApp.getState().stageReimportAll(["d1", "d2"]);

    expect(useApp.getState().datasets).toBe(before); // same array reference — untouched
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().reimportAllRows).toHaveLength(2);
    expect(useApp.getState().reimportAllBusy).toBe(false);
  });
});

describe("commitReimportAll(\"all\") — the transactional invariant", () => {
  it("one of three sources fails at stage → store byte-identical + a three-row problem report", async () => {
    vi.mocked(importFile)
      .mockResolvedValueOnce(fresh) // d1 ok
      .mockRejectedValueOnce(new Error("disk read error")) // d2 fails
      .mockResolvedValueOnce(fresh); // d3 ok
    const before = [ds("d1", "/a"), ds("d2", "/b"), ds("d3", "/c")];
    useApp.setState({ datasets: before });

    await useApp.getState().stageReimportAll(["d1", "d2", "d3"]);
    const staged = useApp.getState().reimportAllRows!;
    expect(staged.map((r) => r.outcome)).toEqual(["staged", "parse_error", "staged"]);

    await useApp.getState().commitReimportAll("all");

    // Byte-identical: not merely equal content, the SAME array reference —
    // commitReimportAll never called set({ datasets: ... }) at all.
    expect(useApp.getState().datasets).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("1 problem"), "danger");

    // The report names every one of the three sources, not just the failure.
    const rows = useApp.getState().reimportAllRows!;
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.datasetId === "d2")?.message).toContain("disk read error");
  });

  it("commits every source when all three stage cleanly", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    useApp.setState({ datasets: [ds("d1", "/a"), ds("d2", "/b"), ds("d3", "/c")] });

    await useApp.getState().stageReimportAll(["d1", "d2", "d3"]);
    await useApp.getState().commitReimportAll("all");

    const datasets = useApp.getState().datasets;
    expect(datasets.every((d) => d.data.values[0][0] === fresh.values[0][0])).toBe(true);
    expect(useApp.getState().reimportAllRows).toBeNull(); // report closes on success
  });
});

describe("commitReimportAll(\"available\") — partial commit", () => {
  it("commits exactly the successful subset, leaving the failed one untouched", async () => {
    vi.mocked(importFile)
      .mockResolvedValueOnce(fresh)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(fresh);
    useApp.setState({ datasets: [ds("d1", "/a"), ds("d2", "/b"), ds("d3", "/c")] });

    await useApp.getState().stageReimportAll(["d1", "d2", "d3"]);
    await useApp.getState().commitReimportAll("available");

    const byId = new Map(useApp.getState().datasets.map((d) => [d.id, d]));
    expect(byId.get("d1")!.data).toEqual(fresh);
    expect(byId.get("d3")!.data).toEqual(fresh);
    expect(byId.get("d2")!.data).toEqual(raw); // failed source: untouched
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("1 skipped"), "ok");
  });

  it("one undo entry restores every committed dataset in a single step", async () => {
    vi.mocked(importFile)
      .mockResolvedValueOnce(fresh)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(fresh);
    useApp.setState({ datasets: [ds("d1", "/a"), ds("d2", "/b"), ds("d3", "/c")] });

    await useApp.getState().stageReimportAll(["d1", "d2", "d3"]);
    await useApp.getState().commitReimportAll("available");

    expect(useApp.getState().history).toHaveLength(1); // ONE entry for the whole batch

    useApp.getState().undo();

    const byId = new Map(useApp.getState().datasets.map((d) => [d.id, d]));
    expect(byId.get("d1")!.data).toEqual(raw);
    expect(byId.get("d3")!.data).toEqual(raw);
  });

  it("is a no-op (no mutation) when nothing staged cleanly", async () => {
    vi.mocked(importFile).mockRejectedValue(new Error("boom"));
    const before = [ds("d1", "/a")];
    useApp.setState({ datasets: before });

    await useApp.getState().stageReimportAll(["d1"]);
    await useApp.getState().commitReimportAll("available");

    expect(useApp.getState().datasets).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("nothing to reimport"), "danger");
  });
});

describe("mid-stage-edit race — forced (docs/testing.md evidence standard)", () => {
  it("an edit landing on the dataset DURING staging fails closed at commit: zero mutation, row marked changed", async () => {
    // `stageOneSource` lives behind a dynamic import() (eager-bundle-size
    // split, store/reimportAllRun.ts) — its own module-load hop means
    // `importFile` is NOT called synchronously within this tick, so the
    // race is forced by waiting on a plain flag co-located with the mock's
    // own call (real state, not `toHaveBeenCalled()` — the weak-wait
    // ratchet's exact banned idiom), never a fixed sleep/tick count.
    let resolveImport!: (v: DataStruct) => void;
    let importCalled = false;
    vi.mocked(importFile).mockImplementation(
      () => new Promise((resolve) => { importCalled = true; resolveImport = resolve; }),
    );
    useApp.setState({ datasets: [ds("d1", "/a", { notes: "original" })] });

    const stagePromise = useApp.getState().stageReimportAll(["d1"]);
    await vi.waitFor(() => expect(importCalled).toBe(true));
    // Force the race deterministically: land a concurrent, unrelated edit on
    // THIS EXACT dataset while its own import request is still in flight —
    // no timing/sleep involved, the promise above is still pending.
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "d1" ? { ...d, notes: "edited mid-stage" } : d)),
    }));
    resolveImport(fresh);
    await stagePromise;

    // Staging itself succeeded against the OLD object it captured.
    expect(useApp.getState().reimportAllRows![0].outcome).toBe("staged");

    await useApp.getState().commitReimportAll("all");

    // Commit's synchronous re-validation catches the identity mismatch:
    // zero mutation of the reimport's own kind, the concurrent edit survives
    // untouched, and the row is downgraded to report exactly what happened.
    const live = useApp.getState().datasets[0];
    expect(live.notes).toBe("edited mid-stage");
    expect(live.data).toEqual(raw);
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().reimportAllRows![0].outcome).toBe("changed");
  });
});

describe("overlapping invocation — forced (second call wins, first discarded)", () => {
  it("a stageReimportAll call superseded by a second before it resolves writes nothing", async () => {
    const resolvers: Record<string, (v: DataStruct) => void> = {};
    const called: Record<string, boolean> = { "/a": false, "/b": false };
    vi.mocked(importFile).mockImplementation(
      (path: string) => new Promise((resolve) => { called[path] = true; resolvers[path] = resolve; }),
    );
    useApp.setState({ datasets: [ds("d1", "/a"), ds("d2", "/b")] });

    const first = useApp.getState().stageReimportAll(["d1"]);
    const second = useApp.getState().stageReimportAll(["d2"]); // overlaps before `first` settles
    // Wait on real state (both mocks' own `called` flags), never a fixed
    // tick count — the dynamic-import hop (store/reimportAllRun.ts) means
    // neither `importFile` call lands synchronously within this tick.
    await vi.waitFor(() => expect(called["/a"] && called["/b"]).toBe(true));
    // Force the race the OTHER way round: settle the SECOND (later)
    // invocation's own network request FIRST, so its write would land
    // BEFORE the first's — without the generation guard, the FIRST
    // invocation's now-stale write would land last and wrongly win.
    resolvers["/b"](fresh);
    resolvers["/a"](fresh);
    await Promise.all([first, second]);

    const rows = useApp.getState().reimportAllRows!;
    expect(rows).toHaveLength(1);
    expect(rows[0].datasetId).toBe("d2"); // only the LATEST invocation's result landed
  });
});

describe("removed-dataset fail-closed", () => {
  it("a dataset gone before staging even starts is reported, not silently skipped", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    useApp.setState({ datasets: [ds("d1", "/a")] });

    await useApp.getState().stageReimportAll(["d1", "dGone"]);

    const rows = useApp.getState().reimportAllRows!;
    expect(rows.find((r) => r.datasetId === "dGone")?.outcome).toBe("removed");
  });

  it("a dataset removed BETWEEN stage and commit fails closed under \"all\"", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    const before = [ds("d1", "/a")];
    useApp.setState({ datasets: before });

    await useApp.getState().stageReimportAll(["d1"]);
    useApp.setState({ datasets: [] }); // removed after staging, before commit

    await useApp.getState().commitReimportAll("all");

    expect(useApp.getState().datasets).toEqual([]); // no crash, no resurrection
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().reimportAllRows![0].outcome).toBe("removed");
  });
});

describe("no-source dataset", () => {
  it("reports a browser-uploaded (source-less) dataset as its own problem, never a silent skip", async () => {
    useApp.setState({ datasets: [ds("d1", "/a", { source: undefined })] });

    await useApp.getState().stageReimportAll(["d1"]);

    expect(useApp.getState().reimportAllRows![0].outcome).toBe("no_source");
    expect(importFile).not.toHaveBeenCalled();
  });
});

describe("browser (no desktop bridge) degrade — matches store/reimport.ts", () => {
  it("never calls pathState when hasDesktopShell() is false, and a failed importFile still surfaces as a problem", async () => {
    vi.mocked(hasDesktopShell).mockReturnValue(false);
    vi.mocked(importFile).mockRejectedValue(new Error("network unreachable"));
    useApp.setState({ datasets: [ds("d1", "/a")] });

    await useApp.getState().stageReimportAll(["d1"]);

    expect(pathState).not.toHaveBeenCalled();
    expect(useApp.getState().reimportAllRows![0].outcome).toBe("parse_error");
    expect(useApp.getState().reimportAllRows![0].message).toContain("network unreachable");
  });

  it("with a desktop bridge, a confirmed-missing source is reported without ever calling importFile", async () => {
    vi.mocked(hasDesktopShell).mockReturnValue(true);
    vi.mocked(pathState).mockResolvedValue("missing");
    useApp.setState({ datasets: [ds("d1", "/a")] });

    await useApp.getState().stageReimportAll(["d1"]);

    expect(useApp.getState().reimportAllRows![0].outcome).toBe("missing");
    expect(importFile).not.toHaveBeenCalled();
  });

  it("with a desktop bridge, a confirmed-offline source is reported distinctly", async () => {
    vi.mocked(hasDesktopShell).mockReturnValue(true);
    vi.mocked(pathState).mockResolvedValue("offline");
    useApp.setState({ datasets: [ds("d1", "/a")] });

    await useApp.getState().stageReimportAll(["d1"]);

    expect(useApp.getState().reimportAllRows![0].outcome).toBe("offline");
  });
});

describe("corrections re-validated during staging (zero mutation on a rejected correction)", () => {
  it("a rejected applyCorrectionsApi during staging leaves the store untouched at commit", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    vi.mocked(applyCorrectionsApi).mockRejectedValue(new Error("bad correction"));
    const before = [ds("d1", "/a", { raw, corrections: { yOff: 5 } })];
    useApp.setState({ datasets: before });

    await useApp.getState().stageReimportAll(["d1"]);
    expect(useApp.getState().reimportAllRows![0].outcome).toBe("parse_error");

    await useApp.getState().commitReimportAll("all");

    expect(useApp.getState().datasets).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
  });
});
