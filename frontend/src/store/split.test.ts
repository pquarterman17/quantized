// Tests for MAIN_PLAN #26 (split a dataset by column value). Covers: N
// named+grouped child datasets, source untouched, single undo entry, id
// uniqueness, the <2-groups and >cap no-op paths, what carries/doesn't
// carry to the children, the still-pending-Origin-book resolve step, and
// the dialog-target open/close pair.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData } from "../lib/api";
import type { DataStruct, Dataset } from "../lib/types";
import { toast } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({
  applyCorrections: vi.fn(),
  uploadFile: vi.fn(),
  fetchBookData: vi.fn(),
  guessImportSettings: vi.fn(),
  parseImportText: vi.fn(),
}));

vi.mock("./toasts", () => ({ toast: vi.fn() }));

// Two setpoints (5 K / 10 K), each read back with controller wobble — the
// smallest realistic fixture that still exercises gap-clustering (fewer
// than lib/modeling.ts's MIN_SAMPLES=12 rows, so it's ALWAYS "continuous",
// never misread as nominal — see datasetsplit.test.ts's splitColumn tests
// for the >=12-row categorical case).
const wobble: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[4.998], [5.0], [5.003], [9.997], [10.0], [10.003]],
  labels: ["T"],
  units: ["K"],
  metadata: {},
};

function baseDataset(over: Partial<Dataset> = {}): Dataset {
  return { id: "d1", name: "run1.dat", data: wobble, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [],
    folders: [],
    expandedFolders: [],
    activeId: null,
    selectedIds: [],
    worksheetId: null,
    originFigures: [],
    reports: [],
    figureDocs: [],
    history: [],
    future: [],
    status: "",
    splitDialogTargetId: null,
  });
});

describe("splitDatasetByColumn — the happy path", () => {
  it("creates one named+grouped dataset per group and leaves the source untouched", async () => {
    useApp.setState({ datasets: [baseDataset()] });

    await useApp.getState().splitDatasetByColumn("d1", 0);

    const s = useApp.getState();
    const children = s.datasets.filter((d) => d.id !== "d1");
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.name).sort()).toEqual(["run1.dat (10 K)", "run1.dat (5 K)"]);

    const src = s.datasets.find((d) => d.id === "d1")!;
    expect(src.data).toEqual(wobble); // source data untouched

    // All children land in ONE new folder named after the source.
    const folderIds = new Set(children.map((c) => c.folderId));
    expect(folderIds.size).toBe(1);
    const folder = s.folders.find((f) => f.id === [...folderIds][0]);
    expect(folder?.name).toBe("run1.dat");
  });

  it("mints unique ids for every child (no collision with the source or each other)", async () => {
    useApp.setState({ datasets: [baseDataset()] });
    await useApp.getState().splitDatasetByColumn("d1", 0);
    const ids = useApp.getState().datasets.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("selects the new children and activates the first one", async () => {
    useApp.setState({ datasets: [baseDataset()], activeId: "d1", selectedIds: ["d1"] });
    await useApp.getState().splitDatasetByColumn("d1", 0);
    const s = useApp.getState();
    const childIds = s.datasets.filter((d) => d.id !== "d1").map((d) => d.id);
    expect(s.activeId).toBe(childIds[0]);
    expect(s.selectedIds.sort()).toEqual([...childIds].sort());
  });

  it("closes the split dialog and shows a success toast", async () => {
    useApp.setState({ datasets: [baseDataset()], splitDialogTargetId: "d1" });
    await useApp.getState().splitDatasetByColumn("d1", 0);
    expect(useApp.getState().splitDialogTargetId).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("split into 2 datasets"), "ok");
  });
});

