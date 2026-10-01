// PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 ("in-stage level RENAME"): renaming one
// categorical level in place — the label in `cat_levels` changes, the codes
// (and so `level_order` and every formula literal) never do.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { REDERIVED_EDIT_NOTICE } from "../lib/rederived";
import type { DataStruct, Dataset } from "../lib/types";
import { parseWorkspace } from "../lib/workspace";
import { serializeWorkspace } from "../lib/workspaceSerialize";
import { renameLevel } from "./levelRename";
import { useRecode } from "./recode";
import { toast } from "./toasts";
import { useApp } from "./useApp";

vi.mock("./toasts", () => ({ toast: vi.fn() }));

const data = (): DataStruct => ({
  time: [0, 1, 2, 3],
  values: [[0], [1], [2], [0]],
  labels: ["Grade"],
  units: [""],
  metadata: {},
  cat_levels: { 0: ["Low", "Mid", "High"] },
  level_order: { 0: [2, 0, 1] },
});

const plain = (): Dataset => ({ id: "d1", name: "grades.dat", data: data() });
const byId = (id = "d1") => useApp.getState().datasets.find((d) => d.id === id)!;

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [plain()],
    activeId: "d1",
    history: [],
    future: [],
    recalcMode: "manual",
    staleDatasets: [],
    staleFits: [],
  });
  useRecode.setState({ open: false, datasetId: null, channel: null, openLabel: null, mapping: { groups: [] } });
});

function addRecode() {
  useRecode.getState().openRecode("d1", 0);
  useRecode.getState().setGroup("LowMid", ["Low", "Mid"]);
  expect(useRecode.getState().commitRecode()).not.toBeNull();
}

describe("renameLevel", () => {
  it("rewrites the label in cat_levels and leaves codes and level_order alone", () => {
    expect(renameLevel("d1", 0, 1, "Medium")).toBe(true);
    const d = byId().data;
    expect(d.cat_levels).toEqual({ 0: ["Low", "Medium", "High"] });
    expect(d.values).toEqual([[0], [1], [2], [0]]);
    expect(d.level_order).toEqual({ 0: [2, 0, 1] });
  });

  it("trims the new name", () => {
    expect(renameLevel("d1", 0, 0, "  Lo  ")).toBe(true);
    expect(byId().data.cat_levels?.[0]).toEqual(["Lo", "Mid", "High"]);
  });

  it("is one undo entry, and redo reapplies it", () => {
    renameLevel("d1", 0, 1, "Medium");
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(byId().data.cat_levels?.[0]).toEqual(["Low", "Mid", "High"]);
    useApp.getState().redo();
    expect(byId().data.cat_levels?.[0]).toEqual(["Low", "Medium", "High"]);
  });

  it("an unchanged name is a no-op with no undo entry", () => {
    expect(renameLevel("d1", 0, 1, "Mid")).toBe(true);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("refuses a duplicate name with one sentence and changes nothing", () => {
    expect(renameLevel("d1", 0, 1, "High")).toBe(false);
    expect(toast).toHaveBeenCalledWith('A level named "High" already exists in this column.', "danger");
    expect(byId().data.cat_levels?.[0]).toEqual(["Low", "Mid", "High"]);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("refuses an empty name", () => {
    expect(renameLevel("d1", 0, 1, "   ")).toBe(false);
    expect(toast).toHaveBeenCalledWith("A level name can't be empty.", "danger");
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("a recode column built on the column follows the rename instead of losing the level", () => {
    addRecode();
    const before = byId().data.values.map((r) => r[1]);
    expect(renameLevel("d1", 0, 0, "Lo")).toBe(true);
    const d = byId();
    expect(d.formulas?.[0].recode?.mapping.groups[0].from).toEqual(["Lo", "Mid"]);
    expect(d.data.values.map((r) => r[1])).toEqual(before);
    expect(d.data.cat_levels?.[1]).toEqual(["LowMid", "High"]);
    expect(d.formulaErrors).toBeUndefined();
  });

  it("a reordered recode column keeps its order when a pass-through level is renamed", () => {
    addRecode(); // recode table ["LowMid", "High"]; High passes through
    const reordered = { ...byId().data, level_order: { ...byId().data.level_order, 1: [1, 0] } };
    useApp.setState({ datasets: [{ ...byId(), data: reordered }] });
    expect(renameLevel("d1", 0, 2, "Top")).toBe(true);
    const d = byId().data;
    expect(d.cat_levels?.[1]).toEqual(["LowMid", "Top"]);
    expect(d.level_order).toEqual({ 0: [2, 0, 1], 1: [1, 0] });
  });

  it("refuses a level of a computed (recode) column, whose labels its recode owns", () => {
    addRecode();
    const history = useApp.getState().history.length;
    expect(renameLevel("d1", 1, 0, "Other")).toBe(false);
    expect(toast).toHaveBeenCalledWith("This column's levels come from its formula; edit the recode instead.", "danger");
    expect(useApp.getState().history).toHaveLength(history);
  });

  it("survives a real .dwk save and reopen", () => {
    renameLevel("d1", 0, 2, "Top");
    const text = serializeWorkspace(useApp.getState());
    useApp.setState({ datasets: [plain()] });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    expect(byId().data.cat_levels?.[0]).toEqual(["Low", "Mid", "Top"]);
    expect(byId().data.level_order).toEqual({ 0: [2, 0, 1] });
  });

  describe.each([
    ["corrected", { corrections: { yOff: 0 }, raw: data() }],
    ["derived", { corrections: {}, raw: data(), derivedFrom: { datasetId: "src", pipeline: "corrections" as const } }],
  ])("on a %s (re-derived) dataset", (_kind, extra) => {
    it("is refused with the re-derived notice, like a reorder", () => {
      useApp.setState({ datasets: [{ ...plain(), ...extra }] });
      expect(renameLevel("d1", 0, 1, "Medium")).toBe(false);
      expect(toast).toHaveBeenCalledWith(REDERIVED_EDIT_NOTICE, "danger");
      expect(byId().data.cat_levels?.[0]).toEqual(["Low", "Mid", "High"]);
      expect(useApp.getState().history).toHaveLength(0);
    });
  });
});
