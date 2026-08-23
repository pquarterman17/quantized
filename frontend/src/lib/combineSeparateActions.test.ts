// Red-first tests for the dataset-row Combine/Separate menu entries
// (LIBRARY_WORKBOOK_UX_PLAN PR J slice 2 — L0.32-L0.34/L0.51).

import { beforeEach, describe, expect, it } from "vitest";

import { datasetCombineSeparateActions } from "./combineSeparateActions";
import type { DatasetActionTarget } from "./contextActions";
import type { Dataset } from "./types";
import { useApp } from "../store/useApp";
import { useCombineDialog } from "../store/combineDialog";

const find = (id: string) => datasetCombineSeparateActions.find((a) => a.id === id)!;

const ds = (id: string, workbookId?: string): Dataset => ({
  id,
  name: `${id}.dat`,
  workbookId,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
});

function target(dataset: Dataset, extra: Partial<DatasetActionTarget> = {}): DatasetActionTarget {
  return {
    dataset,
    active: false,
    selected: false,
    selectedIds: [],
    canMoveUp: false,
    canMoveDown: false,
    onRename: () => {},
    onAddTag: () => {},
    ...extra,
  };
}

beforeEach(() => {
  useCombineDialog.setState({ seed: null });
  useApp.setState({
    datasets: [ds("d1", "w1"), ds("d2", "w1"), ds("d3")],
    workbooks: [{ id: "w1", name: "W1" }],
    folders: [],
    originFigures: [],
    editableFigures: [],
    figureDocs: [],
    reports: [],
    pages: [],
    quickPlotTemplates: [],
    activeId: null,
    selectedIds: [],
    trash: [],
    history: [],
    future: [],
    status: "",
    separatePreview: null,
  });
});

describe("dataset.combine", () => {
  it("is hidden for a single (non-multi) selection", () => {
    const t = target(ds("d1", "w1"));
    expect(find("dataset.combine").hidden?.(t)).toBe(true);
  });

  it("is visible for a multi-selection and seeds the Combine dialog with the whole selection", () => {
    const t = target(ds("d1", "w1"), { selected: true, selectedIds: ["d1", "d2"] });
    expect(find("dataset.combine").hidden?.(t)).toBe(false);
    find("dataset.combine").run(t);
    expect(useCombineDialog.getState().seed).toEqual({ workbookIds: [], worksheetIds: ["d1", "d2"] });
  });
});

describe("dataset.separate", () => {
  it("previews just this dataset when it isn't part of a multi-selection", () => {
    const t = target(ds("d1", "w1"));
    find("dataset.separate").run(t);
    expect(useApp.getState().separatePreview?.requestedWorksheetIds).toEqual(["d1"]);
  });

  it("previews the whole selection together when this row is part of a multi-selection", () => {
    const t = target(ds("d1", "w1"), { selected: true, selectedIds: ["d1", "d2"] });
    find("dataset.separate").run(t);
    expect(useApp.getState().separatePreview?.requestedWorksheetIds).toEqual(["d1", "d2"]);
  });
});
