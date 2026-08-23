// P1.7 box 3/4/5: relink-one / relink-folder dry-run preview, atomic commit
// (ONE undo entry), and "changed source -> import as new version".

import { beforeEach, describe, expect, it, vi } from "vitest";

import { importFile } from "../lib/api";
import * as desktopBridge from "../lib/desktopBridge";
import type { Dataset } from "../lib/types";
import { useRelink } from "./relink";
import { toast } from "./toasts";
import { useApp, type AppState } from "./useApp";

vi.mock("../lib/api", () => ({
  importFile: vi.fn(),
  uploadFile: vi.fn(),
  fetchBookData: vi.fn(),
  guessImportSettings: vi.fn(),
  parseImportText: vi.fn(),
}));

vi.mock("../lib/desktopBridge", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  hasDesktopShell: vi.fn(),
  probeSource: vi.fn(),
  grantSourceReadPaths: vi.fn(),
  pickRelinkDirectory: vi.fn(),
  revokeRelinkDir: vi.fn(),
}));

vi.mock("./toasts", () => ({ toast: vi.fn() }));

function baseDataset(over: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "run1.csv",
    data: { time: [0, 1], values: [[1], [2]], labels: ["m"], units: ["emu"], metadata: {} },
    source: { kind: "path", path: "/old/data/run1.csv" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [], activeId: null, selectedIds: [], history: [], future: [], status: "" });
  useRelink.setState({
    open: false,
    oldRoot: "",
    newRoot: "",
    preview: [],
    busy: false,
    bridgeAvailable: false,
    newRootConsented: false,
  });
  vi.mocked(desktopBridge.grantSourceReadPaths).mockResolvedValue([]);
  vi.mocked(desktopBridge.revokeRelinkDir).mockResolvedValue(undefined);
});

// C1 (relink consent): browseNewRoot is the ONLY store action that can set
// `newRootConsented`, and it does so ONLY on a real dialog return.
describe("browseNewRoot (C1 native folder grant)", () => {
  it("a real dialog return sets newRoot and marks it consented", async () => {
    useRelink.getState().openPanel();
    vi.mocked(desktopBridge.pickRelinkDirectory).mockResolvedValue("/new/place");

    await useRelink.getState().browseNewRoot();

    expect(useRelink.getState().newRoot).toBe("/new/place");
    expect(useRelink.getState().newRootConsented).toBe(true);
    expect(useRelink.getState().preview).toEqual([]); // a fresh root invalidates any stale preview
  });

  // Review F2: a real post-pick failure (backend {path:null, error} or a
  // bridge throw) is NOT a cancel — the user acted and must hear why
  // nothing happened; and it must mint no consent.
  it("a picker error reports the failure and mints nothing", async () => {
    useRelink.getState().openPanel();
    useRelink.setState({ newRoot: "/already/typed" });
    vi.mocked(desktopBridge.pickRelinkDirectory).mockResolvedValue({ error: "selected path is not a readable directory" });

    await useRelink.getState().browseNewRoot();

    expect(useRelink.getState().newRoot).toBe("/already/typed");
    expect(useRelink.getState().newRootConsented).toBe(false);
    expect(toast).toHaveBeenCalledWith(
      "folder picker failed — selected path is not a readable directory",
      "danger",
    );
  });

  // Review F3: on a shell whose folder dialog is not modal, the pick can
  // resolve AFTER the panel closed. The backend grant already exists by
  // then (minted inside pick_relink_directory), and closePanel's revoke ran
  // BEFORE it existed — so browseNewRoot itself must revoke it and change
  // no state, or the grant outlives the relink session.
  it("a pick resolving after the panel closed revokes the grant and changes nothing", async () => {
    useRelink.getState().openPanel();
    let resolvePick: (v: string) => void = () => {};
    vi.mocked(desktopBridge.pickRelinkDirectory).mockReturnValue(
      new Promise((res) => {
        resolvePick = res;
      }),
    );

    const browsing = useRelink.getState().browseNewRoot();
    useRelink.getState().closePanel();
    vi.mocked(desktopBridge.revokeRelinkDir).mockClear(); // isolate the post-close revoke from closePanel's own
    resolvePick("/picked/too/late");
    await browsing;

    expect(useRelink.getState().open).toBe(false);
    expect(useRelink.getState().newRootConsented).toBe(false);
    expect(useRelink.getState().newRoot).not.toBe("/picked/too/late");
    expect(desktopBridge.revokeRelinkDir).toHaveBeenCalledTimes(1);
  });

  // Review F6: the picker opens where the user already is — the typed new
  // root, falling back to the old root — never the backend's cwd.
  it("forwards the typed new root (else old root) as the picker's start", async () => {
    useRelink.getState().openPanel();
    useRelink.setState({ oldRoot: "/old/root", newRoot: "/typed/new" });
    vi.mocked(desktopBridge.pickRelinkDirectory).mockResolvedValue(desktopBridge.CANCELLED);

    await useRelink.getState().browseNewRoot();
    expect(desktopBridge.pickRelinkDirectory).toHaveBeenLastCalledWith("/typed/new");

    useRelink.setState({ newRoot: "   " });
    await useRelink.getState().browseNewRoot();
    expect(desktopBridge.pickRelinkDirectory).toHaveBeenLastCalledWith("/old/root");
  });

  // RED-FIRST: session cancellation must change NOTHING — not newRoot, not
  // the consent flag, not the preview.
  it("session cancellation (CANCELLED) leaves every field unchanged", async () => {
    useRelink.setState({ newRoot: "/already/typed", newRootConsented: false, preview: [{ x: 1 } as never] });
    vi.mocked(desktopBridge.pickRelinkDirectory).mockResolvedValue(desktopBridge.CANCELLED);

    await useRelink.getState().browseNewRoot();

    expect(useRelink.getState().newRoot).toBe("/already/typed");
    expect(useRelink.getState().newRootConsented).toBe(false);
    expect(useRelink.getState().preview).toEqual([{ x: 1 }]);
  });

  it("no bridge (null): reports honestly, mints nothing, changes nothing", async () => {
    useRelink.setState({ newRoot: "/already/typed" });
    vi.mocked(desktopBridge.pickRelinkDirectory).mockResolvedValue(null);

    await useRelink.getState().browseNewRoot();

    expect(useRelink.getState().newRoot).toBe("/already/typed");
    expect(useRelink.getState().newRootConsented).toBe(false);
    expect(toast).toHaveBeenCalledWith("no desktop bridge — type the folder path instead", "info");
  });

  // The hard rule, asserted directly at the integration seam: typing NEVER
  // reaches `pickRelinkDirectory` at all — there is no code path from
  // `setNewRoot` to a grant.
  it("typing a new root never calls the native picker — a typed path receives no grant", () => {
    useRelink.getState().setNewRoot("/typed/only");
    expect(desktopBridge.pickRelinkDirectory).not.toHaveBeenCalled();
    expect(useRelink.getState().newRootConsented).toBe(false);
  });

  it("typing after a Browse… pick clears the consent flag", async () => {
    useRelink.getState().openPanel();
    vi.mocked(desktopBridge.pickRelinkDirectory).mockResolvedValue("/new/place");
    await useRelink.getState().browseNewRoot();
    expect(useRelink.getState().newRootConsented).toBe(true);

    useRelink.getState().setNewRoot("/new/place/edited");

    expect(useRelink.getState().newRootConsented).toBe(false);
  });
});

