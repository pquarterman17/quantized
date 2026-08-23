// Tests for L0.33 (LIBRARY_WORKBOOK_UX_PLAN PR M) — transactional multi-
// source reimport. Mirrors store/reimport.test.ts's mocking conventions
// exactly (same `../lib/api`/`./toasts`/`../lib/desktopBridge` mocks) so the
// two files can be read side by side.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi, importFile } from "../lib/api";
import { hasDesktopShell, pathState, probeSource, type SourceProbe } from "../lib/desktopBridge";
import { askConfirm } from "../components/overlays/ConfirmDialog";
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
  probeSource: vi.fn(async () => null),
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
  // `clearAllMocks()` clears call history, NOT a `mockImplementation` a
  // PRIOR test set (that needs `mockReset`/an explicit re-set) — reset
  // these two explicitly every test so an F2/F7-focused test's override
  // never leaks into the next one.
  vi.mocked(probeSource).mockResolvedValue(null);
  vi.mocked(askConfirm).mockResolvedValue(true);
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
    const [firstSurvived, secondSurvived] = await Promise.all([first, second]);

    const rows = useApp.getState().reimportAllRows!;
    expect(rows).toHaveLength(1);
    expect(rows[0].datasetId).toBe("d2"); // only the LATEST invocation's result landed
    // F1: the returned booleans say exactly this too -- a caller chaining a
    // commit off `first` must be told not to.
    expect(firstSurvived).toBe(false);
    expect(secondSurvived).toBe(true);
  });

  // Coordinator review F1 (red-first), the finding's own scenario: gesture
  // A ("available") starts staging but is slow; gesture B ("all") starts
  // AND FINISHES first, with one of its two sources failing so B's own
  // "all" commit legitimately refuses (zero mutation, its report stays
  // open showing the skip). When A's slow stage finally resolves, its
  // generation has already been superseded by B's. A caller that (per F1's
  // ruling) skips its chained commit on a `false` return never lets A's
  // "available" mode touch B's unrelated report at all.
  it("F1: a slow \"available\" gesture superseded by a fast \"all\" gesture (one failure) commits nothing", async () => {
    let resolveA!: (v: DataStruct) => void;
    let calledA = false;
    vi.mocked(importFile).mockImplementation((path: string) => {
      if (path === "/a") {
        calledA = true;
        return new Promise((resolve) => { resolveA = resolve; });
      }
      if (path === "/b") return Promise.resolve(fresh);
      if (path === "/c") return Promise.reject(new Error("boom"));
      throw new Error(`unexpected path ${path}`);
    });
    const before = [ds("d1", "/a"), ds("d2", "/b"), ds("d3", "/c")];
    useApp.setState({ datasets: before });

    // Gesture A: stage "d1" for an eventual "available" commit -- starts,
    // but its own network call never resolves until we say so below.
    const stageA = useApp.getState().stageReimportAll(["d1"]);
    await vi.waitFor(() => expect(calledA).toBe(true));

    // Gesture B: a completely separate, unrelated selection -- starts AND
    // fully finishes (stage, then a legitimate "all" refusal) while A is
    // still waiting on its own import.
    await useApp.getState().stageReimportAll(["d2", "d3"]);
    await useApp.getState().commitReimportAll("all");
    expect(useApp.getState().datasets).toBe(before); // B's own refusal: zero mutation (sanity)
    expect(useApp.getState().reimportAllRows?.map((r) => r.datasetId)).toEqual(["d2", "d3"]); // B's report, still open

    // A's slow import finally resolves -- but its generation has already
    // been superseded by B's stage call in between.
    resolveA(fresh);
    const survivedA = await stageA;
    expect(survivedA).toBe(false);

    // The fixed chain (store/reimportAll.ts's own doc; lib/workbookContextActions.ts's
    // runReimportAllChain) never calls commitReimportAll at all once
    // `survived` comes back false -- so nothing further happens here. B's
    // report is exactly what's left, and neither d1 nor d2 was touched by
    // A's unrelated, stale gesture.
    expect(useApp.getState().datasets).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
  });

  // Coordinator review F1 (red-first, runCommit's OWN independent guard):
  // even a commit call that is ALREADY past its "am I current" check can
  // still be superseded WHILE it waits on its own async work (here, the F2
  // dependency-impact confirm) -- the sync block re-checks immediately
  // before writing and must refuse rather than commit against data a
  // completely separate, newer stage has since replaced.
  it("F1 (runCommit's own guard): a commit stuck on its confirm dialog refuses once a newer stage replaces the rows meanwhile", async () => {
    const derived: Dataset = {
      id: "d2",
      name: "derived.dat",
      data: raw,
      derivedFrom: { datasetId: "d1", pipeline: "x" },
    };
    vi.mocked(importFile).mockResolvedValue(fresh);
    useApp.setState({ datasets: [ds("d1", "/a"), derived] });

    // Stage d1 -- it has a downstream dependent (derived), so committing it
    // will ask for confirmation.
    await useApp.getState().stageReimportAll(["d1"]);

    let resolveConfirm!: (ok: boolean) => void;
    vi.mocked(askConfirm).mockImplementation(
      () => new Promise((resolve) => { resolveConfirm = resolve; }),
    );
    const commitPromise = useApp.getState().commitReimportAll("all");
    await vi.waitFor(() => expect(resolveConfirm).toBeDefined());

    // While this commit is stuck waiting on the (still-open) confirm
    // dialog, a COMPLETELY SEPARATE, newer stage cycle runs to completion.
    await useApp.getState().stageReimportAll(["d1"]);

    // NOW the original, now-stale confirm resolves.
    resolveConfirm(true);
    await commitPromise;

    // The in-flight commit's rows belonged to the SUPERSEDED generation --
    // it must refuse rather than write against data replaced while it
    // waited, even though the user did eventually click through.
    expect(useApp.getState().datasets.find((d) => d.id === "d1")!.data).toEqual(raw);
    expect(useApp.getState().history).toHaveLength(0);
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

describe("F2: dependency-impact confirm (coordinator review)", () => {
  it("skips the confirm entirely when nothing downstream depends on any committable source (frictionless default)", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    useApp.setState({ datasets: [ds("d1", "/a")] });

    await useApp.getState().stageReimportAll(["d1"]);
    await useApp.getState().commitReimportAll("all");

    expect(askConfirm).not.toHaveBeenCalled();
    expect(useApp.getState().datasets[0].data).toEqual(fresh);
  });

  it("asks ONCE, naming the affected dependent, before ever touching datasets", async () => {
    const derived: Dataset = {
      id: "d2",
      name: "derived.dat",
      data: raw,
      derivedFrom: { datasetId: "d1", pipeline: "x" },
    };
    vi.mocked(importFile).mockResolvedValue(fresh);
    vi.mocked(askConfirm).mockResolvedValue(true);
    useApp.setState({ datasets: [ds("d1", "/a"), derived] });

    await useApp.getState().stageReimportAll(["d1"]);
    await useApp.getState().commitReimportAll("all");

    expect(askConfirm).toHaveBeenCalledOnce();
    expect(askConfirm).toHaveBeenCalledWith(
      expect.stringContaining("1 source"),
      expect.stringContaining("derived.dat"),
      "Re-import",
    );
    expect(useApp.getState().datasets.find((d) => d.id === "d1")!.data).toEqual(fresh); // confirmed -> committed
  });

  it("a DECLINED confirm makes zero mutation and leaves the report exactly as it was", async () => {
    const derived: Dataset = {
      id: "d2",
      name: "derived.dat",
      data: raw,
      derivedFrom: { datasetId: "d1", pipeline: "x" },
    };
    vi.mocked(importFile).mockResolvedValue(fresh);
    vi.mocked(askConfirm).mockResolvedValue(false);
    const before = [ds("d1", "/a"), derived];
    useApp.setState({ datasets: before });

    await useApp.getState().stageReimportAll(["d1"]);
    const rowsBefore = useApp.getState().reimportAllRows;
    await useApp.getState().commitReimportAll("all");

    expect(useApp.getState().datasets).toBe(before); // zero mutation
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().reimportAllRows).toBe(rowsBefore); // untouched, not even revalidated
  });
});