describe("splitDatasetByColumn — bug-hunt regression: re-split reuses the folder (cosmetic)", () => {
  it("splitting the same source twice reuses the ONE existing folder instead of minting a sibling duplicate", async () => {
    useApp.setState({ datasets: [baseDataset()] });

    await useApp.getState().splitDatasetByColumn("d1", 0);
    const afterFirst = useApp.getState();
    expect(afterFirst.folders).toHaveLength(1);
    const folderId = afterFirst.folders[0].id;

    // Re-split the SAME source (e.g. the user re-opened the dialog and hit
    // Confirm again with a different tolerance) -- must NOT create a second
    // "run1.dat" folder sitting next to the first.
    await useApp.getState().splitDatasetByColumn("d1", 0);
    const afterSecond = useApp.getState();

    expect(afterSecond.folders).toHaveLength(1); // still exactly one folder
    expect(afterSecond.folders[0].id).toBe(folderId); // the SAME folder, reused
    expect(afterSecond.folders.filter((f) => f.name === "run1.dat")).toHaveLength(1);

    // Both splits' children all landed in that one folder.
    const children = afterSecond.datasets.filter((d) => d.id !== "d1");
    expect(children).toHaveLength(4); // 2 groups x 2 splits
    expect(children.every((c) => c.folderId === folderId)).toBe(true);
  });

  it("a folder with the same name under a DIFFERENT parent is not mistaken for the source's sibling", async () => {
    useApp.setState({
      datasets: [baseDataset()],
      folders: [{ id: "unrelated", name: "run1.dat", parentId: "somewhere-else", order: 0 }],
    });

    await useApp.getState().splitDatasetByColumn("d1", 0);

    const s = useApp.getState();
    // A NEW root-level folder was created — the same-named folder living
    // under a different parent is not the source's own sibling.
    expect(s.folders).toHaveLength(2);
    const mine = s.folders.find((f) => f.id !== "unrelated")!;
    expect(mine.parentId).toBeNull();
    expect(mine.name).toBe("run1.dat");
  });
});

describe("splitDatasetByColumn — undo", () => {
  it("records exactly ONE undo entry; undo restores the pre-split library in one step", async () => {
    useApp.setState({ datasets: [baseDataset()] });

    await useApp.getState().splitDatasetByColumn("d1", 0);
    expect(useApp.getState().history).toHaveLength(1);
    expect(useApp.getState().datasets).toHaveLength(3); // source + 2 children

    useApp.getState().undo();

    const s = useApp.getState();
    expect(s.datasets).toHaveLength(1);
    expect(s.datasets[0].id).toBe("d1");
    expect(s.datasets[0].data).toEqual(wobble);
  });

  it("undo leaves the (now-empty) split folder behind — folder-tree edits sit outside undo everywhere in this store", async () => {
    useApp.setState({ datasets: [baseDataset()] });
    await useApp.getState().splitDatasetByColumn("d1", 0);
    const foldersAfterSplit = useApp.getState().folders.length;
    expect(foldersAfterSplit).toBe(1);

    useApp.getState().undo();

    // Same precedent as DatasetRow's "New folder with this…": createFolder
    // never calls recordHistory, so the folder itself isn't part of the
    // undo snapshot even though its (now-orphaned) contents are.
    expect(useApp.getState().folders).toHaveLength(foldersAfterSplit);
  });
});

describe("splitDatasetByColumn — refuses a useless split", () => {
  it("no-ops and toasts when the column yields fewer than 2 groups", async () => {
    const oneGroup: DataStruct = { ...wobble, values: [[5], [5], [5], [5], [5], [5]] };
    useApp.setState({ datasets: [baseDataset({ data: oneGroup })] });

    await useApp.getState().splitDatasetByColumn("d1", 0);

    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("doesn't split"), "danger");
  });

  it("no-ops and toasts when the group count exceeds the cap (a mis-picked/too-tight column)", async () => {
    const n = 60;
    const ramp: DataStruct = {
      time: Array.from({ length: n }, (_, i) => i),
      values: Array.from({ length: n }, (_, i) => [i]),
      labels: ["x"],
      units: [""],
      metadata: {},
    };
    useApp.setState({ datasets: [baseDataset({ data: ramp })] });

    // An explicit too-tight tolerance forces the many-groups case (see
    // datasetsplit.test.ts's "monotonic ramp" tests for why auto tolerance
    // alone wouldn't reproduce this).
    await useApp.getState().splitDatasetByColumn("d1", 0, 0.5);

    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("too many groups"), "danger");
  });

  it("no-ops silently on an unknown dataset id", async () => {
    useApp.setState({ datasets: [baseDataset()] });
    await useApp.getState().splitDatasetByColumn("ghost", 0);
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(0);
  });
});

