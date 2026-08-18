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
          changeVerdict: "unknown",
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
          changeVerdict: "unknown",
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
          changeVerdict: "unknown",
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
          changeVerdict: "unknown",
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
});
