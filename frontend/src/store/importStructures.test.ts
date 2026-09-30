// A .cif through the ordinary import path (⌘O, drag-drop, the native dialog)
// becomes a crystal-structure LATTICE PRESET, not a Library dataset: it goes
// to /api/structures/*, never the DataStruct parser, and a mixed batch still
// imports its data files as datasets.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { importFile, uploadFile } from "../lib/api";
import { importStructurePath, uploadStructure, type CrystalStructure } from "../lib/api/structures";
import { probeSource } from "../lib/desktopBridge";
import { useCrystalStructures } from "./crystalStructures";
import { useImportBatch } from "./importBatch";
import { importCore } from "./importDatasetsLazy";
import { usePendingOps } from "./pendingOps";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  importFile: vi.fn(),
  uploadFile: vi.fn(),
}));
vi.mock("../lib/api/structures", () => ({ uploadStructure: vi.fn(), importStructurePath: vi.fn() }));
vi.mock("../lib/desktopBridge", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  probeSource: vi.fn(),
}));

const SI: CrystalStructure = {
  name: "Si", source_name: "si.cif", formula: "Si", space_group: "F d -3 m",
  cell: { a: 5.4309, b: 5.4309, c: 5.4309, alpha: 90, beta: 90, gamma: 90 }, atom_sites: [],
};
const DATA = { time: [0, 1], values: [[1], [2]], labels: ["I"], units: [""], metadata: {} };
const toastMsgs = () => useToasts.getState().toasts.map((t) => t.msg);

beforeAll(async () => {
  await importCore();
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [], folders: [], activeId: null, selectedIds: [] });
  useCrystalStructures.setState({ presets: [] });
  useImportBatch.setState({ running: false });
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
  vi.mocked(uploadFile).mockResolvedValue(DATA);
  vi.mocked(importFile).mockResolvedValue(DATA);
  vi.mocked(uploadStructure).mockResolvedValue(SI);
  vi.mocked(importStructurePath).mockResolvedValue(SI);
  vi.mocked(probeSource).mockResolvedValue(null);
});

describe("CIF import path", () => {
  it("a picked .cif becomes a lattice preset; the .dat beside it a dataset", async () => {
    const cif = new File(["data_Si"], "si.cif");
    const dat = new File(["1 2"], "scan.dat");
    const ids = await useApp.getState().importFiles([cif, dat]);

    expect(uploadStructure).toHaveBeenCalledWith(cif, expect.any(AbortSignal));
    expect(vi.mocked(uploadFile).mock.calls.map((c) => c[0].name)).toEqual(["scan.dat"]);
    expect(ids).toHaveLength(1);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["scan.dat"]);
    expect(useCrystalStructures.getState().presets.map((p) => p.name)).toEqual(["Si"]);
    expect(toastMsgs().some((m) => /lattice preset.*Si/.test(m))).toBe(true);
  });

  it("a natively picked .CIF path goes to /api/structures/import", async () => {
    const ids = await useApp.getState().importPaths(["/data/xtal/Si.CIF"]);
    expect(importStructurePath).toHaveBeenCalledWith("/data/xtal/Si.CIF", expect.any(AbortSignal));
    expect(importFile).not.toHaveBeenCalled();
    expect(ids).toEqual([]);
    expect(useCrystalStructures.getState().presets).toHaveLength(1);
  });

  it("re-importing the same file replaces its preset rather than stacking a duplicate", async () => {
    await useApp.getState().importFiles([new File(["x"], "si.cif")]);
    await useApp.getState().importFiles([new File(["x"], "si.cif")]);
    expect(useCrystalStructures.getState().presets).toHaveLength(1);
  });

  it("a CIF the backend refuses is reported like any failed import", async () => {
    vi.mocked(uploadStructure).mockRejectedValue(new Error("'bad.cif' has no unit cell"));
    const ids = await useApp.getState().importFiles([new File(["x"], "bad.cif")]);
    expect(ids).toEqual([]);
    expect(useCrystalStructures.getState().presets).toEqual([]);
    expect(toastMsgs().some((m) => m.includes("has no unit cell"))).toBe(true);
  });
});