// C1: revocation lifecycle — the grant must not outlive the session that
// asked for it (dialog close here; project-change and app-exit are the
// backend's own tests, since they have no frontend counterpart).
describe("closePanel / commit — C1 revocation", () => {
  it("closePanel (Cancel, or the window's own close) revokes the directory grant", () => {
    useRelink.setState({ open: true, newRoot: "/new/place", newRootConsented: true });

    useRelink.getState().closePanel();

    expect(desktopBridge.revokeRelinkDir).toHaveBeenCalledOnce();
    expect(useRelink.getState().open).toBe(false);
    expect(useRelink.getState().newRootConsented).toBe(false);
  });

  it("openPanel never carries a seeded root's grant forward — newRootConsented always starts false", () => {
    useRelink.setState({ newRootConsented: true });

    useRelink.getState().openPanel({ oldRoot: "/old", newRoot: "/new" });

    expect(useRelink.getState().newRootConsented).toBe(false);
  });

  it("a successful commit also revokes the directory grant (panel closes)", async () => {
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "ok",
      path: "/new/place/run1.csv",
      size: 10,
      mtime: 100,
      checksum: "sha256:same",
    });
    useApp.setState({
      datasets: [baseDataset({ source: { kind: "path", path: "/old/data/run1.csv", checksum: "sha256:same" } })],
    });
    useRelink.setState({
      newRootConsented: true,
      preview: [
        {
          datasetId: "d1",
          datasetName: "run1.csv",
          oldPath: "/old/data/run1.csv",
          candidatePath: "/new/place/run1.csv",
          status: "resolved",
          changeVerdict: "unchanged",
          candidateChecksum: "sha256:same",
          candidateMtime: 100,
          candidateSize: 10,
        },
      ],
    });

    await useRelink.getState().commit();

    expect(desktopBridge.revokeRelinkDir).toHaveBeenCalledOnce();
    expect(useRelink.getState().newRootConsented).toBe(false);
  });
});

describe("runPreview — browser degrade (box 4)", () => {
  it("reports 'unavailable' honestly, never guessing a state, when there is no bridge", async () => {
    vi.mocked(desktopBridge.hasDesktopShell).mockReturnValue(false);
    useApp.setState({ datasets: [baseDataset()] });
    useRelink.setState({ oldRoot: "/old/data", newRoot: "/new/place" });

    await useRelink.getState().runPreview();

    const [row] = useRelink.getState().preview;
    expect(row.status).toBe("unavailable");
    expect(row.candidatePath).toBe("/new/place/run1.csv");
    expect(desktopBridge.probeSource).not.toHaveBeenCalled();
  });
});

describe("runPreview — resolution states (box 4)", () => {
  beforeEach(() => vi.mocked(desktopBridge.hasDesktopShell).mockReturnValue(true));

  it("resolves a reachable candidate", async () => {
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "ok",
      path: "/new/place/run1.csv",
      size: 10,
      mtime: 100,
      checksum: "sha256:aa",
    });
    useApp.setState({ datasets: [baseDataset()] });
    useRelink.setState({ oldRoot: "/old/data", newRoot: "/new/place" });

    await useRelink.getState().runPreview();

    expect(useRelink.getState().preview[0]).toMatchObject({ status: "resolved", changeVerdict: "unknown" });
  });

  it("distinguishes missing / offline / permission_denied (box 4)", async () => {
    useApp.setState({
      datasets: [
        baseDataset({ id: "a", source: { kind: "path", path: "/old/data/a.csv" } }),
        baseDataset({ id: "b", source: { kind: "path", path: "/old/data/b.csv" } }),
        baseDataset({ id: "c", source: { kind: "path", path: "/old/data/c.csv" } }),
      ],
    });
    useRelink.setState({ oldRoot: "/old/data", newRoot: "/new/place" });
    vi.mocked(desktopBridge.probeSource).mockImplementation(async (path: string) => {
      if (path.endsWith("a.csv")) return { state: "missing", path, size: null, mtime: null, checksum: null };
      if (path.endsWith("b.csv")) return { state: "offline", path, size: null, mtime: null, checksum: null };
      return { state: "permission_denied", path, size: null, mtime: null, checksum: null };
    });

    await useRelink.getState().runPreview();

    const byId = Object.fromEntries(useRelink.getState().preview.map((r) => [r.datasetId, r.status]));
    expect(byId).toEqual({ a: "missing", b: "offline", c: "permission_denied" });
  });

  it("leaves a dataset outside the moved tree out of the preview entirely", async () => {
    useApp.setState({
      datasets: [baseDataset({ id: "outside", source: { kind: "path", path: "/other/tree/x.csv" } })],
    });
    useRelink.setState({ oldRoot: "/old/data", newRoot: "/new/place" });

    await useRelink.getState().runPreview();

    expect(useRelink.getState().preview).toEqual([]);
    expect(toast).toHaveBeenCalledWith("no datasets have a source under that folder", "info");
  });

  it("grants read consent for the project's own recorded sources before probing (the consent ruling)", async () => {
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "ok",
      path: "x",
      size: 1,
      mtime: 1,
      checksum: "sha256:aa",
    });
    useApp.setState({ datasets: [baseDataset()] });
    useRelink.setState({ oldRoot: "/old/data", newRoot: "/new/place" });

    await useRelink.getState().runPreview();

    expect(desktopBridge.grantSourceReadPaths).toHaveBeenCalledWith(["/old/data/run1.csv"]);
  });
});