describe("F3: one parse per unique source path (multi-book sharing)", () => {
  it("N datasets sharing one source path call importFile exactly once", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    useApp.setState({
      datasets: [ds("d1", "/multi.dat"), ds("d2", "/multi.dat"), ds("d3", "/multi.dat")],
    });

    await useApp.getState().stageReimportAll(["d1", "d2", "d3"]);

    expect(importFile).toHaveBeenCalledTimes(1);
    expect(importFile).toHaveBeenCalledWith("/multi.dat");
    const rows = useApp.getState().reimportAllRows!;
    expect(rows.every((r) => r.outcome === "staged")).toBe(true); // all three still resolved individually
  });
});

describe("F5: a partial commit keeps the skipped rows visible", () => {
  it("\"available\" with a skip keeps ONLY the failed rows open, not the full report and not null", async () => {
    vi.mocked(importFile)
      .mockResolvedValueOnce(fresh)
      .mockRejectedValueOnce(new Error("boom"));
    useApp.setState({ datasets: [ds("d1", "/a"), ds("d2", "/b")] });

    await useApp.getState().stageReimportAll(["d1", "d2"]);
    await useApp.getState().commitReimportAll("available");

    const rows = useApp.getState().reimportAllRows;
    expect(rows).not.toBeNull(); // F5: kept open, not discarded
    expect(rows!.map((r) => r.datasetId)).toEqual(["d2"]); // only the skip remains
    expect(rows![0].outcome).toBe("parse_error");
  });

  it("a fully clean \"available\" commit still closes the report (null)", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    useApp.setState({ datasets: [ds("d1", "/a")] });

    await useApp.getState().stageReimportAll(["d1"]);
    await useApp.getState().commitReimportAll("available");

    expect(useApp.getState().reimportAllRows).toBeNull();
  });
});

