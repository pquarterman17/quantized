// Folder-level bulk operations (project-organization plan item 8). The ops are
// module-level helpers over useApp.getState(), so they test without rendering:
// seed the store, call the op, assert the store/api effect.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyActiveCorrectionsToFolder,
  exportFolderCsv,
  folderContents,
  removeFolderWithDatasets,
  runTemplateOnFolder,
  selectFolderContents,
} from "./folderOps";
import {
  applyCorrections as applyCorrectionsApi,
  exportConsolidated,
  fitModel,
  reportEmit,
} from "../../lib/api";
import type { Dataset, DataStruct, FolderNode } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { askParams } from "../overlays/ParamDialog";

vi.mock("../../lib/api", () => ({
  applyCorrections: vi.fn(),
  exportConsolidated: vi.fn(),
  fitModel: vi.fn(),
  reportEmit: vi.fn(),
}));
vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const raw: DataStruct = {
  time: [1, 2, 3],
  values: [[10], [20], [30]],
  labels: ["m"],
  units: ["emu"],
  metadata: {},
};

const fld = (id: string, parentId: string | null = null, order = 0): FolderNode => ({
  id,
  name: id,
  parentId,
  order,
});
const ds = (id: string, folderId?: string, extra?: Partial<Dataset>): Dataset => ({
  id,
  name: `${id}.dat`,
  data: raw,
  ...(folderId ? { folderId } : {}),
  ...extra,
});

/** Two-folder tree: "grp" ── "sub"; d1 in grp, d2 in sub, d3 at the root. */
function seed() {
  useApp.setState({
    datasets: [ds("d1", "grp"), ds("d2", "sub"), ds("d3")],
    folders: [fld("grp"), fld("sub", "grp")],
    activeId: "d3",
    selectedIds: ["d3"],
    reports: [],
    status: "",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seed();
});

describe("folderContents / selectFolderContents", () => {
  it("resolves the whole subtree (sub-folder members included, outsiders not)", () => {
    expect(folderContents("grp").map((d) => d.id)).toEqual(["d2", "d1"]);
  });

  it("replaces the selection with the folder contents without moving the plot", () => {
    selectFolderContents(fld("grp"));
    const s = useApp.getState();
    expect(s.selectedIds).toEqual(["d2", "d1"]);
    expect(s.activeId).toBe("d3"); // plot unaffected
  });
});

describe("exportFolderCsv", () => {
  it("sends the subtree datasets to the consolidated exporter, named for the folder", async () => {
    vi.mocked(exportConsolidated).mockResolvedValue(undefined);
    await exportFolderCsv({ ...fld("grp"), name: "My Group" });
    expect(exportConsolidated).toHaveBeenCalledWith({
      datasets: [
        { dataset: raw, name: "d2.dat" },
        { dataset: raw, name: "d1.dat" },
      ],
      filename: "My_Group.csv",
    });
  });

  it("is a no-op on an empty folder", async () => {
    useApp.setState({ folders: [fld("empty")] });
    await exportFolderCsv(fld("empty"));
    expect(exportConsolidated).not.toHaveBeenCalled();
  });

  it("surfaces a failed export in the status bar instead of throwing", async () => {
    vi.mocked(exportConsolidated).mockRejectedValue(new Error("boom"));
    await exportFolderCsv(fld("grp"));
    expect(useApp.getState().status).toContain("export failed: boom");
  });
});

describe("applyActiveCorrectionsToFolder", () => {
  it("copies the active dataset's corrections onto every folder member", async () => {
    useApp.setState({
      datasets: [
        ds("d1", "grp"),
        ds("d2", "sub"),
        ds("d3", undefined, { corrections: { xOff: 5 }, raw }),
      ],
    });
    vi.mocked(applyCorrectionsApi).mockResolvedValue(raw);
    await applyActiveCorrectionsToFolder(fld("grp"));
    // One api call per member (d2, d1), each carrying the source's params.
    expect(applyCorrectionsApi).toHaveBeenCalledTimes(2);
    const params = vi
      .mocked(applyCorrectionsApi)
      .mock.calls.map((c) => (c[0] as { params: unknown }).params);
    expect(params).toEqual([{ xOff: 5 }, { xOff: 5 }]);
  });

  it("does nothing when the active dataset has no corrections", async () => {
    await applyActiveCorrectionsToFolder(fld("grp"));
    expect(applyCorrectionsApi).not.toHaveBeenCalled();
  });
});

describe("runTemplateOnFolder", () => {
  const template = {
    version: 1,
    name: "T",
    steps: [{ id: "", kind: "fit", label: "Fit Linear", code: "qz.fit()", params: { model: "Linear" } }],
    outputs: ["a", "b", "R2"],
  };

  beforeEach(() => {
    localStorage.setItem("qz.analysisTemplates", JSON.stringify([template]));
  });

  it("runs the picked template over every folder member and lands a summary", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "T" });
    vi.mocked(fitModel).mockResolvedValue({ params: [1, 2], R2: 0.9 });
    vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } });
    await runTemplateOnFolder(fld("grp"));

    const s = useApp.getState();
    expect(fitModel).toHaveBeenCalledTimes(2); // d2 + d1
    const summary = s.datasets.find((d) => d.name.startsWith("T — grp"));
    expect(summary).toBeDefined();
    expect(summary!.data.values).toEqual([
      [1, 2, 0.9],
      [1, 2, 0.9],
    ]);
    expect(s.reports).toHaveLength(2); // one #36 report per member
    expect(s.pipelineRunning).toBe(false); // released even on success
  });

  it("a cancelled picker runs nothing", async () => {
    vi.mocked(askParams).mockResolvedValue(null);
    await runTemplateOnFolder(fld("grp"));
    expect(fitModel).not.toHaveBeenCalled();
  });

  it("a failing member yields a NaN-flagged row, not a dead run", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "T" });
    vi.mocked(fitModel)
      .mockRejectedValueOnce(new Error("no convergence"))
      .mockResolvedValueOnce({ params: [1, 2], R2: 0.9 });
    vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } });
    await runTemplateOnFolder(fld("grp"));
    const summary = useApp.getState().datasets.find((d) => d.name.startsWith("T — grp"));
    // Row 1 failed → all-NaN; row 2 succeeded. NaN-flagged, both rows present.
    expect(summary!.data.values).toHaveLength(2);
    expect(summary!.data.values[0].every(Number.isNaN)).toBe(true);
    expect(summary!.data.values[1]).toEqual([1, 2, 0.9]);
  });
});

describe("removeFolderWithDatasets", () => {
  it("removes the folder subtree AND its datasets; outsiders survive", () => {
    removeFolderWithDatasets(fld("grp"));
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.id)).toEqual(["d3"]);
    expect(s.folders).toEqual([]); // grp + sub both gone (cascade)
  });
});