describe("runPreview — changed-source detection (box 4/5)", () => {
  beforeEach(() => vi.mocked(desktopBridge.hasDesktopShell).mockReturnValue(true));

  it("flags 'changed' when the checksum differs from what's recorded", async () => {
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "ok",
      path: "/new/place/run1.csv",
      size: 99,
      mtime: 999,
      checksum: "sha256:new",
    });
    useApp.setState({
      datasets: [baseDataset({ source: { kind: "path", path: "/old/data/run1.csv", checksum: "sha256:old" } })],
    });
    useRelink.setState({ oldRoot: "/old/data", newRoot: "/new/place" });

    await useRelink.getState().runPreview();

    expect(useRelink.getState().preview[0].changeVerdict).toBe("changed");
  });

  it("flags 'unchanged' when the checksum matches", async () => {
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "ok",
      path: "/new/place/run1.csv",
      size: 10,
      mtime: 100,
      checksum: "sha256:same",
    });
    useApp.setState({
      datasets: [baseDataset({ source: { kind: "path", path: "/old/data/run1.csv", checksum: "sha256:same" } })],
    });
    useRelink.setState({ oldRoot: "/old/data", newRoot: "/new/place" });

    await useRelink.getState().runPreview();

    expect(useRelink.getState().preview[0].changeVerdict).toBe("unchanged");
  });

  // F2 (code-review, investigated architectural finding — see this module's
  // "KNOWN LIMITATION" doc and POST_SPRINT_INDEPENDENT_REVIEW.md's R3
  // closure log): a relink CANDIDATE path is never read-consented in the
  // real desktop app (only paths in the project's server-tracked declared-
  // source set are — a candidate, by definition, isn't one yet), so
  // `probe_source` never computes a checksum for one — a checksum-bearing
  // dataset's fresh probe carries `checksum: null` even though the file is
  // perfectly reachable (state "ok", real size/mtime). This locks in the
  // HONEST degradation that limitation produces: never a false "unchanged"
  // (which would require a checksum match that can never happen), always
  // "unknown" for a dataset that recorded one.
  it("degrades honestly to 'unknown' (never a false 'unchanged') for a checksum-recorded dataset, matching a consent-accurate probe mock (checksum null, real size/mtime — the real desktop app's un-consented-candidate shape)", async () => {
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "ok",
      path: "/new/place/run1.csv",
      size: 10,
      mtime: 100,
      checksum: null, // consent-accurate: candidate paths are never granted today
    });
    useApp.setState({
      datasets: [baseDataset({ source: { kind: "path", path: "/old/data/run1.csv", checksum: "sha256:old" } })],
    });
    useRelink.setState({ oldRoot: "/old/data", newRoot: "/new/place" });

    await useRelink.getState().runPreview();

    expect(useRelink.getState().preview[0].changeVerdict).toBe("unknown");
    expect(useRelink.getState().preview[0].status).toBe("resolved"); // reachable — just unverifiable
  });
});

