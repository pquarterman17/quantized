// P1.7 box 3/4/5: relink-one / relink-folder dry-run preview, atomic commit
// (ONE undo entry), and "changed source -> import as new version".

import { beforeEach, describe, expect, it, vi } from "vitest";

import { importFile } from "../lib/api";
import * as desktopBridge from "../lib/desktopBridge";
import type { Dataset } from "../lib/types";
import { useRelink } from "./relink";
import { toast } from "./toasts";
import { useApp } from "./useApp";

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
  useRelink.setState({ open: false, oldRoot: "", newRoot: "", preview: [], busy: false, bridgeAvailable: false });
  vi.mocked(desktopBridge.grantSourceReadPaths).mockResolvedValue([]);
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
});

describe("commit (box 3: atomic, one undo entry)", () => {
  it("relinks every resolved+unchanged row in ONE history entry", async () => {
    useApp.setState({
      datasets: [
        baseDataset({ id: "a", source: { kind: "path", path: "/old/data/a.csv" } }),
        baseDataset({ id: "b", source: { kind: "path", path: "/old/data/b.csv" } }),
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
    expect(toast).toHaveBeenCalledWith(
      "nothing to relink — every candidate changed or became unreachable since Preview",
      "danger",
    );
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
        baseDataset({ id: "b", source: { kind: "path", path: "/old/data/b.csv" } }),
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

  it("commits an 'unknown' row once it has been escalated via useAnyway (per-row consent, not a global bypass)", async () => {
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

    useRelink.getState().useAnyway("a"); // only "a" gets per-row consent

    await useRelink.getState().commit();

    const datasets = useApp.getState().datasets;
    expect(datasets.find((d) => d.id === "a")!.source?.path).toBe("/new/place/a.csv"); // escalated: committed
    expect(datasets.find((d) => d.id === "b")!.source).toEqual({
      kind: "path",
      path: "/old/data/b.csv",
      checksum: "sha256:old-b",
    }); // NOT escalated: still excluded
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
