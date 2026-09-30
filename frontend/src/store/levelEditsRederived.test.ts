// Level edits on a RE-DERIVED dataset (2026-09-29 audit follow-up), measured
// against the real recalc path (`recalcNow` -> store/recalcDatasets.ts):
//
// - REORDER LEVELS writes `data.level_order` only. The recalc rebuilds `data`
//   from `raw` (corrected) or the source's data (derived), neither of which
//   holds the new order, so the reorder silently vanished. It is now refused
//   up front with lib/rederived.ts's notice, like a cell edit.
// - RECODE adds a `formulas` entry, which both recalc paths re-apply to the
//   rebuilt base. It survives, so it stays allowed; the test pins that.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi } from "../lib/api";
import type { CorrectionsRequest } from "../lib/api";
import { REDERIVED_EDIT_NOTICE } from "../lib/rederived";
import type { DataStruct, Dataset } from "../lib/types";
import { useLevelOrder } from "./levelOrder";
import { useRecode } from "./recode";
import { toast } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({ applyCorrections: vi.fn(), fetchBookData: vi.fn() }));
vi.mock("./toasts", () => ({ toast: vi.fn() }));

const grid = (scale: number): DataStruct => ({
  time: [1, 2, 3],
  values: [[10 * scale, 0], [20 * scale, 1], [30 * scale, 2]],
  labels: ["m", "Grade"],
  units: ["emu", ""],
  metadata: {},
  cat_levels: { 1: ["Low", "Mid", "High"] },
});

// Stand-in backend mirroring calc/corrections.py: numeric channels corrected,
// categorical ones passed through, level metadata carried from the INPUT.
function fakeCorrections(req: CorrectionsRequest): Promise<DataStruct> {
  const bg = req.bg_dataset;
  return Promise.resolve({
    ...req.dataset,
    values: req.dataset.values.map((row, i) => row.map((v, j) => (j === 1 ? v : v - (bg?.values[i]?.[j] ?? 0)))),
  });
}

const A: Dataset = { id: "a", name: "background", data: grid(1) };
const B: Dataset = {
  id: "b",
  name: "sample",
  data: grid(1),
  raw: grid(2),
  corrections: { yOff: 0 },
  bgRef: { datasetId: "a", interp: "linear" },
};
const C: Dataset = {
  id: "c",
  name: "sample (derived)",
  data: grid(1),
  corrections: {},
  raw: grid(1),
  derivedFrom: { datasetId: "a", pipeline: "corrections" },
};
const byId = (id: string) => useApp.getState().datasets.find((d) => d.id === id)!;

async function editSourceAndRecalc() {
  useApp.getState().setCellValue("a", 0, 0, 3);
  await useApp.getState().recalcNow();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(applyCorrectionsApi).mockImplementation(fakeCorrections);
  useApp.setState({
    datasets: [A, B, C],
    activeId: "b",
    history: [],
    future: [],
    status: "",
    recalcMode: "manual",
    staleDatasets: [],
    staleFits: [],
  });
  useLevelOrder.setState({ open: false, datasetId: null, channel: null, openLabel: null, draft: [] });
  useRecode.setState({ open: false, datasetId: null, channel: null, openLabel: null, mapping: { groups: [] } });
});

describe.each([
  ["corrected", "b"],
  ["derived", "c"],
])("on a %s dataset", (_kind, id) => {
  it("the premise: the recalc drops a level_order written to data", async () => {
    const withOrder = { ...byId(id), data: { ...byId(id).data, level_order: { 1: [2, 1, 0] } } };
    useApp.setState({ datasets: useApp.getState().datasets.map((d) => (d.id === id ? withOrder : d)) });
    await editSourceAndRecalc();
    expect(byId(id).data.level_order).toBeUndefined();
  });

  it("so opening the reorder panel is refused", () => {
    useLevelOrder.getState().openLevelOrder(id, 1);
    expect(useLevelOrder.getState().open).toBe(false);
    expect(toast).toHaveBeenCalledWith(REDERIVED_EDIT_NOTICE, "danger");
  });

  it("a commit is refused if the dataset became re-derived while the panel was open", () => {
    const plain = { ...byId(id), derivedFrom: undefined, corrections: undefined };
    useApp.setState({ datasets: useApp.getState().datasets.map((d) => (d.id === id ? plain : d)) });
    useLevelOrder.getState().openLevelOrder(id, 1);
    expect(useLevelOrder.getState().open).toBe(true);
    useLevelOrder.setState({ draft: [2, 1, 0] });
    useApp.setState({ datasets: [A, B, C] }); // re-derived again
    expect(useLevelOrder.getState().commit()).toBe(false);
    expect(byId(id).data.level_order).toBeUndefined();
    expect(useApp.getState().history).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith(REDERIVED_EDIT_NOTICE, "danger");
    expect(useLevelOrder.getState().open).toBe(true); // draft kept for the user
  });

  it("a recode column survives the recalc, so it stays allowed", async () => {
    useRecode.getState().openRecode(id, 1);
    useRecode.getState().setGroup("LowMid", ["Low", "Mid"]);
    expect(useRecode.getState().commitRecode()).not.toBeNull();
    await editSourceAndRecalc();
    const d = byId(id);
    expect(d.data.values[0][0]).not.toBe(10); // really re-derived
    expect(d.data.labels[2]).toBe("Grade (recoded)");
    expect(d.data.values.map((r) => r[2])).toEqual([0, 0, 1]);
    expect(d.data.cat_levels?.[2]).toEqual(["LowMid", "High"]);
    expect(d.formulaErrors).toBeUndefined();
  });
});

it("a plain dataset still reorders, and the order survives a recalc it takes no part in", async () => {
  useLevelOrder.getState().openLevelOrder("a", 1);
  useLevelOrder.setState({ draft: [2, 1, 0] });
  expect(useLevelOrder.getState().commit()).toBe(true);
  await editSourceAndRecalc();
  expect(byId("a").data.level_order).toEqual({ 1: [2, 1, 0] });
});