describe("commit (box 3: atomic, one undo entry)", () => {
  it("relinks every resolved+unchanged row in ONE history entry", async () => {
    useApp.setState({
      datasets: [
        // R3: commit() now recomputes the verdict from the LIVE dataset's
        // RECORDED provenance vs a fresh probe, so these need a recorded
        // checksum/mtime/size that genuinely matches the probe below for
        // the row to recompute as "unchanged".
        baseDataset({
          id: "a",
          source: { kind: "path", path: "/old/data/a.csv", checksum: "sha256:a", mtime: 1, size: 1 },
        }),
        baseDataset({
          id: "b",
          source: { kind: "path", path: "/old/data/b.csv", checksum: "sha256:b", mtime: 2, size: 2 },
        }),
      ],
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          // "unchanged" (not "unknown" — P1-2 defect 2 excludes unknown
          // rows from a bulk commit; this test is about the atomic-batch
          // guarantee for ordinarily committable rows, not that filter).
          changeVerdict: "unchanged",
          candidateChecksum: "sha256:a",
          candidateMtime: 1,
          candidateSize: 1,
        },
        {
          datasetId: "b",
          datasetName: "b.csv",
          oldPath: "/old/data/b.csv",
          candidatePath: "/new/place/b.csv",
          status: "resolved",
          changeVerdict: "unchanged",
          candidateChecksum: "sha256:b",
          candidateMtime: 2,
          candidateSize: 2,
        },
      ],
    });
    // P2: commit re-probes every candidate right before writing (TOCTOU
    // fix) — these mirror the Preview-time probes exactly (nothing changed
    // in the gap), so both rows commit as before.
    vi.mocked(desktopBridge.probeSource).mockImplementation(async (path: string) => {
      if (path === "/new/place/a.csv") {
        return { state: "ok", path, size: 1, mtime: 1, checksum: "sha256:a" };
      }
      return { state: "ok", path, size: 2, mtime: 2, checksum: "sha256:b" };
    });

    await useRelink.getState().commit();

    expect(useApp.getState().history).toHaveLength(1); // ONE undo entry for the whole batch
    const [a, b] = useApp.getState().datasets;
    expect(a.source).toEqual({ kind: "path", path: "/new/place/a.csv", checksum: "sha256:a", mtime: 1, size: 1 });
    expect(b.source).toEqual({ kind: "path", path: "/new/place/b.csv", checksum: "sha256:b", mtime: 2, size: 2 });

    useApp.getState().undo();
    expect(useApp.getState().datasets[0].source?.path).toBe("/old/data/a.csv");
    expect(useApp.getState().datasets[1].source?.path).toBe("/old/data/b.csv");
  });

  // P2 (adversarial review, TOCTOU): a file changed/vanished in the window
  // between Preview and clicking Relink must never write a stale checksum
  // silently — RED-FIRST against the pre-fix commit() (which trusted the
  // stale preview row with no re-probe at all).
  it("re-probes at commit time and drops a row whose content changed again since Preview", async () => {
    useApp.setState({
      datasets: [
        // R3: recorded checksum matches what Preview itself saw ("unchanged"
        // at Preview time) — the fresh commit-time probe below diverges from
        // BOTH the recorded checksum and the Preview snapshot.
        baseDataset({
          id: "a",
          source: { kind: "path", path: "/old/data/a.csv", checksum: "sha256:preview-time" },
        }),
      ],
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          // "unchanged" — this test exercises the commit-time TOCTOU
          // re-probe/drop path specifically, not the unknown-row exclusion
          // (a separate test below covers that).
          changeVerdict: "unchanged",
          candidateChecksum: "sha256:preview-time",
          candidateMtime: 1,
          candidateSize: 1,
        },
      ],
    });
    // The re-probe at commit time sees a DIFFERENT checksum than Preview did.
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "ok",
      path: "/new/place/a.csv",
      size: 2,
      mtime: 2,
      checksum: "sha256:changed-after-preview",
    });

    await useRelink.getState().commit();

    expect(useApp.getState().datasets[0].source?.path).toBe("/old/data/a.csv"); // untouched
    expect(useApp.getState().history).toHaveLength(0);
    // R3 recompute: the fresh checksum conflicts with the RECORDED one — a
    // distinct bucket (F4) from a Preview-only mismatch, since the recorded
    // checksum is what's actually being violated here.
    expect(toast).toHaveBeenCalledWith("nothing to relink — 1 conflicts with recorded provenance", "danger");
  });

  it("re-probes at commit time and drops a row that vanished since Preview", async () => {
    useApp.setState({
      datasets: [baseDataset({ id: "a", source: { kind: "path", path: "/old/data/a.csv" } })],
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          // "unchanged" — exercises the re-probe/vanished path, not the
          // unknown-row exclusion.
          changeVerdict: "unchanged",
          candidateChecksum: null,
          candidateMtime: null,
          candidateSize: null,
        },
      ],
    });
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "missing",
      path: "/new/place/a.csv",
      size: null,
      mtime: null,
      checksum: null,
    });

    await useRelink.getState().commit();

    expect(useApp.getState().datasets[0].source?.path).toBe("/old/data/a.csv");
    expect(useApp.getState().history).toHaveLength(0);
    // F4 (code-review, honest wording): "unreachable" is its own bucket now,
    // distinct from "changed" (content differs) — this row never even got a
    // fresh probe to compare content with.
    expect(toast).toHaveBeenCalledWith("nothing to relink — 1 unreachable", "danger");
  });

  it("excludes a 'changed' row from commit — never silently rewritten (box 2/5)", async () => {
    useApp.setState({
      datasets: [baseDataset({ id: "a", source: { kind: "path", path: "/old/data/a.csv", checksum: "sha256:old" } })],
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          changeVerdict: "changed",
          candidateChecksum: "sha256:new",
          candidateMtime: 1,
          candidateSize: 1,
        },
      ],
    });

    await useRelink.getState().commit();

    expect(useApp.getState().datasets[0].source).toEqual({
      kind: "path",
      path: "/old/data/a.csv",
      checksum: "sha256:old",
    });
    expect(useApp.getState().history).toHaveLength(0); // nothing committed, nothing to undo
  });

  // P1-2 DEFECT 2 (RED-FIRST): the pre-fix filter was `changeVerdict !==
  // "changed"`, which let "unknown" rows straight through — commit()
  // silently wrote a fresh path (and backfilled checksum/mtime/size) for a
  // row whose checksum could never be confirmed, exactly as if it had been
  // verified. "unknown" must be excluded from a BULK commit, and the
  // exclusion count must be named in the completion status.
  it("excludes an 'unknown' row from a bulk commit and names the exclusion count", async () => {
    useApp.setState({
      datasets: [
        baseDataset({ id: "a", source: { kind: "path", path: "/old/data/a.csv", checksum: "sha256:old" } }),
        // R3: recorded checksum matches the fresh commit-time probe below —
        // recomputes as genuinely "unchanged" so it stays committable.
        baseDataset({
          id: "b",
          source: { kind: "path", path: "/old/data/b.csv", checksum: "sha256:b", mtime: 2, size: 2 },
        }),
      ],
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          // recorded a checksum, but this session's probe couldn't confirm
          // it (defect 1's fix produces exactly this row shape).
          changeVerdict: "unknown",
          candidateChecksum: null,
          candidateMtime: 5,
          candidateSize: 5,
        },
        {
          datasetId: "b",
          datasetName: "b.csv",
          oldPath: "/old/data/b.csv",
          candidatePath: "/new/place/b.csv",
          status: "resolved",
          changeVerdict: "unchanged",
          candidateChecksum: "sha256:b",
          candidateMtime: 2,
          candidateSize: 2,
        },
      ],
    });
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "ok",
      path: "/new/place/b.csv",
      size: 2,
      mtime: 2,
      checksum: "sha256:b",
    });

    await useRelink.getState().commit();

    // Row "a" (unknown) is untouched; row "b" (unchanged) relinked.
    const datasets = useApp.getState().datasets;
    expect(datasets.find((d) => d.id === "a")!.source).toEqual({
      kind: "path",
      path: "/old/data/a.csv",
      checksum: "sha256:old",
    });
    expect(datasets.find((d) => d.id === "b")!.source?.path).toBe("/new/place/b.csv");
    expect(useApp.getState().history).toHaveLength(1); // still one entry for the whole batch
    const calls = vi.mocked(toast).mock.calls;
    const [msg] = calls[calls.length - 1];
    expect(msg).toMatch(/unverified|unknown|needs verification/i);
    expect(msg).toContain("1"); // names the exclusion count
  });

  it("commits an 'unknown' row once it has been escalated via escalateUnknownRow (per-row consent, not a global bypass)", async () => {
    useApp.setState({
      datasets: [
        baseDataset({ id: "a", source: { kind: "path", path: "/old/data/a.csv", checksum: "sha256:old" } }),
        baseDataset({ id: "b", source: { kind: "path", path: "/old/data/b.csv", checksum: "sha256:old-b" } }),
      ],
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          changeVerdict: "unknown",
          candidateChecksum: null,
          candidateMtime: 5,
          candidateSize: 5,
        },
        {
          datasetId: "b",
          datasetName: "b.csv",
          oldPath: "/old/data/b.csv",
          candidatePath: "/new/place/b.csv",
          status: "resolved",
          changeVerdict: "unknown",
          candidateChecksum: null,
          candidateMtime: 6,
          candidateSize: 6,
        },
      ],
    });
    vi.mocked(desktopBridge.probeSource).mockImplementation(async (path: string) => ({
      state: "ok",
      path,
      size: path.endsWith("a.csv") ? 5 : 6,
      mtime: path.endsWith("a.csv") ? 5 : 6,
      checksum: null, // still no fresh checksum this session — escalation is what unlocks it, not a magic re-probe
    }));

    useRelink.getState().escalateUnknownRow("a"); // only "a" gets per-row consent

    await useRelink.getState().commit();

    const datasets = useApp.getState().datasets;
    expect(datasets.find((d) => d.id === "a")!.source?.path).toBe("/new/place/a.csv"); // escalated: committed
    expect(datasets.find((d) => d.id === "b")!.source).toEqual({
      kind: "path",
      path: "/old/data/b.csv",
      checksum: "sha256:old-b",
    }); // NOT escalated: still excluded
  });

  // R3 (POST_SPRINT_INDEPENDENT_REVIEW.md, class #196 — RED-FIRST against
  // the pre-fix commit()): recorded checksum A, Preview's own probe failed
  // to compute a checksum ("unknown" verdict, null preview checksum), the
  // row is individually escalated, and the commit-time re-probe now DOES
  // return a checksum — but a DIFFERENT one, B. The pre-fix commit() only
  // ever compared the fresh probe against `row.candidateChecksum` (null
  // here), so the comparison short-circuited to "nothing to compare, trust
  // it" and silently overwrote recorded checksum A with B. The fix must
  // recompute against the LIVE dataset's recorded checksum A and refuse.
  it("refuses at commit when a fresh probe reveals a DIFFERENT checksum than what's recorded, even though Preview saw 'unknown' and the row was escalated", async () => {
    useApp.setState({
      datasets: [
        baseDataset({ id: "a", source: { kind: "path", path: "/old/data/a.csv", checksum: "sha256:A" } }),
        // A second, ordinary "unchanged" row so the batch isn't empty —
        // proves the refusal is per-row (status named in the summary), not
        // just "nothing committed at all".
        baseDataset({ id: "b", source: { kind: "path", path: "/old/data/b.csv", checksum: "sha256:b" } }),
      ],
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          // Preview's own probe couldn't confirm a checksum this session —
          // defect-1's "unknown" shape (recorded checksum, null probe).
          changeVerdict: "unknown",
          candidateChecksum: null,
          candidateMtime: 5,
          candidateSize: 5,
        },
        {
          datasetId: "b",
          datasetName: "b.csv",
          oldPath: "/old/data/b.csv",
          candidatePath: "/new/place/b.csv",
          status: "resolved",
          changeVerdict: "unchanged",
          candidateChecksum: "sha256:b",
          candidateMtime: 2,
          candidateSize: 2,
        },
      ],
    });
    // The commit-time re-probe for "a" now succeeds fully and returns
    // checksum B — genuinely DIFFERENT content than what was recorded as A.
    // "b" re-probes clean.
    vi.mocked(desktopBridge.probeSource).mockImplementation(async (path: string) => {
      if (path === "/new/place/a.csv") {
        return { state: "ok", path, size: 999, mtime: 999, checksum: "sha256:B" };
      }
      return { state: "ok", path, size: 2, mtime: 2, checksum: "sha256:b" };
    });

    useRelink.getState().escalateUnknownRow("a");

    await useRelink.getState().commit();

    // "a" refused: recorded provenance A must survive untouched, path included.
    const datasets = useApp.getState().datasets;
    expect(datasets.find((d) => d.id === "a")!.source).toEqual({
      kind: "path",
      path: "/old/data/a.csv",
      checksum: "sha256:A",
    });
    // "b" — an ordinary unrelated row — still commits normally.
    expect(datasets.find((d) => d.id === "b")!.source?.path).toBe("/new/place/b.csv");
    expect(useApp.getState().history).toHaveLength(1); // one entry for "b" alone
    const calls = vi.mocked(toast).mock.calls;
    const [msg] = calls[calls.length - 1];
    expect(msg).toMatch(/conflicts with recorded provenance/i);
    expect(msg).toContain("1");
  });

  // R3 #3 (the "still-unknown escalated commit" ruling): the fresh probe at
  // commit time STILL cannot produce a checksum (e.g. read consent lapsed
  // again this session) — the row stays committable because it was
  // escalated (that is what escalation means), but the written provenance
  // must be the dataset's ORIGINAL recorded fields, never a checksum/mtime/
  // size fabricated from the (incomplete) fresh probe.
  it("commits an escalated row whose fresh probe is STILL unknown, writing back the ORIGINAL recorded provenance rather than fabricating one", async () => {
    useApp.setState({
      datasets: [
        baseDataset({
          id: "a",
          source: { kind: "path", path: "/old/data/a.csv", checksum: "sha256:A", mtime: 10, size: 10 },
        }),
      ],
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          changeVerdict: "unknown",
          candidateChecksum: null,
          candidateMtime: 10,
          candidateSize: 10,
        },
      ],
    });
    // Fresh probe at commit succeeds (the path is reachable) but STILL
    // cannot compute a checksum — size/mtime match EXACTLY what's RECORDED
    // and what Preview itself showed (10/10 everywhere), so neither the
    // recorded-provenance guard nor the Preview-consent guard has anything
    // to object to (final review pass F1+F2: a stat MATCH here is not
    // "verified", it only fails to contradict) — only the RECORDED checksum
    // ("A") remains genuinely unconfirmable.
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "ok",
      path: "/new/place/a.csv",
      size: 10,
      mtime: 10,
      checksum: null,
    });

    useRelink.getState().escalateUnknownRow("a");

    await useRelink.getState().commit();

    expect(useApp.getState().datasets[0].source).toEqual({
      kind: "path",
      path: "/new/place/a.csv", // path DOES move
      checksum: "sha256:A", // ORIGINAL recorded checksum, unchanged
      mtime: 10, // ORIGINAL recorded mtime — the fresh probe agreed, never fabricated regardless
      size: 10, // ORIGINAL recorded size — same
    });
    expect(useApp.getState().history).toHaveLength(1);
  });

  // Final review pass (F1a code-review, RED-FIRST): recorded {checksum,
  // mtime 10, size 10} vs a fresh probe of {no checksum, mtime 5, size 5} —
  // the pre-fix guard reused sourceChangeVerdict's checksum-priority rule
  // and verified NOTHING (checksum unconfirmable -> "unknown"), so an
  // escalated row committed size-10 provenance for an observably size-5
  // file. Must refuse (recorded-conflict), zero mutation.
  it("refuses an escalated row when the fresh probe's size/mtime CONTRADICT what's recorded, even though the checksum itself is unconfirmable on both sides", async () => {
    useApp.setState({
      datasets: [
        baseDataset({
          id: "a",
          source: { kind: "path", path: "/old/data/a.csv", checksum: "sha256:A", mtime: 10, size: 10 },
        }),
      ],
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          changeVerdict: "unknown",
          candidateChecksum: null,
          candidateMtime: 10,
          candidateSize: 10,
        },
      ],
    });
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "ok",
      path: "/new/place/a.csv",
      size: 5,
      mtime: 5,
      checksum: null,
    });

    useRelink.getState().escalateUnknownRow("a");

    await useRelink.getState().commit();

    expect(useApp.getState().datasets[0].source).toEqual({
      kind: "path",
      path: "/old/data/a.csv",
      checksum: "sha256:A",
      mtime: 10,
      size: 10,
    });
    expect(useApp.getState().history).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith("nothing to relink — 1 conflicts with recorded provenance", "danger");
  });

  // Final review pass (F1b code-review, RED-FIRST): a Preview snapshot of
  // {checksum X, mtime 1, size 1} vs a fresh {no checksum, mtime 999, size
  // 999} — the pre-fix consent guard also reused checksum-priority and
  // passed a swapped file straight through. Must refuse (preview-mismatch).
  it("refuses an escalated legacy row when the fresh probe's size/mtime CONTRADICT what Preview showed, even though the checksum itself is unconfirmable on both sides", async () => {
    useApp.setState({
      datasets: [baseDataset({ id: "a", source: { kind: "path", path: "/old/data/a.csv" } })], // nothing recorded
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          changeVerdict: "unknown",
          candidateChecksum: "sha256:X",
          candidateMtime: 1,
          candidateSize: 1,
        },
      ],
    });
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "ok",
      path: "/new/place/a.csv",
      size: 999,
      mtime: 999,
      checksum: null,
    });

    useRelink.getState().escalateUnknownRow("a");

    await useRelink.getState().commit();

    expect(useApp.getState().datasets[0].source).toEqual({ kind: "path", path: "/old/data/a.csv" });
    expect(useApp.getState().history).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith("nothing to relink — 1 changed since Preview", "danger");
  });

  // F1 (code-review regression, RED-FIRST): a LEGACY dataset with EMPTY
  // recorded provenance (no checksum, no mtime, no size — never had a
  // bridge, or imported before P1.7) can never produce a "changed" verdict
  // from the recorded-vs-fresh recompute alone (nothing recorded to compare
  // against). The pre-fix rewrite dropped the ONLY thing anchoring trust for
  // this case — the old "does the fresh checksum still match what Preview
  // itself showed" guard — so an escalated legacy row committed whatever
  // was at the candidate path NOW, even if it was NOT what the user saw and
  // consented to at Preview time.
  it("refuses an escalated legacy-provenance row when the fresh commit-time checksum differs from what Preview itself showed (consent guard)", async () => {
    useApp.setState({
      datasets: [baseDataset({ id: "a", source: { kind: "path", path: "/old/data/a.csv" } })], // nothing recorded at all
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          // Legacy dataset -> always "unknown" at Preview (nothing recorded
          // to compare against), but Preview's OWN probe DID read a
          // checksum — X — and showed it to the user.
          changeVerdict: "unknown",
          candidateChecksum: "sha256:X",
          candidateMtime: 1,
          candidateSize: 1,
        },
      ],
    });
    // The commit-time re-probe now reads DIFFERENT content — checksum Y.
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "ok",
      path: "/new/place/a.csv",
      size: 2,
      mtime: 2,
      checksum: "sha256:Y",
    });

    useRelink.getState().escalateUnknownRow("a");

    await useRelink.getState().commit();

    // Refused: the dataset (still with nothing recorded) is untouched.
    expect(useApp.getState().datasets[0].source).toEqual({ kind: "path", path: "/old/data/a.csv" });
    expect(useApp.getState().history).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith("nothing to relink — 1 changed since Preview", "danger");
  });

  // F2 (code-review regression, RED-FIRST): once F1's consent guard is
  // satisfied (the fresh probe matches what Preview showed), a LEGACY
  // dataset with nothing recorded should have its genuinely-confirmed
  // provenance BACKFILLED — the documented "fills a genuine gap rather than
  // leaving it forever blank" behavior — not left blank forever just
  // because the recorded-vs-fresh recompute itself says "unknown" (it
  // always will, for a dataset with nothing on file to compare against).
  it("backfills provenance for an escalated legacy-provenance row once the fresh checksum matches what Preview showed", async () => {
    useApp.setState({
      datasets: [baseDataset({ id: "a", source: { kind: "path", path: "/old/data/a.csv" } })], // nothing recorded
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          changeVerdict: "unknown",
          candidateChecksum: "sha256:X",
          candidateMtime: 1,
          candidateSize: 1,
        },
      ],
    });
    // The commit-time re-probe reads the SAME content — checksum X — that
    // Preview itself showed the user.
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "ok",
      path: "/new/place/a.csv",
      size: 1,
      mtime: 1,
      checksum: "sha256:X",
    });

    useRelink.getState().escalateUnknownRow("a");

    await useRelink.getState().commit();

    // Committed AND backfilled — a genuine gap filled in, not fabricated:
    // this is exactly the checksum the user consented to at Preview.
    expect(useApp.getState().datasets[0].source).toEqual({
      kind: "path",
      path: "/new/place/a.csv",
      checksum: "sha256:X",
      mtime: 1,
      size: 1,
    });
    expect(useApp.getState().history).toHaveLength(1);
  });

  // F3 (code-review regression, RED-FIRST): `liveById` is read BEFORE the
  // awaited `probeSource` calls, so a dataset's recorded source can be
  // swapped out from under a row WHILE that probe is in flight (a reimport
  // or a second relink landing mid-commit) — a gap the identity check that
  // runs before the probe cannot see. The final apply must re-verify
  // identity again, synchronously, immediately before writing.
  it("fails closed with zero mutation when a dataset's recorded source is swapped WHILE its commit-time probe is in flight", async () => {
    useApp.setState({
      datasets: [baseDataset({ id: "a", source: { kind: "path", path: "/old/data/a.csv", checksum: "sha256:a" } })],
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          changeVerdict: "unchanged",
          candidateChecksum: "sha256:a",
          candidateMtime: 1,
          candidateSize: 1,
        },
      ],
    });
    // A controllable probe: commit() awaits this, and the test swaps the
    // dataset's recorded source WHILE it is pending, before resolving it.
    let releaseProbe: () => void = () => {};
    const probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    vi.mocked(desktopBridge.probeSource).mockImplementation(async (path: string) => {
      await probeGate;
      return { state: "ok", path, size: 1, mtime: 1, checksum: "sha256:a" };
    });

    const commitPromise = useRelink.getState().commit();
    // Swap the dataset's recorded source mid-flight — a reimport or a
    // second relink landing in the exact window the probe is awaited.
    useApp.setState((state) => ({
      datasets: state.datasets.map((d) =>
        d.id === "a" ? { ...d, source: { kind: "path" as const, path: "/elsewhere/a.csv", checksum: "sha256:elsewhere" } } : d,
      ),
    }));
    releaseProbe();
    await commitPromise;

    // Fails closed: the swapped-in source survives untouched, never
    // overwritten by the stale-identity candidate.
    expect(useApp.getState().datasets[0].source).toEqual({
      kind: "path",
      path: "/elsewhere/a.csv",
      checksum: "sha256:elsewhere",
    });
    expect(useApp.getState().history).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith("nothing to relink — 1 moved/reimported", "danger");
  });

  // F3 (code-review, RED-FIRST — the referential-identity strengthening):
  // a SAME-PATH swap — a project reload or an undo landing in the exact
  // probe-in-flight window, reconstructing a `source` object that is
  // value-equal (same path, same checksum) but NOT the same object — must
  // still fail closed. A path-string re-check (the pre-fix shape) would see
  // an identical string and wave this straight through; only a referential
  // (`===`) check against the EXACT object the write was computed against
  // catches it.
  it("fails closed with zero mutation when a dataset's source is replaced by a VALUE-EQUAL but different object (same path) mid-probe", async () => {
    useApp.setState({
      datasets: [baseDataset({ id: "a", source: { kind: "path", path: "/old/data/a.csv", checksum: "sha256:a" } })],
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          changeVerdict: "unchanged",
          candidateChecksum: "sha256:a",
          candidateMtime: 1,
          candidateSize: 1,
        },
      ],
    });
    let releaseProbe: () => void = () => {};
    const probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    vi.mocked(desktopBridge.probeSource).mockImplementation(async (path: string) => {
      await probeGate;
      return { state: "ok", path, size: 1, mtime: 1, checksum: "sha256:a" };
    });

    const commitPromise = useRelink.getState().commit();
    // Replace the dataset's `source` with a BRAND NEW object carrying the
    // EXACT SAME path and checksum — value-equal, not reference-equal (a
    // project reload re-parsing the same `.dwk`, or an undo restoring a
    // snapshot, both reconstruct fresh objects this way).
    useApp.setState((state) => ({
      datasets: state.datasets.map((d) =>
        d.id === "a" ? { ...d, source: { kind: "path" as const, path: "/old/data/a.csv", checksum: "sha256:a" } } : d,
      ),
    }));
    releaseProbe();
    await commitPromise;

    // Fails closed: never overwrites a `source` that isn't LITERALLY the
    // one the write was computed against, even though its path/checksum
    // read identically to what was there before.
    expect(useApp.getState().datasets[0].source?.path).toBe("/old/data/a.csv");
    expect(useApp.getState().history).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith("nothing to relink — 1 moved/reimported", "danger");
  });

  // R3 #4: the dataset a row named was removed between Preview and commit
  // (e.g. the user deleted it from the project mid-panel) — fail closed for
  // that row, zero mutation, no crash.
  it("fails closed with zero mutation when a dataset is removed between Preview and commit", async () => {
    useApp.setState({
      datasets: [
        baseDataset({ id: "a", source: { kind: "path", path: "/old/data/a.csv", checksum: "sha256:a" } }),
        baseDataset({ id: "b", source: { kind: "path", path: "/old/data/b.csv", checksum: "sha256:b" } }),
      ],
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          changeVerdict: "unchanged",
          candidateChecksum: "sha256:a",
          candidateMtime: 1,
          candidateSize: 1,
        },
        {
          datasetId: "removed",
          datasetName: "gone.csv",
          oldPath: "/old/data/gone.csv",
          candidatePath: "/new/place/gone.csv",
          status: "resolved",
          changeVerdict: "unchanged",
          candidateChecksum: "sha256:gone",
          candidateMtime: 1,
          candidateSize: 1,
        },
      ],
    });
    vi.mocked(desktopBridge.probeSource).mockResolvedValue({
      state: "ok",
      path: "/new/place/a.csv",
      size: 1,
      mtime: 1,
      checksum: "sha256:a",
    });

    await useRelink.getState().commit();

    // "a" (still present) commits; "removed" (gone from the store by the
    // time commit ran) is refused with zero mutation — there is nothing to
    // even assert on for it, other than that the batch didn't crash and "a"
    // was not blocked by it.
    const datasets = useApp.getState().datasets;
    expect(datasets.find((d) => d.id === "a")!.source?.path).toBe("/new/place/a.csv");
    expect(datasets.find((d) => d.id === "b")!.source?.path).toBe("/old/data/b.csv"); // untouched, unrelated
    const calls = vi.mocked(toast).mock.calls;
    const [msg] = calls[calls.length - 1];
    expect(msg).toMatch(/moved/i);
  });

  // R3 #4: the dataset's RECORDED source path itself changed between
  // Preview and commit (an independent relink/reimport landed in the gap) —
  // its identity no longer matches what Preview computed a candidate for.
  // Fail closed: never blindly overwrite whatever it points to NOW.
  it("fails closed with zero mutation when a dataset's recorded source changes (reimported/relinked) between Preview and commit", async () => {
    useApp.setState({
      datasets: [
        baseDataset({ id: "a", source: { kind: "path", path: "/old/data/a.csv", checksum: "sha256:a" } }),
      ],
    });
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "resolved",
          changeVerdict: "unchanged",
          candidateChecksum: "sha256:a",
          candidateMtime: 1,
          candidateSize: 1,
        },
      ],
    });
    // Between Preview and the Relink click, something else already moved
    // this dataset's recorded source out from under it (a concurrent
    // relink, or a reimport that swapped the source path).
    useApp.setState((state) => ({
      datasets: state.datasets.map((d) =>
        d.id === "a" ? { ...d, source: { kind: "path" as const, path: "/elsewhere/a.csv", checksum: "sha256:elsewhere" } } : d,
      ),
    }));

    await useRelink.getState().commit();

    expect(useApp.getState().datasets[0].source).toEqual({
      kind: "path",
      path: "/elsewhere/a.csv",
      checksum: "sha256:elsewhere",
    });
    expect(useApp.getState().history).toHaveLength(0);
    expect(desktopBridge.probeSource).not.toHaveBeenCalled(); // never even probed a candidate for a stale identity
    // F4 (code-review, honest wording): this is neither "changed" content
    // nor "unreachable" — the dataset's recorded identity itself moved on,
    // named as its own bucket.
    expect(toast).toHaveBeenCalledWith("nothing to relink — 1 moved/reimported", "danger");
  });

  it("reports nothing-to-relink instead of committing an empty batch", async () => {
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/data/a.csv",
          candidatePath: "/new/place/a.csv",
          status: "missing",
          changeVerdict: "unknown",
          candidateChecksum: null,
          candidateMtime: null,
          candidateSize: null,
        },
      ],
    });

    await useRelink.getState().commit();

    expect(useApp.getState().history).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith("nothing to relink — no resolved, unchanged candidates", "danger");
  });
});