describe("splitDatasetByColumn — what carries to a child, and what doesn't", () => {
  it("carries formulas/channelRoles/channelTypes (column-indexed, unaffected by a row slice)", async () => {
    useApp.setState({
      datasets: [
        baseDataset({
          formulas: [{ name: "T2", expr: "A^2" }],
          channelRoles: { 0: "label" },
          channelTypes: { 0: "continuous" },
        }),
      ],
    });

    await useApp.getState().splitDatasetByColumn("d1", 0);

    const child = useApp.getState().datasets.find((d) => d.id !== "d1")!;
    expect(child.formulas).toEqual([{ name: "T2", expr: "A^2" }]);
    expect(child.channelRoles).toEqual({ 0: "label" });
    expect(child.channelTypes).toEqual({ 0: "continuous" });
  });

  it("drops row-indexed state (excludedRows/filter) — the indices are meaningless post-slice", async () => {
    useApp.setState({
      datasets: [
        baseDataset({
          excludedRows: [0, 3],
          filter: [{ col: 0, kind: "range", min: 0, max: 100 }],
        }),
      ],
    });

    await useApp.getState().splitDatasetByColumn("d1", 0);

    const child = useApp.getState().datasets.find((d) => d.id !== "d1")!;
    expect(child.excludedRows).toBeUndefined();
    expect(child.filter).toBeUndefined();
  });

  it("drops raw/corrections/bgRef, source, and notes/tags/fitSpec", async () => {
    useApp.setState({
      datasets: [
        baseDataset({
          raw: wobble,
          corrections: { yOff: 1 },
          bgRef: { datasetId: "bg", interp: "pchip" },
          source: { kind: "path", path: "/data/run1.dat" },
          notes: "sample A",
          tags: ["MvsH"],
          fitSpec: { model: "linear" },
        }),
      ],
    });

    await useApp.getState().splitDatasetByColumn("d1", 0);

    const child = useApp.getState().datasets.find((d) => d.id !== "d1")!;
    expect(child.raw).toBeUndefined();
    expect(child.corrections).toBeUndefined();
    expect(child.bgRef).toBeUndefined();
    expect(child.source).toBeUndefined();
    expect(child.notes).toBeUndefined();
    expect(child.tags).toBeUndefined();
    expect(child.fitSpec).toBeUndefined();
  });

  it("never aliases the source's mutable arrays", async () => {
    useApp.setState({ datasets: [baseDataset()] });
    await useApp.getState().splitDatasetByColumn("d1", 0);
    const child = useApp.getState().datasets.find((d) => d.id !== "d1")!;
    child.data.values[0][0] = 999;
    expect(useApp.getState().datasets.find((d) => d.id === "d1")!.data.values[0][0]).not.toBe(999);
  });
});

describe("splitDatasetByColumn — resolves a still-pending Origin book first", () => {
  it("fetches the full data before grouping, so the split sees every row, not just the preview", async () => {
    const full: DataStruct = {
      time: [0, 1, 2, 3, 4, 5],
      values: [[4.998], [5.0], [5.003], [9.997], [10.0], [10.003]],
      labels: ["T"],
      units: ["K"],
      metadata: {},
    };
    useApp.setState({
      datasets: [
        baseDataset({
          data: { time: [0, 1], values: [[4.998], [5.0]], labels: ["T"], units: ["K"], metadata: {} },
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 6, cols: 1 },
        }),
      ],
    });
    vi.mocked(fetchBookData).mockResolvedValue(full);

    await useApp.getState().splitDatasetByColumn("d1", 0);

    const children = useApp.getState().datasets.filter((d) => d.id !== "d1");
    expect(children).toHaveLength(2); // both setpoints, not just the 2-row preview
  });
});

describe("openSplitDialog / closeSplitDialog", () => {
  it("sets and clears the dialog target id", () => {
    useApp.getState().openSplitDialog("d1");
    expect(useApp.getState().splitDialogTargetId).toBe("d1");
    useApp.getState().closeSplitDialog();
    expect(useApp.getState().splitDialogTargetId).toBeNull();
  });
});
