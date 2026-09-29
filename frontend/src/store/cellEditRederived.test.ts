// Cell edits on a RE-DERIVED dataset (bug: silent revert). A dataset whose
// values the recalc graph regenerates — a corrected one (`raw` + `corrections`,
// re-run from `raw` by store/recalcDatasets.ts) or a derived worksheet
// (`derivedFrom`, re-run from its source) — used to accept typed values into
// `data` only; the next recalc rebuilt `data` from `raw`/the source and the
// edit vanished with no notice. The store now REFUSES every direct value edit
// on such a dataset (zero mutation, one-sentence status). Excluded-row
// toggling is not a value edit and stays allowed.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi } from "../lib/api";
import type { CorrectionsRequest } from "../lib/api";
import type { DataStruct, Dataset } from "../lib/types";
import { REDERIVED_EDIT_NOTICE } from "../lib/rederived";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({
  applyCorrections: vi.fn(),
  fetchBookData: vi.fn(),
}));
vi.mock("./toasts", () => ({ toast: vi.fn() }));

const grid = (scale: number): DataStruct => ({
  time: [1, 2, 3],
  values: [[10 * scale], [20 * scale], [30 * scale]],
  labels: ["m"],
  units: ["emu"],
  metadata: {},
});

// Stand-in backend: subtract the background row-wise, which is all the recalc
// repro needs to prove B was rebuilt from `raw`.
function fakeCorrections(req: CorrectionsRequest): Promise<DataStruct> {
  const bg = req.bg_dataset;
  return Promise.resolve({
    ...req.dataset,
    values: req.dataset.values.map((row, i) => row.map((v, j) => v - (bg?.values[i]?.[j] ?? 0))),
  });
}

const A: Dataset = { id: "a", name: "background", data: grid(1) };
const B: Dataset = {
  id: "b",
  name: "sample",
  data: grid(1), // raw(2x) - A(1x)
  raw: grid(2),
  corrections: { yOff: 0 },
  bgRef: { datasetId: "a", interp: "linear" },
};
const C: Dataset = {
  id: "c",
  name: "sample (derived)",
  data: grid(1),
  derivedFrom: { datasetId: "a", pipeline: "corrections" },
};

const byId = (id: string) => useApp.getState().datasets.find((d) => d.id === id)!;

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
});

describe("direct value edits on a re-derived dataset are refused", () => {
  it("the repro: a value typed into corrected B is refused, not silently reverted later", async () => {
    useApp.getState().setCellValue("b", 1, 0, 999);
    expect(byId("b").data.values[1][0]).toBe(20);
    expect(useApp.getState().status).toBe(REDERIVED_EDIT_NOTICE);
    expect(useApp.getState().history).toHaveLength(0); // zero mutation, no undo entry
    // An edit to A still recalcs B from raw — and there is nothing to lose.
    useApp.getState().setCellValue("a", 1, 0, 5);
    await useApp.getState().recalcNow();
    expect(byId("b").data.values[1][0]).toBe(40 - 5);
  });

  it.each([
    ["corrected", "b"],
    ["derived", "c"],
  ])("refuses every value-writing entry point on a %s dataset", (_kind, id) => {
    const before = byId(id).data;
    const s = useApp.getState();
    s.setCellValue(id, 0, -1, 99);
    s.setCellBlock(id, [{ row: 0, col: 0, value: 7 }], "paste cells");
    s.setCategoricalCell(id, 0, 0, "x");
    s.insertRows(id, 0, 1);
    s.deleteRows(id, [0]);
    expect(byId(id).data).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().status).toBe(REDERIVED_EDIT_NOTICE);
  });

  it("a plain dataset, and one with raw but no corrections, stay editable", () => {
    useApp.setState({ datasets: [A, { ...A, id: "r", raw: grid(3) }] });
    useApp.getState().setCellValue("a", 0, 0, 11);
    useApp.getState().setCellValue("r", 0, 0, 12);
    expect(byId("a").data.values[0][0]).toBe(11);
    expect(byId("r").data.values[0][0]).toBe(12);
  });

  it("excluded-row toggling on corrected B is allowed and survives the recalc", async () => {
    useApp.getState().toggleRowExcluded("b", 2);
    expect(byId("b").excludedRows).toEqual([2]);
    useApp.getState().setCellValue("a", 0, 0, 3);
    expect(useApp.getState().staleDatasets).toContain("b");
    await useApp.getState().recalcNow();
    expect(byId("b").data.values[0][0]).toBe(20 - 3); // B really was re-derived
    expect(byId("b").excludedRows).toEqual([2]);
  });
});