describe("importChangedAsNewVersion (box 5)", () => {
  it("imports the source and tags the NEW dataset with versionOf — never touches the original", async () => {
    vi.mocked(importFile).mockResolvedValue({
      time: [0],
      values: [[1]],
      labels: ["m"],
      units: ["emu"],
      metadata: {},
    });
    useApp.setState({
      datasets: [baseDataset({ id: "orig", source: { kind: "path", path: "/old/data/run1.csv" } })],
    });

    await useRelink.getState().importChangedAsNewVersion("orig");

    const datasets = useApp.getState().datasets;
    expect(datasets).toHaveLength(2);
    const original = datasets.find((d) => d.id === "orig")!;
    const created = datasets.find((d) => d.id !== "orig")!;
    expect(original.data.values).toEqual([[1], [2]]); // untouched, per L0.32 "never refreshes in place"
    expect(created.versionOf).toBe("orig");
  });

  // P1-2 DEFECT 3 (RED-FIRST): `importPaths` records ONE history entry PER
  // created dataset (addDataset -> recordHistory each time), so a
  // multi-book Origin source produced N history entries here, and the
  // trailing versionOf setState rode on whatever entry happened to end up
  // last — Undo stranded the earlier books' versionOf tags (and only
  // reverted the last-created book). The whole operation — import of ALL
  // created datasets + versionOf tagging — must land as exactly ONE undo
  // step, the same guarantee commit() already has (relink.test.ts's "ONE
  // history entry for the whole batch", pinned right above).
  it("records exactly ONE history entry for a multi-dataset import, and one Undo reverts BOTH the datasets and the versionOf tags", async () => {
    vi.mocked(importFile).mockResolvedValue({
      time: [0],
      values: [[0]],
      labels: ["m"],
      units: ["emu"],
      metadata: {},
      books: [
        { time: [0], values: [[1]], labels: ["m"], units: ["emu"], metadata: { origin_book: "Book1" } },
        { time: [0], values: [[2]], labels: ["m"], units: ["emu"], metadata: { origin_book: "Book2" } },
      ],
    });
    useApp.setState({
      datasets: [baseDataset({ id: "orig", source: { kind: "path", path: "/old/data/run1.opj" } })],
      history: [],
    });
    const before = useApp.getState().history.length;

    await useRelink.getState().importChangedAsNewVersion("orig");

    // The fan-out really happened (2 books from 1 source) — otherwise this
    // test would pass vacuously.
    const datasetsAfter = useApp.getState().datasets;
    expect(datasetsAfter).toHaveLength(3);
    const created = datasetsAfter.filter((d) => d.id !== "orig");
    expect(created).toHaveLength(2);
    expect(created.every((d) => d.versionOf === "orig")).toBe(true);

    expect(useApp.getState().history.length - before).toBe(1); // ONE entry for the whole batch

    useApp.getState().undo();

    const datasetsUndone = useApp.getState().datasets;
    expect(datasetsUndone).toHaveLength(1); // BOTH created datasets gone
    expect(datasetsUndone[0].id).toBe("orig");
    expect(datasetsUndone.some((d) => d.versionOf === "orig")).toBe(false); // no stranded versionOf tag
  });
});

