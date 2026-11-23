// Which dataset the Data window shows (WORKSPACE_LAYOUT_PLAN P3): follow the
// focused plot, follow the Library, pinned, a multi-dataset plot's inputs
// (D14), and the fail-closed cases.
import { describe, expect, it } from "vitest";

import type { Dataset } from "../types";
import { PINNED_GONE, librarySelection, pinData, plotInputs, resolveDataSource, setDataFollow, unpinData, type DataSourceInput } from "./dataSource";
import { emptyLayout } from "./ops";

const ds = (id: string, over: Partial<Dataset> = {}): Dataset => ({
  id,
  name: id.toUpperCase(),
  data: { time: [0], values: [[1]], labels: ["a"], units: [""], metadata: {} },
  ...over,
});
const graph = ds("g", {
  linkedCurves: [
    { datasetId: "d2", xKey: null, yKey: 0, label: "two" },
    { datasetId: "d1", xKey: null, yKey: 0, label: "one" },
    { datasetId: "d2", xKey: null, yKey: 0, label: "two again" },
    { datasetId: "gone", xKey: null, yKey: 0, label: "deleted source" },
  ],
});
const DATASETS = [ds("d1"), ds("d2"), graph];

const input = (over: Partial<DataSourceInput> = {}): DataSourceInput => ({
  data: { pinned: null, follow: "plot" },
  datasets: DATASETS,
  plotDatasetId: "d1",
  library: { worksheetId: null, selectedIds: [], activeId: "d1" },
  chosen: null,
  ...over,
});

describe("resolveDataSource", () => {
  it("follows the focused plot's dataset by default, with no switcher for a one-dataset plot", () => {
    expect(resolveDataSource(input())).toEqual({ kind: "dataset", mode: "plot", datasetId: "d1", inputs: ["d1"] });
    expect(resolveDataSource(input({ plotDatasetId: "d2" }))).toMatchObject({ datasetId: "d2" });
  });

  it("a multi-dataset graph offers its own sheet then each live source once; the pick sticks while it is an input", () => {
    const g = input({ plotDatasetId: "g" });
    expect(resolveDataSource(g)).toEqual({ kind: "dataset", mode: "plot", datasetId: "g", inputs: ["g", "d2", "d1"] });
    expect(resolveDataSource({ ...g, chosen: "d1" })).toMatchObject({ datasetId: "d1", inputs: ["g", "d2", "d1"] });
    // A pick that is not one of THIS plot's inputs falls back to the first.
    expect(resolveDataSource({ ...g, chosen: "elsewhere" })).toMatchObject({ datasetId: "g" });
    expect(resolveDataSource(input({ chosen: "d2" }))).toMatchObject({ datasetId: "d1", inputs: ["d1"] });
  });

  it("follows the Library: a still-selected worksheet click, else the last selected row, else the active dataset", () => {
    const lib = (library: DataSourceInput["library"]) => resolveDataSource(input({ data: { pinned: null, follow: "library" }, library }));
    expect(lib({ worksheetId: "d2", selectedIds: ["d2"], activeId: "d1" })).toEqual({ kind: "dataset", mode: "library", datasetId: "d2", inputs: ["d2"] });
    // A worksheet click the selection has since moved past (a plot focus, a Ctrl-click) is stale.
    expect(lib({ worksheetId: "d2", selectedIds: ["d1"], activeId: "d1" })).toMatchObject({ datasetId: "d1" });
    expect(lib({ worksheetId: null, selectedIds: ["d1", "d2"], activeId: "d1" })).toMatchObject({ datasetId: "d2" });
    expect(lib({ worksheetId: null, selectedIds: [], activeId: "d1" })).toMatchObject({ datasetId: "d1" });
    expect(lib({ worksheetId: "gone", selectedIds: ["gone"], activeId: null })).toMatchObject({ kind: "none", mode: "library" });
  });

  it("a pin wins over the plot and the Library", () => {
    const pinned = { pinned: "d2", follow: "library" as const };
    expect(resolveDataSource(input({ data: pinned }))).toEqual({ kind: "dataset", mode: "pinned", datasetId: "d2", inputs: ["d2"] });
  });

  it("fails closed: a pin to a removed dataset names no grid; an unbound plot shows a reason", () => {
    expect(resolveDataSource(input({ data: { pinned: "gone", follow: "plot" } }))).toEqual({ kind: "missing", mode: "pinned", pinned: "gone", reason: PINNED_GONE });
    expect(resolveDataSource(input({ plotDatasetId: null }))).toMatchObject({ kind: "none", mode: "plot" });
    expect(resolveDataSource(input({ plotDatasetId: "gone" }))).toMatchObject({ kind: "none", mode: "plot" });
    expect(PINNED_GONE.split(/[.!?](\s|$)/).filter((x) => x?.trim()).length).toBe(1);
  });
});

describe("helpers", () => {
  it("plotInputs and librarySelection", () => {
    expect(plotInputs("d1", DATASETS)).toEqual(["d1"]);
    expect(plotInputs("missing", DATASETS)).toEqual(["missing"]);
    expect(librarySelection({ worksheetId: null, selectedIds: [], activeId: null }, DATASETS)).toBeNull();
  });

  it("pin / unpin / follow are pure and return the same object on a no-op", () => {
    const l = emptyLayout();
    const p = pinData(l, "d1");
    expect(p.data).toEqual({ pinned: "d1", follow: "plot" });
    expect(l.data.pinned).toBeNull();
    expect(pinData(p, "d1")).toBe(p);
    expect(unpinData(p).data.pinned).toBeNull();
    expect(unpinData(l)).toBe(l);
    expect(setDataFollow(l, "library").data.follow).toBe("library");
    expect(setDataFollow(l, "plot")).toBe(l);
  });
});