describe("F6: an empty stageReimportAll call never strands a real in-flight one", () => {
  it("stageReimportAll([]) mid-flight leaves a genuinely in-flight stage free to finish and clear busy", async () => {
    let resolveReal!: (v: DataStruct) => void;
    let calledReal = false;
    vi.mocked(importFile).mockImplementation(() => {
      calledReal = true;
      return new Promise((resolve) => { resolveReal = resolve; });
    });
    useApp.setState({ datasets: [ds("d1", "/a")] });

    const realStage = useApp.getState().stageReimportAll(["d1"]);
    await vi.waitFor(() => expect(calledReal).toBe(true));
    expect(useApp.getState().reimportAllBusy).toBe(true);

    // An empty/no-op call arrives while the real one is still in flight.
    const noopSurvived = await useApp.getState().stageReimportAll([]);
    expect(noopSurvived).toBe(false);
    // F6: the no-op must NOT have claimed a generation -- the real stage
    // is still exactly as in-flight as before.
    expect(useApp.getState().reimportAllBusy).toBe(true);
    expect(useApp.getState().reimportAllRows).toBeNull();

    resolveReal(fresh);
    const realSurvived = await realStage;

    expect(realSurvived).toBe(true);
    expect(useApp.getState().reimportAllBusy).toBe(false); // never stranded
    expect(useApp.getState().reimportAllRows).toHaveLength(1);
  });
});

describe("F7: on-disk fingerprint re-probed at commit (forced mismatch)", () => {
  it("a source that changed on disk between stage and commit is demoted to disk_changed and excluded", async () => {
    vi.mocked(hasDesktopShell).mockReturnValue(true);
    vi.mocked(pathState).mockResolvedValue("ok");
    vi.mocked(importFile).mockResolvedValue(fresh);
    const stageProbe: SourceProbe = { state: "ok", path: "/a", size: 100, mtime: 1000, checksum: null };
    const commitProbe: SourceProbe = { state: "ok", path: "/a", size: 200, mtime: 2000, checksum: null };
    vi.mocked(probeSource).mockResolvedValueOnce(stageProbe).mockResolvedValueOnce(commitProbe);
    const before = [ds("d1", "/a")];
    useApp.setState({ datasets: before });

    await useApp.getState().stageReimportAll(["d1"]);
    expect(useApp.getState().reimportAllRows![0].outcome).toBe("staged");

    await useApp.getState().commitReimportAll("all");

    expect(useApp.getState().datasets).toBe(before); // zero mutation -- "all" refuses
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().reimportAllRows![0].outcome).toBe("disk_changed");
  });

  it("an UNCHANGED fingerprint at commit commits normally", async () => {
    vi.mocked(hasDesktopShell).mockReturnValue(true);
    vi.mocked(pathState).mockResolvedValue("ok");
    vi.mocked(importFile).mockResolvedValue(fresh);
    const probe: SourceProbe = { state: "ok", path: "/a", size: 100, mtime: 1000, checksum: null };
    vi.mocked(probeSource).mockResolvedValue(probe); // same fingerprint both times

    useApp.setState({ datasets: [ds("d1", "/a")] });

    await useApp.getState().stageReimportAll(["d1"]);
    await useApp.getState().commitReimportAll("all");

    expect(useApp.getState().datasets[0].data).toEqual(fresh);
  });

  it("browser mode (no desktop shell) never re-probes -- unchanged behavior", async () => {
    vi.mocked(hasDesktopShell).mockReturnValue(false);
    vi.mocked(importFile).mockResolvedValue(fresh);
    useApp.setState({ datasets: [ds("d1", "/a")] });

    await useApp.getState().stageReimportAll(["d1"]);
    expect(probeSource).not.toHaveBeenCalled();

    await useApp.getState().commitReimportAll("all");

    expect(probeSource).not.toHaveBeenCalled();
    expect(useApp.getState().datasets[0].data).toEqual(fresh);
  });
});