// R6 (POST_SPRINT_INDEPENDENT_REVIEW.md): `withHistoryBatch` suppresses
// `historySuppressed` for the entire duration of `importChangedAsNewVersion`'s
// await (a real network round trip via `importFile`). Before the fix, ANY
// unrelated `recordHistory` call landing in that window — nothing in the UI
// blocks one — was silently absorbed into the import's single undo entry:
// its own mutation happened, but no entry of its own was pushed, so undoing
// the import also reverted (and stranded, on redo) the unrelated edit with
// no way to undo/redo it independently. Red-first: a controllably-delayed
// import, with a second edit (`renameDataset`) attempted before it resolves.
describe("R6: an unrelated edit during an in-flight import-as-new-version batch", () => {
  it("gets its own independent undo/redo entry, never absorbed into the import's batch", async () => {
    useApp.setState({
      datasets: [
        baseDataset({ id: "orig", source: { kind: "path", path: "/old/data/run1.csv" } }),
        {
          id: "other",
          name: "other",
          data: { time: [0], values: [[1]], labels: ["m"], units: ["emu"], metadata: {} },
        },
      ],
      history: [],
    });

    // A controllable, never-resolves-until-we-say-so import — stands in for
    // the real network round trip `importFile` makes.
    let resolveImport!: (data: {
      time: number[];
      values: number[][];
      labels: string[];
      units: string[];
      metadata: Record<string, never>;
    }) => void;
    vi.mocked(importFile).mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );

    const importPromise = useRelink.getState().importChangedAsNewVersion("orig");

    // Sanity: this test is actually exercising the batch's in-flight window,
    // not racing past it — the import genuinely has not settled yet, and the
    // store is genuinely mid-batch.
    expect(useApp.getState().historySuppressed).toBe(true);
    expect(useApp.getState().datasets).toHaveLength(2); // nothing created yet

    // The second, unrelated edit — attempted WHILE the import is pending.
    useApp.getState().renameDataset("other", "renamed while pending");
    expect(useApp.getState().datasets.find((d) => d.id === "other")!.name).toBe("renamed while pending");

    resolveImport({ time: [0], values: [[9]], labels: ["m"], units: ["emu"], metadata: {} });
    await importPromise;

    // Two SEPARATE entries — the rename was never folded into the import's
    // one undo step.
    const { history } = useApp.getState();
    expect(history.map((h) => h.label)).toEqual([
      "rename dataset",
      'import "run1.csv" as a new version',
    ]);

    // Undo unwinds the import first (LIFO) — the rename is untouched.
    useApp.getState().undo();
    let live = useApp.getState().datasets;
    expect(live.find((d) => d.id === "other")!.name).toBe("renamed while pending"); // rename survives
    expect(live.some((d) => d.versionOf === "orig")).toBe(false); // import undone

    // Undo again reverts the rename, independently.
    useApp.getState().undo();
    expect(useApp.getState().datasets.find((d) => d.id === "other")!.name).toBe("other");
    expect(useApp.getState().history).toHaveLength(0);

    // Redo replays each step independently, in order.
    useApp.getState().redo();
    expect(useApp.getState().datasets.find((d) => d.id === "other")!.name).toBe("renamed while pending");
    useApp.getState().redo();
    live = useApp.getState().datasets;
    expect(live.some((d) => d.versionOf === "orig")).toBe(true);
    expect(live.find((d) => d.id === "other")!.name).toBe("renamed while pending");
  });
});

// R6 code-review round, F1 (POST_SPRINT_INDEPENDENT_REVIEW.md): `runImport`
// used to `await presentBatchOutcome(...)` INSIDE `withHistoryBatch`'s window,
// AFTER the batch's only fold — and `presentBatchOutcome`'s own recipe-
// suggestion branch makes REAL awaits (a dynamic `./globalPlotRecipes`
// import, `cleanMatchingPlotRecipe`'s own async match) on exactly the path
// this call takes (one created dataset + a saved recipe present). That
// reopened the batch-token fix's own hole: a foreign edit landing in that
// window still got its own entry, but the batch's fold-time-frozen snapshot
// would still revert it on undo — corrupting the stack exactly like the
// original defect, just moved to a later window. Fixed by having
// `importPaths({ presentOutcome: false })` skip the cascade entirely for
// this caller. Proven here with a `cleanMatchingPlotRecipe` stand-in that
// NEVER resolves: if the cascade were still reached, `importChangedAsNewVersion`
// would hang waiting on it — the test's own short timeout turns that into a
// fast, unambiguous red instead of the suite's full default timeout.
describe("R6 F1: import-as-new-version must not await the post-import outcome cascade", () => {
  it(
    "never consults the recipe-suggestion cascade even when a saved recipe exists",
    async () => {
      useApp.setState({
        datasets: [baseDataset({ id: "orig", source: { kind: "path", path: "/old/data/run1.csv" } })],
        // A real candidate for presentBatchOutcome's recipe branch to have
        // found, had it run — the cheap `plotRecipes.length > 0` check alone
        // is enough to route it to `cleanMatchingPlotRecipe` below.
        plotRecipes: [{}] as unknown as AppState["plotRecipes"],
        history: [],
      });
      vi.mocked(importFile).mockResolvedValue({
        time: [0],
        values: [[9]],
        labels: ["m"],
        units: ["emu"],
        metadata: {},
      });
      const recipeSpy = vi.fn(() => new Promise<never>(() => {}));
      useApp.setState({ cleanMatchingPlotRecipe: recipeSpy as unknown as AppState["cleanMatchingPlotRecipe"] });

      await useRelink.getState().importChangedAsNewVersion("orig");

      expect(recipeSpy).not.toHaveBeenCalled();
      // Clean, single entry — exactly what an operation with zero real
      // awaits after its last fold produces (no corruption, nothing stuck).
      expect(useApp.getState().history.map((h) => h.label)).toEqual([
        'import "run1.csv" as a new version',
      ]);
      expect(useApp.getState().datasets.some((d) => d.versionOf === "orig")).toBe(true);
    },
    2000,
  );
});

// R6 code-review round, F2: the before/after dataset-id SET-DIFF this
// function used to compute (`before` snapshotted, then re-diffed against the
// live store after `importPaths` resolved) mislabeled ANY dataset a
// concurrent, unblocked action created during the same window as `versionOf`
// — paste, demo-data, and merge are all still fully clickable while this
// batch is in flight (same audit as R6's own reachability verdict). Fixed by
// reading `importPaths`'s own returned ids directly instead of diffing.
describe("R6 F2: importChangedAsNewVersion must not versionOf-tag a concurrently added dataset", () => {
  it("tags only the dataset importPaths itself reports creating, never one added by an unrelated concurrent action", async () => {
    useApp.setState({
      datasets: [baseDataset({ id: "orig", source: { kind: "path", path: "/old/data/run1.csv" } })],
      history: [],
    });

    let resolveImport!: (data: {
      time: number[];
      values: number[][];
      labels: string[];
      units: string[];
      metadata: Record<string, never>;
    }) => void;
    vi.mocked(importFile).mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );

    const importPromise = useRelink.getState().importChangedAsNewVersion("orig");

    // An unrelated, concurrent dataset add — e.g. a paste or demo-data
    // gesture — landing in the SAME window the old before/after diff would
    // have scanned.
    useApp.getState().addDataset({
      id: "concurrent",
      name: "pasted",
      data: { time: [0], values: [[5]], labels: ["m"], units: ["emu"], metadata: {} },
    });

    resolveImport({ time: [0], values: [[9]], labels: ["m"], units: ["emu"], metadata: {} });
    await importPromise;

    const datasets = useApp.getState().datasets;
    const tagged = datasets.filter((d) => d.versionOf === "orig");
    expect(tagged).toHaveLength(1);
    expect(tagged[0].id).not.toBe("concurrent"); // the concurrent add is NEVER mistaken for the import's own dataset
    expect(datasets.find((d) => d.id === "concurrent")!.versionOf).toBeUndefined();
  });
});
